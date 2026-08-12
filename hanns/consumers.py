"""
hanns/consumers.py — WebSocket consumer for live Hanns presentations.

Plug into your existing ASGI routing alongside the Boardly + poll consumers:

    # project routing
    from hanns.consumers import PresentConsumer
    websocket_urlpatterns += [
        re_path(r"ws/hanns/(?P<code>\\w+)/$", PresentConsumer.as_asgi()),
    ]

Mirrors boardly.BoardConsumer's shape (code from the URL kwarg, a per-deck
group, an is_presenter flag, fanout + send_json helpers, snapshot on
connect, @sync_to_async DB access). It is intentionally thin: the deck
content is edited over plain HTTP and lives in the DB, so the socket only
carries the things that must be real-time —

Client → server:
    {type:"presenter_hello"}        the presenter/projector screen connected
    {type:"join", nick}             an audience phone joined
    {type:"react", emoji}           audience tapped an emoji
    {type:"goto", index}            presenter moved to slide <index>

    {type:"reveal", index, elId}            show a cue-held element NOW
    {type:"reveal", index, elId:"*"}        show every cue-held element
    {type:"reveal", index, elId, hide:true} put it back out of sight
    {type:"reveal_state", index}            which elements are cue-held, and
                                            which are already showing
    {type:"focus", index, elId}             lift the authored zoom region
                                            <elId> in front of the slide
    {type:"focus", index, off:true}          drop the callout
    {type:"focus_state", index}              which zoom regions this slide
                                            has, and which one is up
    {type:"actor_action", index, elId,      make an actor object perform
          action, mood}                     (the Pass-2 half of hanns_actors)

Server → client (fanned out to the whole deck group):
    {type:"state", code, title,     full snapshot on connect: lets a phone
          current_slide,            render the reaction pad and sync to the
          allow_reactions,          slide the presenter is on
          live, count, revealed}
    {type:"reaction", emoji}        spawn a floating emoji on every screen
    {type:"goto", index, slide,     audience follows the presenter's slide
          revealed}
    {type:"participants", count}    live audience headcount
    {type:"reveal", index, ids,     reveal (or re-hide) held elements on the
          hide, revealed}           big screen, with their entrance animation
    {type:"actor_action", index,    play a one-off actor action
          elId, action, mood}

Server → the calling controller only:
    {type:"reveal_state", index, elements, revealed}
    {type:"focus_state", index, regions, active}

── Reveal-on-cue ───────────────────────────────────────────────────────
An element opts in from the editor by carrying ``revealOn: "cue"`` in its
slide JSON. The renderer holds such an element back in LIVE views only
(the editor always shows it, or you could not select it). The phone
controller then lists the held elements for the current slide and taps one
to bring it in — the projector plays the element's own ``anim`` as it
lands, so a cued reveal looks identical to an on-entry one.

Reveal state is per-process and in-memory, exactly like the participant
headcount below — a reconnecting projector re-reads it from the snapshot,
and moving to a slide clears that slide's reveals so revisiting it replays
from the top. Behind multiple workers it is per-worker; promote it to
Redis alongside ``_counts`` if you ever run more than one.

── Zoom regions ────────────────────────────────────────────────────────
A region is an element of ``type: "focus"`` — an authored rectangle or
circle over the part of the slide worth enlarging. It draws nothing on the
big screen by itself. The controller lists the regions on the current
slide; tapping one fans out {type:"focus", elId} and the stage lifts a
magnified view of that area in front of the (dimmed) slide. Tapping again,
or moving slide, drops it.

Only ONE region is up at a time — a second tap replaces the first, which
is what a presenter means by "now look over here". The active region is
tracked per slide in memory next to the reveal set, with the same
per-worker caveat.

Nothing here needs a migration: cue flags and zoom regions both ride
inside Slide.data["els"], which Slide.as_dict() already ships to every
client.
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer


# A small allow-list so a malicious client can't inject arbitrary markup as
# an "emoji". Keep in sync with REACTIONS in hanns_present.js.
ALLOWED_REACTIONS = {
    "❤️", "👏", "🔥", "😂", "😮", "💯", "🎉", "👍", "✨", "🙌", "🤯", "💜",
}

# Actor verbs the phone controller may trigger. Keep in sync with the rig
# table in hanns_actors.js — an unknown verb is dropped rather than passed
# through, so a stale phone page can never inject a class name onto the
# projector.
ALLOWED_ACTOR_ACTIONS = {
    "idle", "walk", "run", "jump", "grow", "shake", "wave", "spin",
    "fill", "drain", "harvest", "rain", "shine", "count",
}
ALLOWED_ACTOR_MOODS = {"neutral", "happy", "sad", "surprised", "tired"}

# Element ids are author-supplied strings; cap them so a junk payload can
# neither bloat the group message nor the in-memory reveal set.
MAX_EL_ID = 120


def _cue_label(el):
    """A short human label for one cue-held element, for the phone list."""
    for key in ("label", "title", "text", "name"):
        val = el.get(key)
        if val and str(val).strip():
            text = " ".join(str(val).split())
            return text[:48] + ("…" if len(text) > 48 else "")
    kind = el.get("objectType") or el.get("shapeType") or el.get("type") or "element"
    return str(kind).replace("_", " ").title()[:48]


class PresentConsumer(AsyncWebsocketConsumer):
    # ── lifecycle ────────────────────────────────────────────────────
    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = f"hanns_{self.code}"
        self.nick = None
        self.is_presenter = False
        self.is_controller = False
        self.is_editor = False

        self.deck = await self._get_deck(self.code)
        if self.deck is None:
            await self.close()
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

        # Snapshot so a (re)connecting phone can build its reaction pad and
        # sync to whatever slide the presenter is currently showing.
        await self.send_json(await self._snapshot())

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)
            if not self.is_presenter and self.nick:
                await self._bump_participants(-1)
                await self._broadcast_participants()

    # ── inbound ──────────────────────────────────────────────────────
    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (ValueError, TypeError):
            return

        mtype = data.get("type")

        if mtype == "presenter_hello":
            self.is_presenter = True
            await self._broadcast_participants()

        elif mtype == "controller_hello":
            pin = str(data.get("pin") or "").strip()
            if pin and pin == await self._control_pin():
                self.is_controller = True
                current = await self._current_slide()
                await self.send_json({
                    "type": "controller_ok",
                    "current_slide": current,
                    # Send the latest slides from the DB so phone notes are fresh,
                    # even if the phone controller page was opened before the
                    # presenter saved/started the slideshow.
                    "slides": await self._slides(),
                    # So the reveal panel opens already in step with the stage.
                    "revealed": self._revealed_list(current),
                })
            else:
                await self.send_json({"type": "controller_denied"})

        elif mtype == "editor_hello":
            if await self._can_edit_current_user():
                self.is_editor = True
                await self.send_json({"type": "editor_ok"})
            else:
                await self.send_json({"type": "editor_denied"})

        elif mtype == "editor_saved":
            if self.is_editor:
                await self._handle_editor_saved(data)

        elif mtype == "join":
            self.nick = (data.get("nick") or "").strip()[:40] or "Anonymous"
            await self._bump_participants(+1)
            await self._broadcast_participants()

        elif mtype == "react":
            await self._handle_react(data)

        elif mtype == "goto":
            # Presenter screen or PIN-approved phone controller drives slides.
            if self.is_presenter or self.is_controller:
                await self._handle_goto(data)

        elif mtype == "pointer":
            # PIN-approved phone controller can point to an area of the slide.
            if self.is_presenter or self.is_controller:
                await self._handle_pointer(data)

        elif mtype == "zoom":
            # Magnify the whole stage, or a specific area of it, on the big
            # screen. Presenter screen or PIN-approved controller only.
            if self.is_presenter or self.is_controller:
                await self._handle_zoom(data)

        elif mtype == "reveal":
            # Bring a cue-held element onto the big screen (or take it back).
            if self.is_presenter or self.is_controller:
                await self._handle_reveal(data)

        elif mtype == "focus":
            # Lift an authored zoom region in front of the slide (or drop it).
            if self.is_presenter or self.is_controller:
                await self._handle_focus(data)

        elif mtype == "focus_state":
            # Controller asking which zoom regions this slide carries.
            if self.is_presenter or self.is_controller:
                await self._handle_focus_state(data)

        elif mtype == "reveal_state":
            # Controller asking what is holdable / already shown on a slide.
            if self.is_presenter or self.is_controller:
                await self._handle_reveal_state(data)

        elif mtype == "actor_action":
            # Make an actor object perform on the big screen.
            if self.is_presenter or self.is_controller:
                await self._handle_actor_action(data)

        elif mtype == "end_show":
            # Controller ends the presentation on the big screen. The stage
            # then shows the download QR (when the owner enabled downloads).
            if self.is_presenter or self.is_controller:
                await self._handle_end_show()

        elif mtype == "show_download":
            # Put the download QR up without ending the show.
            if self.is_presenter or self.is_controller:
                await self._handle_show_download(bool(data.get("visible", True)))

        elif mtype == "download_status":
            # Controller asking whether audience downloads are enabled.
            if self.is_presenter or self.is_controller:
                info = await self._download_info()
                await self.send_json({
                    "type": "download_status",
                    "allow_download": bool(info.get("allow_download")),
                })

    # ── reactions ────────────────────────────────────────────────────
    async def _handle_react(self, data):
        emoji = data.get("emoji")
        if emoji not in ALLOWED_REACTIONS:
            return
        if not await self._reactions_allowed():
            return

        # Always fan out the reaction. A previous build called
        # _record_reaction() but did not define it, which stopped BOTH the
        # floating emoji and the counter. This version records when the DB
        # table exists and safely falls back to in-memory counts if migrations
        # have not run yet.
        try:
            counts = await self._record_reaction(emoji)
            if not counts:
                counts = self._memory_reaction_counts(emoji)
        except Exception:
            counts = self._memory_reaction_counts(emoji)

        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "reaction", "emoji": emoji, "reaction_counts": counts},
        })

    async def _handle_goto(self, data):
        try:
            index = int(data.get("index"))
        except (TypeError, ValueError):
            return
        index = max(0, index)
        await self._set_current_slide(index)
        slide = await self._slide(index)
        # Arriving at a slide resets its cue-held elements, so stepping back
        # to a slide replays it from the top instead of showing every reveal
        # the presenter already spent.
        self._clear_reveals(index)
        # A callout belongs to the slide it was authored on — arriving
        # anywhere (including back here) starts with a clean stage.
        self._set_focus(index, None)
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "goto", "index": index, "slide": slide, "revealed": [],
            },
        })

    async def _handle_pointer(self, data):
        try:
            x = float(data.get("x"))
            y = float(data.get("y"))
        except (TypeError, ValueError):
            return
        # x/y are in the 960×540 design coordinate space. Clamp so a bad
        # phone tap cannot create off-screen overlays.
        x = max(0, min(960, x))
        y = max(0, min(540, y))
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "pointer", "x": x, "y": y},
        })

    async def _handle_zoom(self, data):
        """Magnify the stage on the big screen.

        {type:"zoom", scale, x, y}   scale 1 = normal; x/y are the point to
                                     centre on, in 960×540 design space.
        {type:"zoom", scale:1}       reset.

        x/y are optional: with no point given the stage zooms about its
        centre, which is what a plain "zoom the whole page" request means.
        """
        try:
            scale = float(data.get("scale", 1))
        except (TypeError, ValueError):
            return
        # Keep it sane: below 1 would shrink the slide, above 6 is unreadable.
        scale = max(1.0, min(6.0, scale))

        point = {}
        if data.get("x") is not None and data.get("y") is not None:
            try:
                x = float(data.get("x"))
                y = float(data.get("y"))
            except (TypeError, ValueError):
                return
            point = {"x": max(0, min(960, x)), "y": max(0, min(540, y))}

        payload = {"type": "zoom", "scale": scale}
        payload.update(point)
        await self.channel_layer.group_send(self.group, {
            "type": "fanout", "payload": payload,
        })

    # ── reveal-on-cue ────────────────────────────────────────────────
    async def _handle_reveal(self, data):
        """Show (or re-hide) elements the deck is holding back on a slide.

        The element id is checked against the slide's actual cue-held
        elements before anything is fanned out, so a stale or hostile phone
        can neither invent ids nor un-hide something the author never
        marked as a cue.
        """
        index = await self._index_arg(data)
        el_id = str(data.get("elId") or "").strip()[:MAX_EL_ID]
        hide = bool(data.get("hide"))
        if not el_id:
            return

        valid = {c["id"] for c in await self._cue_elements(index)}
        if not valid:
            return

        bucket = self._reveal_bucket(index)
        if el_id == "*":
            ids = sorted(valid)
        else:
            if el_id not in valid:
                return
            ids = [el_id]

        if hide:
            bucket.difference_update(ids)
        else:
            bucket.update(ids)

        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "reveal",
                "index": index,
                "ids": ids,
                "hide": hide,
                "revealed": sorted(bucket),
            },
        })

    async def _handle_reveal_state(self, data):
        """Answer just the caller: what can be cued on this slide, and what
        is already on screen. Lets the phone panel rebuild itself after a
        reconnect without waiting for the next goto."""
        index = await self._index_arg(data)
        await self.send_json({
            "type": "reveal_state",
            "index": index,
            "elements": await self._cue_elements(index),
            "revealed": self._revealed_list(index),
        })

    # ── zoom regions ─────────────────────────────────────────────────
    async def _handle_focus(self, data):
        """Show (or drop) an authored zoom region on the big screen.

        Like reveal, the id is checked against the slide's real focus
        elements first, so a stale phone cannot ask the stage to magnify
        coordinates the author never marked.
        """
        index = await self._index_arg(data)
        el_id = str(data.get("elId") or "").strip()[:MAX_EL_ID]
        off = bool(data.get("off")) or not el_id

        if off:
            self._set_focus(index, None)
            await self.channel_layer.group_send(self.group, {
                "type": "fanout",
                "payload": {"type": "focus", "index": index, "elId": "", "off": True},
            })
            return

        valid = {r["id"] for r in await self._focus_regions(index)}
        if el_id not in valid:
            return

        # Tapping the region that is already up is how you put it away.
        if self._get_focus(index) == el_id:
            self._set_focus(index, None)
            await self.channel_layer.group_send(self.group, {
                "type": "fanout",
                "payload": {"type": "focus", "index": index, "elId": el_id, "off": True},
            })
            return

        self._set_focus(index, el_id)
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "focus", "index": index, "elId": el_id, "off": False},
        })

    async def _handle_focus_state(self, data):
        """Answer just the caller: the slide's zoom regions and the live one."""
        index = await self._index_arg(data)
        await self.send_json({
            "type": "focus_state",
            "index": index,
            "regions": await self._focus_regions(index),
            "active": self._get_focus(index) or "",
        })

    async def _handle_actor_action(self, data):
        """Trigger a one-off actor performance on the big screen."""
        index = await self._index_arg(data)
        el_id = str(data.get("elId") or "").strip()[:MAX_EL_ID]
        action = str(data.get("action") or "").strip().lower()
        mood = str(data.get("mood") or "").strip().lower()
        if not el_id or action not in ALLOWED_ACTOR_ACTIONS:
            return
        if mood and mood not in ALLOWED_ACTOR_MOODS:
            mood = ""

        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "actor_action",
                "index": index,
                "elId": el_id,
                "action": action,
                "mood": mood,
            },
        })

    async def _index_arg(self, data):
        """Slide index from a payload, falling back to the live slide."""
        try:
            return max(0, int(data.get("index")))
        except (TypeError, ValueError):
            return await self._current_slide()

    async def _handle_end_show(self):
        """End the presentation for everyone and offer the download QR."""
        info = await self._end_and_download_info()
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "show_ended",
                "download_url": info.get("download_url") or "",
                "allow_download": bool(info.get("allow_download")),
                "title": info.get("title") or "",
            },
        })

    async def _handle_show_download(self, visible):
        info = await self._download_info()
        if visible and not info.get("allow_download"):
            # Owner has not opted in — tell just the caller, don't fan out.
            await self.send_json({
                "type": "download_unavailable",
                "reason": "The deck owner has not enabled audience downloads.",
            })
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "download_qr",
                "visible": bool(visible),
                "download_url": info.get("download_url") or "",
                "title": info.get("title") or "",
            },
        })

    async def _handle_editor_saved(self, data):
        """Fan out a freshly saved deck payload to other live editors."""
        deck = data.get("deck")
        if not isinstance(deck, dict):
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "deck_updated",
                "clientId": str(data.get("clientId") or ""),
                "deck": deck,
            },
        })

    # ── group fanout ─────────────────────────────────────────────────
    async def fanout(self, event):
        await self.send_json(event["payload"])

    async def _broadcast_participants(self):
        count = await self._participant_count()
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "participants", "count": count},
        })

    # ── helpers ──────────────────────────────────────────────────────
    async def send_json(self, obj):
        await self.send(text_data=json.dumps(obj))

    # In-memory headcount per process. For a single-process dev/ASGI server
    # this is exact; behind multiple workers it counts per-worker, the same
    # caveat Boardly's participant count carries. Promote to a Redis/db
    # counter if you run multiple workers and need a global figure.
    _counts = {}
    _reaction_counts_memory = {}

    # {code: {slide_index: {el_id, …}}} — which cue-held elements are
    # currently on the big screen. Same per-process caveat as _counts.
    _revealed = {}

    # {code: {slide_index: el_id}} — the zoom region currently magnified on
    # the big screen. At most one per slide, same per-process caveat.
    _focused = {}

    def _get_focus(self, index):
        return PresentConsumer._focused.setdefault(self.code, {}).get(int(index))

    def _set_focus(self, index, el_id):
        bucket = PresentConsumer._focused.setdefault(self.code, {})
        if el_id:
            bucket[int(index)] = el_id
        else:
            bucket.pop(int(index), None)

    def _reveal_bucket(self, index):
        return PresentConsumer._revealed.setdefault(self.code, {}).setdefault(
            int(index), set()
        )

    def _revealed_list(self, index):
        return sorted(self._reveal_bucket(index))

    def _clear_reveals(self, index):
        PresentConsumer._revealed.setdefault(self.code, {}).pop(int(index), None)

    def _memory_reaction_counts(self, emoji=None):
        bucket = PresentConsumer._reaction_counts_memory.setdefault(self.code, {})
        if emoji:
            bucket[emoji] = int(bucket.get(emoji, 0)) + 1
        return dict(bucket)

    async def _bump_participants(self, delta):
        PresentConsumer._counts[self.code] = max(
            0, PresentConsumer._counts.get(self.code, 0) + delta
        )

    async def _participant_count(self):
        return PresentConsumer._counts.get(self.code, 0)

    # ── DB access (wrapped sync) ─────────────────────────────────────
    @sync_to_async
    def _get_deck(self, code):
        from .models import Deck
        return Deck.objects.filter(code=code).first()

    @sync_to_async
    def _reactions_allowed(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        return bool(d and d.allow_reactions and d.state != "ended")

    @sync_to_async
    def _set_current_slide(self, index):
        from .models import Deck
        Deck.objects.filter(code=self.code).update(current_slide=index)

    @sync_to_async
    def _current_slide(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        return int(d.current_slide) if d else 0

    @sync_to_async
    def _slides(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        return [s.as_dict() for s in d.slides.all()] if d else []

    @sync_to_async
    def _slide(self, index):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {}
        slides = list(d.slides.all())
        if not slides:
            return {}
        index = max(0, min(int(index), len(slides) - 1))
        return slides[index].as_dict()

    @sync_to_async
    def _cue_elements(self, index):
        """Elements on slide <index> that the author marked ``revealOn:"cue"``.

        Returned lean — enough for the phone to draw a labelled button list,
        not the whole element blob.
        """
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return []
        slides = list(d.slides.all())
        if not slides:
            return []
        index = max(0, min(int(index), len(slides) - 1))

        out = []
        for el in (slides[index].data or {}).get("els") or []:
            if not isinstance(el, dict):
                continue
            if str(el.get("revealOn") or "").lower() != "cue":
                continue
            el_id = str(el.get("id") or "").strip()[:MAX_EL_ID]
            if not el_id:
                continue
            out.append({
                "id": el_id,
                "type": str(el.get("type") or ""),
                "objectType": str(el.get("objectType") or ""),
                "label": _cue_label(el),
            })
        return out

    @sync_to_async
    def _focus_regions(self, index):
        """Zoom regions on slide <index> — elements of type "focus".

        Lean, like _cue_elements: the phone needs a labelled button, and
        the stage already holds the full element in its own copy of the
        slide, so geometry never has to travel over the socket.
        """
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return []
        slides = list(d.slides.all())
        if not slides:
            return []
        index = max(0, min(int(index), len(slides) - 1))

        out = []
        for el in (slides[index].data or {}).get("els") or []:
            if not isinstance(el, dict):
                continue
            if str(el.get("type") or "").lower() != "focus":
                continue
            el_id = str(el.get("id") or "").strip()[:MAX_EL_ID]
            if not el_id:
                continue
            label = str(el.get("label") or "").strip() or "Zoom region"
            try:
                zoom = round(float(el.get("zoom") or 2.4), 1)
            except (TypeError, ValueError):
                zoom = 2.4
            out.append({
                "id": el_id,
                "label": label[:48],
                "zoom": zoom,
                "shape": str(el.get("focusShape") or "circle"),
            })
        return out

    @sync_to_async
    def _record_reaction(self, emoji):
        """Persist one reaction and return the latest totals.

        This method is intentionally defensive: if the DeckReaction table has
        not been migrated yet, the caller falls back to in-memory counts instead
        of breaking live reactions.
        """
        from django.db.models import Count
        from .models import Deck, DeckReaction

        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {}

        DeckReaction.objects.create(
            deck=d,
            emoji=emoji,
            slide_index=max(0, int(getattr(d, "current_slide", 0) or 0)),
            nick=(self.nick or "Guest")[:80],
        )

        return {
            row["emoji"]: int(row["total"] or 0)
            for row in DeckReaction.objects.filter(deck=d)
            .values("emoji")
            .annotate(total=Count("id"))
        }

    @sync_to_async
    def _reaction_counts(self):
        from django.db.models import Count
        from .models import Deck, DeckReaction

        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {}
        return {
            row["emoji"]: int(row["total"] or 0)
            for row in DeckReaction.objects.filter(deck=d)
            .values("emoji")
            .annotate(total=Count("id"))
        }

    @sync_to_async
    def _download_info(self):
        """Audience-download details for this deck.

        Returns a ROOT-RELATIVE url; the consumer has no request object, so
        the browser resolves it against its own origin.
        """
        from django.urls import reverse
        from .models import Deck

        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {}
        allow = bool(getattr(d, "allow_download", False))
        url = ""
        if allow:
            url = reverse("hanns:audience_download", kwargs={
                "code": d.code, "token": str(d.download_token),
            })
        return {"allow_download": allow, "download_url": url, "title": d.title}

    @sync_to_async
    def _end_and_download_info(self):
        """Mark the deck ended, then return its download details."""
        from django.urls import reverse
        from .models import Deck

        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {}
        if d.state != "ended":
            d.state = "ended"
            d.save(update_fields=["state"])
        allow = bool(getattr(d, "allow_download", False))
        url = ""
        if allow:
            url = reverse("hanns:audience_download", kwargs={
                "code": d.code, "token": str(d.download_token),
            })
        return {"allow_download": allow, "download_url": url, "title": d.title}

    @sync_to_async
    def _control_pin(self):
        total = sum((i + 1) * ord(ch) for i, ch in enumerate(self.code or "HANNS"))
        return str(1000 + (total % 9000))

    @sync_to_async
    def _can_edit_current_user(self):
        from .models import Deck, DeckCollaborator
        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            return False
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return False
        if d.owner_id == user.id:
            return True
        return DeckCollaborator.objects.filter(
            deck=d,
            user=user,
            permission=DeckCollaborator.PERMISSION_EDIT,
        ).exists()

    @sync_to_async
    def _snapshot(self):
        from django.db.models import Count
        from .models import Deck, DeckReaction
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {"type": "state"}
        try:
            reaction_counts = {
                row["emoji"]: int(row["total"] or 0)
                for row in DeckReaction.objects.filter(deck=d)
                .values("emoji")
                .annotate(total=Count("id"))
            }
        except Exception:
            reaction_counts = dict(PresentConsumer._reaction_counts_memory.get(self.code, {}))
        # A projector that blinks mid-talk must come back with the same
        # elements revealed, not with the slide reset to its held state.
        revealed = sorted(
            PresentConsumer._revealed.get(self.code, {}).get(int(d.current_slide), set())
        )
        return {
            "type": "state",
            "code": d.code,
            "title": d.title,
            "current_slide": d.current_slide,
            "allow_reactions": d.allow_reactions,
            "live": d.state == "live",
            "count": PresentConsumer._counts.get(self.code, 0),
            "reaction_counts": reaction_counts,
            "revealed": revealed,
            # So a projector that reconnects mid-callout puts it straight back.
            "focus": PresentConsumer._focused.get(self.code, {}).get(
                int(d.current_slide)) or "",
        }
