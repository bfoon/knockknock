"""Starter/onboarding deck for first-time Hanns users.

This module creates a polished editable slideshow that teaches the user how
Hanns works using the same slide JSON structure that the editor already saves:
{bg, bgSize, bgFx, transition, notes, els}. No migration is required.
"""

from .models import Deck, Slide

STARTER_TITLE = "Start Here: How to Use Hanns"
STARTER_TAG = "hanns_starter_v1"


def _text(i, x, y, w, h, text, *, size=36, color="#16140f", font='"Inter",sans-serif',
          weight=700, align="left", anim="fade", delay=0, lh=1.15, italic=False, ls=0):
    return {
        "id": f"starter_{i}", "type": "text", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "text": text,
        "font": font, "size": size, "weight": weight, "italic": italic,
        "color": color, "align": align, "lh": lh, "ls": ls, "fill": "none",
    }


def _rect(i, x, y, w, h, *, fill="#e8482b", radius=18, anim="fade", delay=0, opacity=None):
    d = {
        "id": f"starter_{i}", "type": "rect", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "fill": fill,
        "stroke": "none", "strokeW": 0, "radius": radius,
    }
    if opacity is not None:
        d["opacity"] = opacity
    return d


def _ellipse(i, x, y, w, h, *, fill="#e8482b", anim="zoom", delay=0):
    return {
        "id": f"starter_{i}", "type": "ellipse", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "fill": fill,
        "stroke": "none", "strokeW": 0, "radius": 0,
    }


def _line(i, x, y, w, h=5, *, fill="#e8482b", anim="reveal", delay=0):
    return {
        "id": f"starter_{i}", "type": "line", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "fill": fill,
    }


def _object(i, kind, x, y, w, h, *, label=None, count=1, level=0, accent="#4cc9f0",
            show_count=True, hide_container=False, anim="rise", delay=0):
    return {
        "id": f"starter_{i}", "type": "object", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "objectType": kind,
        "label": label or kind.replace("_", " ").title(), "count": count,
        "level": level, "accent": accent, "showCount": show_count,
        "hideContainer": hide_container,
    }


def _shape(i, kind, x, y, w, h, *, fill="#e8482b", opacity=1, rot=0, anim="rise", delay=0):
    return {
        "id": f"starter_{i}", "type": "creative_shape", "x": x, "y": y, "w": w, "h": h,
        "rot": rot, "anim": anim, "animDelay": delay, "shapeType": kind,
        "fill": fill, "stroke": "none", "strokeW": 0, "opacity": opacity,
    }


def _chart(i, x, y, w, h, *, chart_type="bar", title="Sample chart", accent="#e8482b", data=None, anim="rise", delay=0):
    return {
        "id": f"starter_{i}", "type": "chart", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "chartType": chart_type,
        "title": title, "accent": accent, "showValues": True, "showLabels": True,
        "showLegend": False, "labelSize": 22, "gridLines": True, "axisValues": True,
        "seriesNames": ["Series 1", "Series 2", "Series 3"],
        "palette": ["#e8482b", "#22c55e", "#38bdf8", "#f59e0b", "#a855f7"],
        "valuePrefix": "", "valueSuffix": "", "decimals": 0, "unit": "", "max": 100,
        "titleColor": "", "chartThemeMode": "light",
        "chartData": data or [
            {"label": "Templates", "value": 82},
            {"label": "Objects", "value": 68},
            {"label": "Charts", "value": 54},
            {"label": "Live", "value": 76},
        ],
    }


def _table(i, x, y, w, h, *, data, header="#1d4e89", header_text="#ffffff", text="#16140f", anim="rise", delay=0):
    return {
        "id": f"starter_{i}", "type": "table", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "rows": len(data),
        "cols": max(len(r) for r in data), "tableData": data, "header": True,
        "striped": True, "theme": "clean", "font": '"Inter",sans-serif',
        "size": 18, "accent": header, "headerColor": header,
        "headerTextColor": header_text, "textColor": text,
        "borderColor": "rgba(22,20,15,.12)", "rowAltColor": "rgba(29,78,137,.055)",
    }


