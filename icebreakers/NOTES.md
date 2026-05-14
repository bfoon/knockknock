# Icebreakers — Integration Notes

A new standalone Django app you drop into your Knock-Knock project.
It adds 8 projection-first icebreaker games launched from a dashboard
tile.

## What's in the box

```
icebreakers/
├── __init__.py
├── apps.py                          IcebreakersConfig
├── games.py                         catalog metadata (8 games)
├── urls.py                          /icebreakers/ + /icebreakers/play/<id>/
├── views.py                         @login_required catalog + play
├── templates/icebreakers/
│   ├── catalog.html                 game grid with filter chips
│   └── play.html                    full-screen runner shell
└── static/icebreakers/
    ├── css/
    │   ├── catalog.css              premium dark grid UI
    │   └── runner.css               full-screen game shell
    └── js/
        ├── catalog.js               filter chip behavior
        ├── runner.js                shell controller + module loader
        └── games/
            ├── _helpers.js          shared utilities
            ├── posture_reset.js     🧘 60s seated stretches w/ 3D figure
            ├── two_truths.js        🎭 voting + animated card flips
            ├── reaction_race.js     ⚡ 3D pulsing orb, ms reaction time
            ├── common_ground.js     🎲 rotating 3D bingo cube
            ├── mood_constellation.js ✨ 3D starfield mood map
            ├── conductor.js         🎼 rhythm/baton metronome
            ├── desk_yoga.js         🌿 4-station yoga w/ 3D figure
            └── word_chain.js        🔗 flowing 3D word chain
```

## Wiring it in (3 steps)

### 1. Drop the app folder

Copy the entire `icebreakers/` directory into your project root —
right next to `core/`, `easyoffice/`, etc.

### 2. Register in settings.py

```python
INSTALLED_APPS = [
    # ... existing apps
    "icebreakers.apps.IcebreakersConfig",
]
```

### 3. Wire URLs in your root urls.py

```python
urlpatterns = [
    # ... existing routes
    path("icebreakers/", include("icebreakers.urls", namespace="icebreakers")),
]
```

That's it. Visit `/icebreakers/` to see the catalog, click any tile to launch.

## Add a tile to the dashboard

Drop this anywhere on your dashboard template:

```html
<a href="{% url 'icebreakers:catalog' %}" class="kk-dashboard-tile" style="--a:#22d3ee; --b:#7c3aed;">
  <div class="kk-dashboard-tile-icon">🧊</div>
  <div>
    <h3>Icebreakers</h3>
    <p>Wake the room up — 8 projection games</p>
  </div>
</a>
```

(Style it to match your existing dashboard tiles — the `--a` / `--b`
CSS variables drive the gradient.)

## Run collectstatic

```bash
python manage.py collectstatic --noinput
```

## How the runner finds game modules

`runner.js` dispatches to game modules using:

```js
const moduleUrl = new URL(`games/${gameId}.js`, import.meta.url).href;
```

This means the runner.js file must be served from the same static URL
prefix as the `games/` folder. Django's `staticfiles` handles this
automatically.

## What "phone mode" does (and doesn't, yet)

Some games show a **📱 Enable phones** button in the top bar:

- `two_truths` — voting on which statement is the bluff
- `reaction_race` — each phone is a player tapping
- `mood_constellation` — phones submit words + energy scores
- `word_chain` — phones add to the chain

Right now, **the toggle is cosmetic**: it displays a fake 6-digit code
and reveals the participant counter. The button confirms "Phones on"
visually but no WebSocket session is created.

To make it real, wire `runner.js`'s `phonesBtn` click handler to:

1. POST `/api/sessions/` (or your equivalent) → returns `{ session_code, ws_url }`
2. Open the WebSocket
3. On each `participant_join` message: `ctx.setPhoneCount(n)`
4. On each `submission` message: dispatch to the active game module
   via a small event bus (`ctx.onPhoneSubmit(cb)` — easy to add)

You already have all the infrastructure for this from Mentis. The
runner's `ctx` object is designed to make this a 30-minute task.

The presenter-only mode of every game works fully today — you can ship
this immediately and add phones incrementally.

## Design philosophy

- **Calm professional, not a kids' party** — no rainbow confetti, no
  bouncing emoji, no "WOOHOO". Every game stays grown-up.
- **Screen is the source of truth** — everyone copies what's on the
  big screen, not each other. No awkwardness about who's leading.
- **Mix of seated + standing** — the catalog tags each game so a
  host can pick by physical context.
- **Gentle intensity throughout** — no jumping jacks, no shouting.
- **3D when it earns it** — Three.js for posture/yoga/reaction/cube,
  not for things that already look great in 2D (two_truths cards).

## Browser support

- Three.js r128 (loaded from CDN in play.html)
- ES modules with dynamic import — works in every modern browser
- CSS `color-mix()` — Chrome 111+, Safari 16.4+, Firefox 113+
- `body:has()` for nav hiding — Chrome 105+, Safari 15.4+, Firefox 121+

All supported by Knock-Knock's existing target browsers.

## Adding a 9th game

1. Append an entry to `GAMES` in `games.py` (id, name, emoji, etc).
2. Create `static/icebreakers/js/games/<your_id>.js` exporting
   `default function init(ctx)`.
3. Use the `_helpers.js` utilities (`el`, `makeButton`, `countdown`,
   `speak`).
4. Run `collectstatic`.

The catalog page auto-discovers from the list, so no template edits.
