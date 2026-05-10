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