def _map(i, x, y, w, h, *, title="Gambia map", anim="rise", delay=0):
    return {
        "id": f"starter_{i}", "type": "map", "x": x, "y": y, "w": w, "h": h,
        "rot": 0, "anim": anim, "animDelay": delay, "mapKind": "gambia",
        "title": title, "accent": "#2f6f4f", "showLabels": True,
        "showRiver": True, "useCities": False, "labelSize": 22,
        "mapTheme": "light", "titleColor": "",
        "pins": [
            {"label": "Banjul", "lon": -16.58, "lat": 13.45, "value": 12},
            {"label": "Brikama", "lon": -16.65, "lat": 13.27, "value": 28},
            {"label": "Soma", "lon": -15.53, "lat": 13.43, "value": 18},
            {"label": "Basse", "lon": -14.21, "lat": 13.31, "value": 10},
        ],
    }


def _slide(bg, els, *, bg_size=None, bg_fx="none", transition="fade", notes=""):
    return {
        "bg": bg,
        "bgSize": bg_size,
        "bgFx": bg_fx,
        "transition": transition,
        "notes": notes,
        "els": els,
        "starterTag": STARTER_TAG,
    }


def starter_slides():
    """Return the editable tutorial deck slides."""
    return [
        _slide(
            "radial-gradient(80% 90% at 80% 20%,#e8482b 0%,transparent 55%),linear-gradient(135deg,#16140f,#2c281f)",
            [
                _text(1, 72, 88, 820, 95, "Welcome to Hanns", size=76, color="#fbf8f1", font='"Fraunces",serif', weight=700, anim="rise"),
                _text(2, 78, 190, 710, 92, "Create modern PowerPoint / Canva-style slides inside Knock-Knock.", size=34, color="#f6d5cc", weight=600, anim="fade", delay=.2),
                _line(3, 82, 315, 180, 8, fill="#f2c14e", delay=.35),
                _text(4, 82, 350, 690, 80, "Use templates, objects, charts, tables, maps, animation, live reactions, phone controller and presenter notes.", size=24, color="#cfc6b2", weight=500, anim="fade", delay=.45, lh=1.35),
                _object(5, "water_glass", 690, 255, 180, 220, label="Animated water", level=67, accent="#38bdf8", delay=.3),
            ],
            bg_fx="mesh",
            transition="zoom",
            notes="Start by telling users this deck is editable. They can duplicate it, delete it, or use it to learn Hanns quickly.",
        ),
        _slide(
            "linear-gradient(135deg,#fbf8f1,#f6f1e7)",
            [
                _text(10, 64, 56, 780, 70, "1. Start with templates", size=48, font='"Fraunces",serif', weight=700, anim="rise"),
                _text(11, 68, 125, 780, 54, "Open Templates, choose a layout, then replace the text, numbers and objects.", size=24, color="#3a352a", weight=500, anim="fade", delay=.15),
                _rect(12, 82, 210, 230, 150, fill="linear-gradient(135deg,#0b1d3a,#3b82a0)", radius=20, anim="left", delay=.1),
                _text(13, 105, 240, 185, 80, "Title\nSlide", size=34, color="#ffffff", font='"Fraunces",serif', anim="fade", delay=.3),
                _rect(14, 365, 210, 230, 150, fill="linear-gradient(135deg,#f2c14e,#e8482b)", radius=20, anim="rise", delay=.2),
                _text(15, 390, 245, 180, 70, "Data\nStory", size=34, color="#ffffff", font='"Fraunces",serif', anim="fade", delay=.4),
                _rect(16, 648, 210, 230, 150, fill="linear-gradient(135deg,#2f6f4f,#5b8c5a)", radius=20, anim="right", delay=.3),
                _text(17, 673, 245, 180, 70, "Live\nSession", size=34, color="#ffffff", font='"Fraunces",serif', anim="fade", delay=.5),
                _text(18, 105, 400, 730, 55, "Tip: duplicate a good slide and edit it instead of starting from blank every time.", size=23, color="#16140f", weight=700, align="center", anim="fade", delay=.55),
            ],
            bg_fx="noise",
            transition="slide",
            notes="Explain that templates are the fastest way to build polished sessions.",
        ),
        _slide(
            "radial-gradient(70% 80% at 20% 20%,#38bdf8 0%,transparent 55%),linear-gradient(145deg,#0b1020,#111827)",
            [
                _text(20, 58, 58, 820, 70, "2. Add animated objects", size=48, color="#ffffff", font='"Fraunces",serif', anim="rise"),
                _text(21, 62, 124, 780, 52, "Use objects to explain quantity, percentage, growth, agriculture, environment and people.", size=23, color="#cfe7ff", weight=500, anim="fade", delay=.15),
                _object(22, "water_glass", 75, 210, 180, 230, label="Water level", level=74, accent="#38bdf8", delay=.2),
                _object(23, "seed_pile", 300, 215, 220, 220, label="Seeds", count=28, accent="#7fb069", delay=.35),
                _object(24, "farmer", 570, 215, 220, 220, label="Farmers", count=5, accent="#f59e0b", delay=.5),
                _object(25, "bugs", 780, 238, 125, 175, label="Bugs", count=16, accent="#a855f7", delay=.65, hide_container=True),
            ],
            bg_fx="bubbles",
            transition="push",
            notes="Show how objects can have percentage levels or counts, and how the container box can be hidden.",
        ),
        _slide(
            "linear-gradient(135deg,#f6f1e7,#fff7ed)",
            [
                _text(30, 64, 54, 820, 64, "3. Edit text like a designer", size=46, font='"Fraunces",serif', anim="rise"),
                _text(31, 70, 130, 370, 140, "Double-click text to edit. Click away to move it again.", size=38, color="#16140f", font='"Playfair Display",serif', italic=True, weight=700, anim="left", lh=1.1),
                _text(32, 70, 310, 360, 110, "Change font, colour, alignment, size, line height and animation from the inspector.", size=24, color="#3a352a", weight=500, anim="fade", delay=.25, lh=1.35),
                _rect(33, 505, 120, 320, 250, fill="#16140f", radius=28, anim="right"),
                _text(34, 535, 160, 260, 70, "Fonts", size=50, color="#fbf8f1", font='"Bebas Neue",sans-serif', weight=700, ls=2, anim="fade", delay=.3),
                _text(35, 535, 235, 260, 90, "Inter · Poppins · Fraunces · Playfair · Orbitron · Caveat", size=22, color="#cfc6b2", font='"Inter",sans-serif', weight=600, anim="fade", delay=.45, lh=1.3),
            ],
            bg_fx="drift",
            transition="fade",
            notes="Remind users that text now moves normally after editing.",
        ),
        _slide(
            "linear-gradient(135deg,#0f172a,#1e293b)",
            [
                _text(40, 60, 52, 760, 65, "4. Use charts and graphs", size=48, color="#ffffff", font='"Fraunces",serif', anim="rise"),
                _text(41, 64, 118, 720, 44, "Build bar, line, pie, donut, gauge, funnel, heatmap, treemap and KPI slides.", size=22, color="#cbd5e1", weight=500, anim="fade", delay=.15),
                _chart(42, 70, 190, 380, 260, chart_type="bar", title="Feature adoption", accent="#38bdf8", delay=.25),
                _chart(43, 515, 190, 360, 260, chart_type="donut", title="Deck composition", accent="#e8482b", data=[{"label":"Visuals","value":46},{"label":"Data","value":24},{"label":"Live","value":18},{"label":"Notes","value":12}], delay=.4),
            ],
            bg_fx="grid",
            transition="slide",
            notes="Tell users they can paste chart data or import CSV/Excel where supported.",
        ),
        _slide(
            "linear-gradient(145deg,#fbf8f1,#f6f1e7)",
            [
                _text(50, 60, 50, 810, 64, "5. Tables for reports", size=48, font='"Fraunces",serif', anim="rise"),
                _text(51, 64, 112, 770, 45, "Paste table data or import CSV/Excel, then style the header and text colours.", size=22, color="#3a352a", weight=500, anim="fade", delay=.15),
                _table(52, 110, 190, 735, 245, data=[
                    ["Item", "Q1", "Q2", "Q3"],
                    ["Rice", "45", "52", "61"],
                    ["Maize", "30", "38", "44"],
                    ["Groundnut", "22", "28", "35"],
                    ["Total", "97", "118", "140"],
                ], header="#2563eb", delay=.25),
                _text(53, 120, 462, 720, 34, "Use the inspector to change header colour, font colour, borders and striped rows.", size=18, color="#16140f", weight=700, align="center", anim="fade", delay=.55),
            ],
            bg_fx="noise",
            transition="fade",
            notes="Point out the import button and the table styling options.",
        ),
        _slide(
            "linear-gradient(135deg,#ecfeff,#f0fdf4)",
            [
                _text(60, 60, 52, 790, 65, "6. Maps and location stories", size=46, font='"Fraunces",serif', anim="rise"),
                _text(61, 64, 112, 700, 44, "Add map pins to show sites, regions, training locations, field activity or project impact.", size=21, color="#164e63", weight=600, anim="fade", delay=.15),
                _map(62, 120, 175, 680, 300, title="Training sites", delay=.25),
                _object(63, "tree", 770, 75, 145, 160, label="Trees", count=7, accent="#16a34a", hide_container=True, delay=.5),
            ],
            bg_fx="waves",
            transition="push",
            notes="Explain pins and labels. This is useful for agriculture, training, logistics and community projects.",
        ),
        _slide(
            "radial-gradient(60% 70% at 80% 10%,#f59e0b 0%,transparent 55%),linear-gradient(135deg,#111827,#020617)",
            [
                _text(70, 62, 54, 820, 65, "7. Animate your story", size=48, color="#ffffff", font='"Fraunces",serif', anim="rise"),
                _text(71, 66, 120, 760, 48, "Each element can fade, rise, drop, slide, pop, zoom, blur or reveal.", size=24, color="#fef3c7", weight=600, anim="fade", delay=.15),
                _shape(72, "burst_01", 90, 230, 160, 160, fill="#f59e0b", opacity=.95, rot=-10, anim="pop", delay=.2),
                _shape(73, "blob_01", 310, 225, 180, 170, fill="#38bdf8", opacity=.85, rot=12, anim="zoom", delay=.35),
                _shape(74, "ribbon_01", 545, 235, 190, 150, fill="#e8482b", opacity=.9, rot=-4, anim="left", delay=.5),
                _text(75, 100, 425, 720, 42, "Use motion to guide attention — not to overload the slide.", size=24, color="#ffffff", weight=700, align="center", anim="fade", delay=.65),
            ],
            bg_fx="stars",
            transition="zoom",
            notes="Encourage light, purposeful animations.",
        ),
        _slide(
            "linear-gradient(145deg,#fefce8,#fff7ed)",
            [
                _text(80, 58, 50, 830, 64, "8. Present live", size=48, font='"Fraunces",serif', anim="rise"),
                _text(81, 63, 112, 720, 48, "Click Present. Your audience can scan the QR code and send reactions.", size=23, color="#3a352a", weight=600, anim="fade", delay=.15),
                _rect(82, 95, 200, 260, 250, fill="#16140f", radius=30, anim="left", delay=.2),
                _text(83, 128, 226, 200, 36, "SCAN", size=24, color="#f6f1e7", weight=800, align="center", anim="fade", delay=.35),
                _rect(84, 145, 275, 120, 120, fill="#ffffff", radius=12, anim="zoom", delay=.45),
                _text(85, 160, 305, 90, 60, "QR", size=40, color="#16140f", weight=900, align="center", anim="fade", delay=.55),
                _text(86, 435, 225, 390, 190, "❤️  👏  🔥  🎉\nLive emoji reactions float on the presenter screen.", size=38, color="#16140f", font='"Poppins",sans-serif', weight=700, align="center", anim="right", delay=.3, lh=1.35),
            ],
            bg_fx="confetti",
            transition="slide",
            notes="Open the QR modal during a real presentation so participants can join.",
        ),
        _slide(
            "linear-gradient(135deg,#0f2a22,#2f6f4f)",
            [
                _text(90, 58, 52, 840, 66, "9. Phone controller + notes", size=48, color="#ffffff", font='"Fraunces",serif', anim="rise"),
                _text(91, 62, 116, 765, 55, "Connect your phone, move slides, read private presenter notes and point to an area on the projector.", size=23, color="#d1fae5", weight=600, anim="fade", delay=.15),
                _rect(92, 105, 205, 230, 250, fill="#0b1410", radius=34, anim="left", delay=.25),
                _text(93, 130, 235, 180, 52, "Phone\nController", size=33, color="#ffffff", font='"Fraunces",serif', align="center", anim="fade", delay=.4),
                _text(94, 128, 320, 185, 64, "Next · Previous\nNotes · Preview\nPointer", size=20, color="#b7f7d0", align="center", weight=700, anim="fade", delay=.5, lh=1.35),
                _text(95, 420, 230, 395, 150, "Presenter notes are saved per slide and only shown on your controller phone.", size=34, color="#ffffff", font='"Inter",sans-serif', weight=800, anim="right", delay=.3, lh=1.15),
            ],
            bg_fx="orbit",
            transition="push",
            notes="This slide demonstrates that notes are private and controlled from the phone controller.",
        ),
        _slide(
            "linear-gradient(135deg,#fbf8f1,#f1f5f9)",
            [
                _text(100, 58, 50, 830, 65, "10. Collaborate and save", size=46, font='"Fraunces",serif', anim="rise"),
                _text(101, 62, 112, 760, 48, "Invite Knock-Knock users to live-edit the deck. If they do not have an account, they receive a signup invite.", size=22, color="#334155", weight=600, anim="fade", delay=.15),
                _rect(102, 80, 210, 235, 160, fill="#e8482b", radius=26, anim="left", delay=.25),
                _text(103, 105, 250, 185, 54, "Invite", size=38, color="#ffffff", font='"Poppins",sans-serif', align="center", anim="fade", delay=.4),
                _rect(104, 365, 210, 235, 160, fill="#1d4e89", radius=26, anim="rise", delay=.35),
                _text(105, 388, 250, 190, 54, "Autosave", size=34, color="#ffffff", font='"Poppins",sans-serif', align="center", anim="fade", delay=.5),
                _rect(106, 650, 210, 235, 160, fill="#2f6f4f", radius=26, anim="right", delay=.45),
                _text(107, 680, 250, 175, 54, "Undo / Redo", size=30, color="#ffffff", font='"Poppins",sans-serif', align="center", anim="fade", delay=.6),
            ],
            bg_fx="drift",
            transition="fade",
            notes="Mention Ctrl+S, Ctrl+Z, Ctrl+C, Ctrl+V and live collaboration.",
        ),
        _slide(
            "radial-gradient(70% 80% at 15% 20%,#5b8c5a 0%,transparent 55%),radial-gradient(60% 70% at 80% 20%,#e8482b 0%,transparent 55%),#16140f",
            [
                _text(110, 72, 82, 825, 90, "You are ready", size=76, color="#fbf8f1", font='"Fraunces",serif', weight=700, align="center", anim="zoom"),
                _text(111, 115, 190, 730, 80, "Duplicate this deck, edit the slides, and use it as your first presentation.", size=30, color="#f6d5cc", weight=600, align="center", anim="fade", delay=.2, lh=1.25),
                _object(112, "people", 150, 315, 180, 160, label="Audience", count=12, accent="#38bdf8", hide_container=True, delay=.3),
                _object(113, "tree", 390, 315, 180, 160, label="Ideas", count=5, accent="#22c55e", hide_container=True, delay=.45),
                _object(114, "glass_cup", 625, 305, 190, 175, label="Create", count=1, accent="#f59e0b", hide_container=True, delay=.6),
            ],
            bg_fx="rays",
            transition="zoom",
            notes="Finish by inviting the user to duplicate the tutorial or create a new deck.",
        ),
    ]


def create_starter_deck(user):
    deck = Deck.objects.create(
        owner=user,
        title=STARTER_TITLE,
        state="draft",
        allow_reactions=True,
    )
    Slide.objects.bulk_create([
        Slide(deck=deck, position=i, data=slide)
        for i, slide in enumerate(starter_slides())
    ])
    return deck


def ensure_hanns_starter_deck(user):
    """Create the tutorial as the first deck for a user who has no owned deck."""
    if not getattr(user, "is_authenticated", False):
        return None
    owned = Deck.objects.filter(owner=user)
    if owned.exists():
        return None
    return create_starter_deck(user)
