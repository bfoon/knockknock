# 🚪 Knock-Knock

A real-time interactive presentation & quiz platform — think **Mentimeter** meets **Kahoot**, built with Django, Channels, Bootstrap 5, and Docker.

## ✨ Features

### 🎤 Knock-Knock Menti (Polls / Questionnaires)
- Create questionnaires with multiple question types (Multiple Choice, Word Cloud, Scale, Open Text, Ranking)
- 20+ visual templates with logo upload
- Per-question chart selection (Bar, Donut, Pie, Word Cloud, Map, Line, Radar...)
- Live chart preview with sample data before going live
- **Orchestra Mode**: presenter controls slide progression, participants follow in lockstep
- **Open Mode**: participants self-pace
- Live drawing tools on charts (free hand, highlighter, shapes, eraser)
- Fullscreen presentation, group display (all charts on one screen)
- QR code + 6-digit code join

### 🎮 Knock-Knock Game (Kahoot-style)
- Fast-paced quiz competitions
- Avatar selection (dragon, sword, butterfly, spacecraft, dinosaurs, joker mask...)
- Speed-based scoring or accuracy-based scoring
- **Rooms** (limited members, average-score based) or **Open**
- Live leaderboard with full-screen projection mode
- QR code join

### 🎲 Live Tables (board-game nights) — `/tabletop/`
- **Chess, Dam, Ludo and Scramble** played from phones, with the featured table in **3D on the big screen** next to a live leaderboard
- Host deals everyone into tables (random or **by leaderboard rank**); points carry across rounds — win 3 · draw 1, or 3/2/1 in 3–4 player games — plus a ⚔️ count of pieces cut down
- Server-authoritative rules in `tabletop/engines/` (full chess incl. castling/en passant/promotion; international 10×10 Dam with flying kings and the majority-capture rule; Ludo with server dice; Scramble checked against the public-domain ENABLE word list)
- Captures are a little duel: the attacker leaps in, a glowing sword swings and the victim is **sliced in two** along the blade (real clipping planes); every piece breathes, blinks and watches the action
- Phones: tap-to-move boards that face the player, dice / tile rack controls, spectate any table, emoji reactions on the projector
- Big-screen views: split · board · ranks podium · all tables (keys 1–4, ← → to change table, auto-camera cuts to the action)

### 🦸 Hero Forge (3D avatars)
- Full-body game-style characters: 4 bodies × 14 skins × 10 hair × 12 hair colours × 6 eyes × 10 outfits (incl. kaftan) × 12 colours × 12 headwear (incl. kufi & headwrap) × 10 items (incl. kora) × 6 auras
- Modelled in Blender from code: `tools/blender/build_tabletop_assets.py` → `static/tabletop/models/*.glb`
  (`blender -b -P tools/blender/build_tabletop_assets.py`, then commit the .glb files)
- Works in the quiz game too (new **🦸 3D Hero** tab on the join screen); ids look like `kh-0350241520` and fit the existing avatar columns

## 🧱 Stack

| Layer | Tech |
|---|---|
| Backend | Django 5, Django Channels 4 |
| Real-time | WebSockets via Redis channel layer |
| Frontend | Bootstrap 5, Chart.js, Vanilla JS |
| Async runtime | Daphne (ASGI) |
| Database | PostgreSQL |
| Cache / Pub-Sub | Redis |
| Containerization | Docker + docker-compose |
| QR | `qrcode` library |

## 🚀 Quick Start

```bash
# Clone, then:
cp .env.example .env
docker compose up --build
# Open http://localhost:8000
```

Create an admin: `docker compose exec web python manage.py createsuperuser`

## 🗂️ App Structure

```
config/         # Django settings, ASGI, routing
accounts/       # User auth, profile, logo upload
core/           # Templates registry, dashboard, marketing pages
polls/          # Knock-Knock Menti (questionnaires)
games/          # Knock-Knock Game (Kahoot-style)
presentations/  # Live sessions, WebSocket consumers (shared by both)
templates/      # Server-rendered HTML
static/         # CSS, JS, images
```

## 🔌 WebSocket Routes

- `ws/present/<session_code>/` — presenter control channel
- `ws/play/<session_code>/` — participant channel
- `ws/draw/<session_code>/` — drawing overlay broadcast
- `ws/tabletop/<code>/` — Live Tables (stage, phones, spectators)

## 📐 Modes

| Mode | Polls | Games |
|---|---|---|
| **Orchestra** | Presenter advances; participants locked to current question | Same |
| **Open** | Participants self-pace | Participants race; first-correct gets points |
| **Rooms** | — | Limited members, average score wins |

## 📅 Roadmap

- [ ] More question types (image-choice, hotspot)
- [ ] Export results to CSV/PDF
- [ ] Team mode (rooms with shared scores)
- [ ] AI question generation
