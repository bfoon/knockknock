"""Big screen · a Microsoft Teams meeting, opened from the control board.

Teams can't be embedded inside another web page (Microsoft forbids framing it),
so the projector opens the meeting in its OWN window, sized to the screen, and
the control board opens and closes it — like the YouTube player, but the
meeting lives in a window next to the big-screen page instead of inside it.

What the host can give us — whatever is easiest:
  • the whole invitation text, pasted from Outlook / Teams
        "Meeting ID: 381 234 567 890 1   Passcode: aB3dE5"
  • a join link: teams.microsoft.com/l/meetup-join/…, teams.microsoft.com/meet/…,
    teams.live.com/meet/… (Teams free), teams.cloud.microsoft/…
  • an Outlook "Safe Links" wrapped link (unwrapped to the real one)
  • just the meeting ID + passcode (work/school or personal)

Only real Teams hosts are ever opened, so the big screen can't be sent anywhere
else.

Why the meeting is also captured INTO the big screen: once a pop-up lands on a
site that isolates itself from its opener (Microsoft's sites commonly do), the
browser cuts the link — the projector page then can't see or close that window
any more. So after joining, one click on the projector ("Show it inside the big
screen") captures the Teams window and shows it as a scene of the big screen.
From then on the control board switches freely between Teams and Knock Knock
while the meeting keeps running.

Stored in ScreenStyle.settings["teams"]:
  {"on": bool        a meeting is running on this screen
   "shown": bool     it's what the big screen shows right now
   "mode": "" | "window" | "inside"   how the projector has it (it reports this)
   "url", "label", "id", "kind", "since"}
"""

import re
from urllib.parse import parse_qs, quote, urlparse

from django.utils import timezone

TEAMS_HOSTS = ("teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft")
KINDS = ("work", "personal")
_URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]]+", re.I)
_ID_RE = re.compile(r"(?:meeting\s*id|id\s*de\s*r[ée]union|meeting-id)\s*[:#]?\s*([\d][\d \u00a0]{7,30}\d)", re.I)
_PASS_RE = re.compile(r"(?:pass\s*code|passcode|code\s*secret|password)\s*[:#]?\s*([A-Za-z0-9]{1,30})", re.I)


class TeamsError(Exception):
    pass


def _style(screen_id):
    from .models import ScreenStyle
    style, _ = ScreenStyle.objects.get_or_create(screen_id=screen_id, defaults={"settings": {}})
    return style


def _host_ok(host):
    host = (host or "").lower().split(":")[0]
    return any(host == h or host.endswith("." + h) for h in TEAMS_HOSTS)


def _unwrap(url):
    """Outlook Safe Links → the link inside them."""
    p = urlparse(url)
    if p.netloc.lower().endswith("safelinks.protection.outlook.com"):
        inner = (parse_qs(p.query).get("url") or [""])[0]
        if inner:
            return inner
    return url


def _fmt_id(digits):
    return " ".join(digits[i:i + 3] for i in range(0, len(digits), 3))


def parse(invite="", meeting_id="", passcode="", kind="work"):
    """Whatever the host pasted → {"url", "label", "id", "kind"}. Raises TeamsError."""
    text = str(invite or "")
    kind = kind if kind in KINDS else "work"
    # 1. a link in the text (possibly Safe-Links-wrapped)
    for raw in _URL_RE.findall(text):
        url = _unwrap(raw.rstrip(".,;:!?>"))
        p = urlparse(url)
        if p.scheme in ("http", "https") and _host_ok(p.netloc):
            digits = re.sub(r"\D", "", (re.search(r"/meet/(\d+)", p.path) or [None, ""])[1] or "")
            m_id = _ID_RE.search(text)
            digits = digits or (re.sub(r"\D", "", m_id.group(1)) if m_id else "")
            label = f"Teams meeting {_fmt_id(digits)}" if digits else "Teams meeting"
            return {"url": "https://" + p.netloc.lower() + p.path + (("?" + p.query) if p.query else ""),
                    "label": label, "id": digits, "kind": "personal" if "teams.live.com" in p.netloc.lower() else "work"}
    if _URL_RE.search(text) and not meeting_id:
        raise TeamsError("That link isn't a Microsoft Teams meeting link.")
    # 2. meeting ID + passcode (typed, or found in a pasted invitation)
    m_id = _ID_RE.search(text)
    digits = re.sub(r"\D", "", str(meeting_id or "") or (m_id.group(1) if m_id else "") or
                    (text if re.fullmatch(r"[\d \u00a0-]+", text.strip() or "x") else ""))
    m_pass = _PASS_RE.search(text)
    code = str(passcode or "").strip() or (m_pass.group(1) if m_pass else "")
    if "teams.live.com" in text.lower():
        kind = "personal"
    if not digits:
        raise TeamsError("Paste the invitation, a Teams link, or the meeting ID.")
    if not 9 <= len(digits) <= 20:
        raise TeamsError("A Teams meeting ID has 10–15 digits.")
    if not code:
        raise TeamsError("Add the meeting passcode (it's under the meeting ID in the invitation).")
    if not re.fullmatch(r"[A-Za-z0-9]{1,30}", code):
        raise TeamsError("The passcode is letters and numbers only.")
    host = "teams.live.com" if kind == "personal" else "teams.microsoft.com"
    return {"url": f"https://{host}/meet/{digits}?p={quote(code)}", "label": f"Teams meeting {_fmt_id(digits)}",
            "id": digits, "kind": kind}


def state_for(screen_id):
    """What the projector and control board see."""
    from .models import ScreenStyle
    style = ScreenStyle.objects.filter(screen_id=screen_id).first()
    t = dict(((style.settings or {}).get("teams") or {}) if style else {})
    on = bool(t.get("on") and t.get("url"))
    return {"on": on, "shown": bool(on and t.get("shown", True)), "mode": (t.get("mode") or "") if on else "",
            "label": t.get("label") or "", "id": t.get("id") or "", "since": t.get("since") or "",
            "url": t["url"] if on else "", "kind": t.get("kind") or "work"}


def act(screen_id, data):
    """Board: open (with what the host pasted) / show / hide / close.  check = parse only.
    Projector: report {mode: "window" | "inside"}."""
    action = str(data.get("action") or "")
    style = _style(screen_id)
    t = dict((style.settings or {}).get("teams") or {})
    if action in ("open", "check"):
        got = parse(data.get("invite"), data.get("id"), data.get("passcode"), data.get("kind"))
        if data.get("label"):
            got["label"] = " ".join(str(data["label"]).split())[:60]
        if action == "check":
            return dict(got, on=t.get("on", False))
        t = dict(got, on=True, shown=True, mode="", since=timezone.now().isoformat())
    elif action in ("show", "hide"):
        if not t.get("on"):
            raise TeamsError("No Teams meeting is running on this screen.")
        t["shown"] = action == "show"
    elif action == "report":
        if data.get("mode") not in ("window", "inside"):
            raise TeamsError("Unknown mode.")
        if t.get("on"):
            t["mode"] = data["mode"]
    elif action in ("close", "closed"):
        t.update(on=False, shown=False, mode="")
    else:
        raise TeamsError("Unknown action.")
    style.settings = dict(style.settings or {}, teams=t)
    style.save(update_fields=["settings", "updated_at"])
    return state_for(screen_id)
