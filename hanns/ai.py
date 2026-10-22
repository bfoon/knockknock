"""
Hanns AI Studio — server-side Gemini engine.

Why server-side
───────────────
The old "✦ AI Design" button called api.anthropic.com straight from the
browser with no key, so on nokknock.app it could never work. Every AI call
now goes through Django: the Gemini key lives only in the server's .env, the
browser never sees it, and each request is permission-checked against the
deck and rate-limited per user.

Free-tier design (Google AI Studio key)
───────────────────────────────────────
* Text models (Flash / Flash-Lite) are free; image models are NOT. So the
  "AI backgrounds" are painted as SVG vector art written by the model —
  free, razor-sharp on a projector, and tiny to store.
* Each model has its own free quota. `HANNS_AI_MODELS` is a fallback chain:
  when one model answers 429 (quota) / 404 (retired) / 5xx, the next one is
  tried, which stretches the free allowance a long way.
* Model names change (Gemini 2.5 was shut down 16 Oct 2026), so the default
  chain starts with the `gemini-flash-latest` alias and can be overridden
  from .env without a code change.

.env
────
    GEMINI_API_KEY=your-key-from-aistudio.google.com
    # optional:
    HANNS_AI_MODELS=gemini-flash-latest,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest
    HANNS_AI_HOURLY_LIMIT=40

Note: on Google's free tier, prompts and outputs may be used by Google to
improve its products. The Studio UI tells authors this.
"""

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

logger = logging.getLogger(__name__)

# Override only for a proxy or a local test double.
API_ROOT = os.environ.get("HANNS_AI_API_ROOT", "https://generativelanguage.googleapis.com/v1beta/models").rstrip("/")
DEFAULT_MODELS = "gemini-flash-latest,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest"


class AIError(Exception):
    """A user-presentable failure (shown in the Studio as-is)."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ─────────────────────────── configuration ───────────────────────────

def _setting(name, default=""):
    val = getattr(settings, name, None)
    if val in (None, ""):
        val = os.environ.get(name, default)
    return val


def api_key():
    return (_setting("GEMINI_API_KEY") or "").strip()


def is_enabled():
    return bool(api_key())


def model_chain():
    raw = _setting("HANNS_AI_MODELS", DEFAULT_MODELS) or DEFAULT_MODELS
    return [m.strip() for m in str(raw).split(",") if m.strip()]


def hourly_limit():
    try:
        return max(1, int(_setting("HANNS_AI_HOURLY_LIMIT", "40")))
    except (TypeError, ValueError):
        return 40


# ─────────────────────────── rate limiting ───────────────────────────

def _bucket(user_id):
    return f"hanns-ai:{user_id}:{int(time.time() // 3600)}"


def quota_left(user_id):
    used = cache.get(_bucket(user_id), 0) or 0
    return max(0, hourly_limit() - int(used))


def take_quota(user_id):
    key = _bucket(user_id)
    if cache.add(key, 1, 3700):
        used = 1
    else:
        try:
            used = cache.incr(key)
        except ValueError:
            cache.set(key, 1, 3700)
            used = 1
    if used > hourly_limit():
        raise AIError(
            f"You've used your {hourly_limit()} AI requests for this hour. "
            "They refill at the top of the hour.", status=429)
    return hourly_limit() - used


# ─────────────────────────── Gemini client ───────────────────────────

# Total time one Studio request may spend talking to Gemini, across every
# model and retry. Kept under typical proxy timeouts (nginx's default is 60 s
# per read; raise it to 180 s for /hanns/ — see the deploy notes) so the
# browser always gets a clear JSON answer instead of a dropped connection.
TIME_BUDGET = float(os.environ.get("HANNS_AI_TIME_BUDGET", "150"))


def _post(model, payload, timeout=90):
    req = urllib.request.Request(
        f"{API_ROOT}/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key()},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            body = {}
        return e.code, body
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, {"error": {"message": str(e)}}


def _extract_text(data):
    out = []
    for cand in data.get("candidates") or []:
        for part in ((cand.get("content") or {}).get("parts") or []):
            if part.get("thought"):
                continue
            if isinstance(part.get("text"), str):
                out.append(part["text"])
        if out:
            break
    return "".join(out).strip()


def _parse_json(text):
    t = (text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except ValueError:
        pass
    # Last resort: the outermost {...}
    start, end = t.find("{"), t.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(t[start:end + 1])
        except ValueError:
            pass
    raise AIError("The AI returned something that wasn't valid slide data. Try again — it usually works on a second go.")


def gemini_json(system, user, temperature=0.9, max_tokens=8192):
    """Ask Gemini for JSON, walking the model chain. Returns (data, model)."""
    if not is_enabled():
        raise AIError("AI isn't switched on for this server yet. Add GEMINI_API_KEY to the .env file.", status=503)

    base = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
    }
    # Most → least demanding request shape. Newer models accept all of it;
    # if a model rejects a field (400) we retry the same model, simpler.
    shapes = [
        {"temperature": temperature, "maxOutputTokens": max_tokens,
         "responseMimeType": "application/json", "thinkingConfig": {"thinkingLevel": "low"}},
        {"temperature": temperature, "maxOutputTokens": max_tokens, "responseMimeType": "application/json"},
        {"temperature": temperature, "maxOutputTokens": max_tokens},
    ]

    last_error = "No AI model answered."
    quota_hit = False
    timed_out = False
    status = None
    started = time.monotonic()
    for model in model_chain():
        for cfg in shapes:
            remaining = TIME_BUDGET - (time.monotonic() - started)
            if remaining < 8:
                timed_out = True
                break
            status, data = _post(model, dict(base, generationConfig=cfg), timeout=min(120, remaining))
            if status == 200:
                text = _extract_text(data)
                if not text:
                    reason = ((data.get("candidates") or [{}])[0].get("finishReason") or
                              (data.get("promptFeedback") or {}).get("blockReason") or "empty")
                    last_error = f"The AI returned no content ({reason})."
                    break  # try the next model
                return _parse_json(text), model
            msg = ((data or {}).get("error") or {}).get("message", "") or f"HTTP {status}"
            last_error = msg
            if status == 400:
                continue          # simpler request shape, same model
            if status == 429:
                quota_hit = True
            break                 # 401/403/404/429/5xx/network → next model
        if status in (401, 403):
            raise AIError("Gemini rejected the API key. Check GEMINI_API_KEY in the .env file.", status=503)
        if timed_out:
            break

    logger.warning("Hanns AI: every model failed — %s", last_error)
    if timed_out or (status == 0 and "timed out" in last_error.lower()):
        raise AIError("Gemini is taking too long right now. Try again, or ask for fewer slides.", status=504)
    if quota_hit:
        raise AIError("Gemini's free quota is used up for now on every model. Try again in a minute, "
                      "or tomorrow if the daily limit was reached.", status=429)
    raise AIError("The AI service didn't answer: " + last_error[:200])


# ─────────────────────────── shared design brief ───────────────────────────
# Keep these lists in step with hanns_core.js (ANIMS, TRANSITIONS, BG_FX,
# FONTS, FREEFORM_KINDS) and the chart kinds in hanns_editor.js. The browser
# validates everything again against the live catalogues before applying.

ANIMS = ["fade", "rise", "drop", "left", "right", "zoom", "pop", "blur", "reveal", "revealUp",
         "bounce", "elastic", "flipx", "flipy", "spin", "skew", "blurzoom", "typewriter", "float", "none"]
TRANSITIONS = ["fade", "slide", "push", "zoom", "flip", "reveal", "paper_grab", "paper_pull",
               "shatter", "burn", "wind", "curtain", "fold", "dissolve", "swipe", "none"]
BG_FX = ["none", "drift", "gradient", "stars", "bokeh", "waves", "bubbles", "grid", "rays",
         "confetti", "snow", "rain", "orbit", "pulse", "mesh", "noise"]
FONTS = ["Fraunces Editorial", "Archivo Clean", "Archivo Expanded", "Spline Mono", "Inter", "Manrope",
         "Poppins", "Montserrat", "Roboto", "Open Sans", "Lato", "Nunito Sans", "Raleway", "Playfair Display"]
FREEFORM = ["polygon", "star", "burst", "blob", "arrow", "chevron", "cross", "bubble", "wave", "heart", "drop"]
CHARTS = ["bar", "lollipop", "combo", "line", "spline", "area", "pie", "donut", "radar", "gauge",
          "progress", "funnel", "waterfall", "treemap", "kpi"]

SCHEMA = f"""
CANVAS: 960 x 540 px. Origin top-left. Keep text inside the safe area x 48..912, y 36..504.

SLIDE object:
{{"bg": CSS background (gradients welcome, no url()), "bgFx": one of {BG_FX},
  "transition": one of {TRANSITIONS}, "notes": "speaker notes (2-4 sentences)", "els": [elements]}}

ELEMENT common fields: "type", "x","y","w","h" (px), "rot" (deg, default 0),
  "anim": one of {ANIMS}, "animDelay": seconds 0..3 (stagger 0.12-0.25 for a cinematic build),
  optional "fx": {{"shadow":bool,"sblur":0-40,"scolor":"rgba(..)","glow":bool,"gsize":4-30,"gcolor":"#hex",
                  "d3":bool,"rx":-30..30,"ry":-30..30,"depth":0-12,"blend":"normal|multiply|screen|overlay|soft-light"}}

TYPES:
- "text": "text" (use \\n for line breaks), "font": one of {FONTS}, "size": 12-200, "weight": 300-900,
  "italic": bool, "color": "#hex", "align": "left|center|right", "lh": 0.9-1.8, "ls": letter-spacing px -2..12,
  "fill": "none" or "#hex" (pill/label background)
- "rect": "fill": "#hex" or "rgba()", "stroke": "#hex|none", "strokeW": 0-12, "radius": 0-200
- "ellipse": "fill", "stroke", "strokeW"
- "line": "fill": "#hex" (a thin bar: make h 2-8)
- "freeform": "shapeKind": one of {FREEFORM}, "sides": 3-12, "inset": 0.2-0.8, "smooth": bool,
  "fillMode": "solid|linear|radial|none", "fill": "#hex", "fill2": "#hex", "gradAngle": 0-360,
  "stroke": "#hex|none", "strokeW": 0-10
- "chart": "chartKind": one of {CHARTS}, "title": short, "chartData": [{{"label":str,"value":number}}] (3-7 items),
  "accent": "#hex", "palette": ["#hex",...], "valueSuffix": "%" or "", "chartThemeMode": "light|dark"

DESIGN RULES:
- Think like a top agency designer: strong hierarchy, generous whitespace, one focal point per slide.
- Headlines 54-110px, body 20-30px, never more than ~40 words of body text on a slide.
- High contrast: text must be clearly readable against the background.
- Layer decorative shapes (low-opacity rgba fills, blobs, rules) BEHIND text — list them first in "els".
- Vary layouts across a deck (split, centered hero, big number, quote, grid, timeline) — never repeat one twice in a row.
- Choreograph: background shapes enter first, then headline, then supporting text, then data.
"""

SYSTEM_BASE = (
    "You are Hanns AI, a world-class presentation designer and storyteller inside the Hanns slide editor. "
    "You return ONLY one JSON object — no markdown, no commentary. Every colour is a CSS colour string. "
    "Write content in the same language as the user's request unless asked to translate.\n" + SCHEMA
)


# ─────────────────────────── SVG backgrounds ───────────────────────────

SVG_TAGS = {
    "svg", "g", "defs", "linearGradient", "radialGradient", "stop", "rect", "circle", "ellipse",
    "line", "polyline", "polygon", "path", "filter", "feGaussianBlur", "feTurbulence",
    "feColorMatrix", "feOffset", "feBlend", "feComposite", "feDisplacementMap", "feMerge",
    "feMergeNode", "feFlood", "feDropShadow", "pattern", "clipPath", "mask", "use", "title", "desc",
    "animate", "animateTransform",
}
SVG_NS = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"


def _local(tag):
    return tag.split("}", 1)[1] if tag.startswith("{") else tag


def sanitize_svg(svg_text, max_bytes=90_000):
    """Return a safe, standalone SVG string or raise AIError.

    Allow-list based: unknown elements are dropped, event handlers and any
    external reference (href / url() not pointing at a local #id) are
    removed, and DTDs/entities are refused outright. The result is safe to
    serve from /media even if someone opens it directly in a browser.
    """
    s = (svg_text or "").strip()
    s = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", s)
    if not s or len(s.encode("utf-8")) > max_bytes:
        raise AIError("The AI background was empty or too large. Try again.")
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", s, re.I):
        raise AIError("The AI background contained unsafe markup and was rejected.")
    start = s.find("<svg")
    if start < 0:
        raise AIError("The AI didn't return an SVG background. Try again.")
    s = s[start:s.rfind("</svg>") + 6]
    try:
        root = ET.fromstring(s)
    except ET.ParseError:
        raise AIError("The AI background wasn't valid SVG. Try again — it usually works on a second go.")

    def urls_ok(val):
        # Every url(...) in the value must reference a local #id.
        for ref in re.findall(r"url\(([^)]*)\)", val, re.I):
            if not ref.strip().strip("'\"").startswith("#"):
                return False
        return True

    def clean(node):
        for child in list(node):
            if _local(child.tag) not in SVG_TAGS:
                node.remove(child)
                continue
            clean(child)
        for attr in list(node.attrib):
            name = _local(attr).lower()
            val = node.attrib[attr]
            low = val.lower()
            if (name.startswith("on")
                    or (name == "href" and not val.strip().startswith("#"))
                    or not urls_ok(val)
                    or "javascript:" in low or "expression(" in low or "@import" in low):
                del node.attrib[attr]

    if _local(root.tag) != "svg":
        raise AIError("The AI didn't return an SVG background. Try again.")
    clean(root)
    root.set("viewBox", root.get("viewBox") or "0 0 1600 900")
    root.set("preserveAspectRatio", "xMidYMid slice")
    for a in ("width", "height"):
        if a in root.attrib:
            del root.attrib[a]
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK)
    out = ET.tostring(root, encoding="unicode")
    if "xmlns=" not in out[:200]:
        out = out.replace("<svg", f'<svg xmlns="{SVG_NS}"', 1)
    return out


def save_svg(deck_code, svg):
    rel = f"hanns/decks/{deck_code}/ai/{uuid.uuid4().hex}.svg"
    saved = default_storage.save(rel, ContentFile(svg.encode("utf-8")))
    url = default_storage.url(saved)
    if not url.startswith(("http://", "https://", "//")):
        url = url if url.startswith("/") else "/" + url
    return url


HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def _palette(vals, fallback=("#1e1b4b", "#7c3aed", "#f472b6")):
    out = [v for v in (vals or []) if isinstance(v, str) and HEX.match(v.strip())]
    return out[:6] or list(fallback)


# ─────────────────────────── slide digests ───────────────────────────
# Send the model a compact view of slides: enough to understand and
# restyle them, without image data URIs or chart internals bloating the prompt.

KEEP_KEYS = {"id", "type", "x", "y", "w", "h", "rot", "text", "font", "size", "weight", "italic",
             "color", "align", "fill", "stroke", "radius", "anim", "animDelay", "chartKind", "title",
             "shapeKind", "kind"}


def digest_slide(slide, index=None, with_ids=True):
    els = []
    for el in (slide or {}).get("els") or []:
        if not isinstance(el, dict):
            continue
        d = {k: el[k] for k in KEEP_KEYS if k in el}
        if not with_ids:
            d.pop("id", None)
        if isinstance(d.get("text"), str) and len(d["text"]) > 400:
            d["text"] = d["text"][:400] + "…"
        if el.get("type") == "image":
            d["image"] = "photo"
        for k in ("x", "y", "w", "h", "rot", "size"):
            if isinstance(d.get(k), float):
                d[k] = round(d[k])
        els.append(d)
    out = {"els": els[:40]}
    bg = str((slide or {}).get("bg") or "")
    out["bg"] = "custom image" if "url(" in bg else bg[:240]
    out["bgFx"] = (slide or {}).get("bgFx") or "none"
    out["transition"] = (slide or {}).get("transition") or "fade"
    if index is not None:
        out["index"] = index
    return out


def deck_outline(slides, limit=30):
    lines = []
    for i, s in enumerate((slides or [])[:limit]):
        texts = [str(e.get("text", "")).replace("\n", " ")[:90]
                 for e in (s.get("els") or []) if isinstance(e, dict) and e.get("type") == "text" and e.get("text")]
        lines.append(f"{i + 1}. " + (" | ".join(texts[:3]) or "(visual slide)"))
    return "\n".join(lines)


# ─────────────────────────── actions ───────────────────────────

TONES = {"bold": "bold, confident, high-energy", "elegant": "elegant, editorial, refined",
         "playful": "playful, warm, colourful", "corporate": "clean, corporate, trustworthy",
         "minimal": "minimal, calm, lots of whitespace", "dark": "dramatic, cinematic, dark-mode"}


def _tone(opts):
    return TONES.get(str(opts.get("tone") or "bold"), TONES["bold"])


def action_deck(p):
    topic = str(p.get("prompt") or "").strip()[:1500]
    if len(topic) < 3:
        raise AIError("Tell the AI what the presentation is about.", status=400)
    n = max(3, min(12, int(p.get("count") or 6)))
    audience = str(p.get("audience") or "a general audience")[:200]
    system = SYSTEM_BASE + """
TASK: Build a complete, story-driven deck.
Return: {"theme": {"name": str, "palette": ["#hex" x5], "headFont": font, "bodyFont": font},
         "slides": [SLIDE, ...]}
Story arc: hook title → context/problem → key insights (use a chart or big number where data helps) →
solution/plan → impact → memorable closing/call to action. One idea per slide. Use one consistent
palette and font pair across the deck, but vary the layouts. Write real, specific content (not lorem ipsum);
where you invent illustrative numbers, keep them plausible and say so in that slide's notes.
"""
    user = (f"Topic: {topic}\nAudience: {audience}\nStyle: {_tone(p)}\nNumber of slides: exactly {n}\n"
            "Make it look like it was designed by a top agency.")
    data, model = gemini_json(system, user, temperature=0.95, max_tokens=16000)
    slides = data.get("slides") if isinstance(data, dict) else None
    if not isinstance(slides, list) or not slides:
        raise AIError("The AI didn't return any slides. Try rephrasing the topic.")
    return {"theme": data.get("theme") or {}, "slides": slides[:n]}, model


def action_slide(p):
    want = str(p.get("prompt") or "").strip()[:1500]
    if len(want) < 3:
        raise AIError("Describe the slide you want.", status=400)
    ctx = p.get("slide")
    system = SYSTEM_BASE + """
TASK: Design ONE outstanding slide. Return: {"slide": SLIDE}
If CURRENT SLIDE content is given and the request is about improving it, keep its message and facts.
"""
    user = f"Request: {want}\nStyle: {_tone(p)}\n"
    if ctx:
        user += "CURRENT SLIDE: " + json.dumps(digest_slide(ctx, with_ids=False))[:6000]
    if p.get("outline"):
        user += "\nDECK SO FAR (for context and consistent style):\n" + str(p["outline"])[:3000]
    data, model = gemini_json(system, user, temperature=0.95, max_tokens=8192)
    slide = data.get("slide") if isinstance(data, dict) else None
    if not isinstance(slide, dict):
        slide = data if isinstance(data, dict) and "els" in data else None
    if not slide:
        raise AIError("The AI didn't return a slide. Try again.")
    return {"slide": slide}, model


def action_background(p, deck_code):
    mood = str(p.get("prompt") or "").strip()[:800] or "abstract, modern, elegant"
    style = str(p.get("style") or "auto")[:40]
    content = str(p.get("outline") or "")[:1500]
    system = """You are a master generative-art designer. You paint presentation backgrounds as pure SVG code.
Return ONLY JSON: {"variants": [VARIANT, VARIANT, VARIANT], "textTone": "light|dark"}
VARIANT = {"name": short evocative name, "svg": "<svg ...>...</svg>", "palette": ["#hex" x3-5],
           "bgFx": one of """ + str(BG_FX) + """, "text": "#hex best text colour on it"}
The three variants are one coherent family for a deck: 1) TITLE (most dramatic), 2) CONTENT (calmer, lots of
quiet negative space so text stays readable — keep the centre and left side low-contrast), 3) CLOSING (celebratory/uplifting).
SVG RULES: viewBox="0 0 1600 900", no width/height attributes, NO text, NO images, NO external references,
NO scripts. Use rich techniques: layered linear/radial gradients, soft blurred orbs (feGaussianBlur),
flowing bezier waves, topographic contour lines, geometric tessellations, grain via feTurbulence at low opacity,
subtle depth and glow. Fill the entire canvas (start with a full-size rect). Keep each SVG under 12 KB:
favour a few elegant shapes over hundreds of tiny ones. It must look premium, like Apple keynote or Stripe art.
"""
    user = f"Mood / subject: {mood}\nArt style: {style}\n"
    if content:
        user += f"The deck is about:\n{content}\n"
    data, model = gemini_json(system, user, temperature=1.0, max_tokens=16000)
    raw = (data or {}).get("variants") if isinstance(data, dict) else None
    if not isinstance(raw, list) or not raw:
        raise AIError("The AI didn't paint any backgrounds. Try again.")
    out = []
    for i, v in enumerate(raw[:3]):
        if not isinstance(v, dict):
            continue
        try:
            svg = sanitize_svg(v.get("svg"))
        except AIError as e:
            logger.info("Hanns AI: dropped background variant %s: %s", i, e)
            continue
        pal = _palette(v.get("palette"))
        url = save_svg(deck_code, svg)
        grad = f"linear-gradient(135deg,{pal[0]},{pal[min(1, len(pal) - 1)]} 55%,{pal[-1]})"
        out.append({
            "name": str(v.get("name") or f"Variant {i + 1}")[:40],
            "url": url,
            # SVG on top, a matching gradient underneath: the gradient shows
            # while the SVG loads and is what PowerPoint export falls back to.
            "bg": f'url("{url}") center / cover no-repeat, {grad}',
            "palette": pal,
            "bgFx": v.get("bgFx") if v.get("bgFx") in BG_FX else "none",
            "text": v.get("text") if isinstance(v.get("text"), str) and HEX.match(v["text"]) else None,
        })
    if not out:
        raise AIError("The AI's backgrounds didn't pass the safety check. Try again.")
    return {"variants": out, "textTone": "dark" if (data or {}).get("textTone") == "dark" else "light"}, model


def action_polish(p):
    slides = p.get("slides") or []
    if not slides:
        raise AIError("Nothing to polish.", status=400)
    fix_text = bool(p.get("fixText"))
    system = SYSTEM_BASE + f"""
TASK: You are cleaning up existing slides like a senior designer doing a final pass.
Return: {{"slides": [{{"index": int, "els": [{{"id": same id, ...only the fields you change}}], "bg": optional, "bgFx": optional}}]}}
- Align elements to a clean grid (consistent left margins, equal gaps), fix overlaps and anything off-canvas.
- Establish a clear type hierarchy (consistent sizes/weights/fonts across slides), fix poor contrast.
- Tidy colours into one harmonious palette.
- Keep every element and its meaning. Never invent new facts. Keep ids exactly.
- {"You MAY fix typos, grammar and tighten wording in 'text' (keep meaning, keep language)." if fix_text else "Do NOT change any 'text' field."}
"""
    digests = [digest_slide(s.get("slide") or s, s.get("index")) for s in slides[:12]]
    data, model = gemini_json(system, "SLIDES:\n" + json.dumps(digests)[:30000], temperature=0.4, max_tokens=16000)
    return {"slides": (data or {}).get("slides") or [], "fixText": fix_text}, model


def action_decorate(p):
    slides = p.get("slides") or []
    if not slides:
        raise AIError("Nothing to decorate.", status=400)
    style = str(p.get("prompt") or p.get("style") or "tasteful modern accents")[:400]
    system = SYSTEM_BASE + """
TASK: Add decoration to existing slides without touching their content.
Return: {"slides": [{"index": int, "add": [ELEMENT...], "bgFx": optional, "bg": optional}]}
- 2-6 decorative elements per slide: rect/ellipse/line/freeform only (no text, no charts).
- Place them where they frame the content (corners, edges, behind headings) — never covering text.
  Use low-opacity rgba fills or thin strokes so the content stays dominant.
- Give them gentle entrances (fade/zoom/float, animDelay 0-0.3) so they arrive before the content.
- Keep a consistent decorative language across all slides.
"""
    digests = [digest_slide(s.get("slide") or s, s.get("index")) for s in slides[:12]]
    user = f"Decoration style: {style}\nSLIDES:\n" + json.dumps(digests)[:30000]
    data, model = gemini_json(system, user, temperature=0.9, max_tokens=16000)
    return {"slides": (data or {}).get("slides") or []}, model


def action_animate(p):
    slides = p.get("slides") or []
    if not slides:
        raise AIError("Nothing to animate.", status=400)
    energy = str(p.get("style") or "cinematic")[:40]
    system = SYSTEM_BASE + f"""
TASK: Choreograph animation like a motion designer. Energy: {energy}.
Return: {{"slides": [{{"index": int, "transition": one of {TRANSITIONS}, "bgFx": one of {BG_FX},
  "els": [{{"id": same id, "anim": one of {ANIMS}, "animDelay": seconds}}]}}]}}
- Build order tells the story: backdrop shapes → headline → supporting text → data/visuals → call to action.
- Match motion to meaning (numbers pop/zoom, timelines slide left→right, quotes typewriter or blur).
- Vary transitions across the deck; save dramatic ones (shatter, curtain, burn, paper_grab) for 1-2 key moments.
- Keep total build per slide under ~2.5 s. Use bgFx sparingly and only where it adds mood.
"""
    digests = [digest_slide(s.get("slide") or s, s.get("index")) for s in slides[:20]]
    data, model = gemini_json(system, "SLIDES:\n" + json.dumps(digests)[:30000], temperature=0.7, max_tokens=12000)
    return {"slides": (data or {}).get("slides") or []}, model


def action_ideas(p):
    outline = str(p.get("outline") or "")[:4000]
    focus = str(p.get("prompt") or "")[:600]
    system = SYSTEM_BASE + """
TASK: Be a creative director reviewing this deck.
Return: {"verdict": "one encouraging, specific sentence about the deck",
         "ideas": [{"title": short, "why": one sentence, "prompt": "a detailed instruction to design that slide",
                    "position": "after slide N" or "end"} x5-6],
         "headlines": ["sharper alternative headline for the deck title" x3],
         "tips": ["specific improvement tip" x3]}
Ideas should be surprising and specific: a striking stat slide, an interactive question for the audience,
a before/after, a story moment, a visual metaphor, a strong closing.
"""
    user = f"DECK OUTLINE:\n{outline or '(empty deck)'}\n" + (f"\nThe author wants: {focus}" if focus else "")
    data, model = gemini_json(system, user, temperature=1.0, max_tokens=6000)
    return data if isinstance(data, dict) else {}, model


def action_notes(p):
    slides = p.get("slides") or []
    if not slides:
        raise AIError("No slides to write notes for.", status=400)
    style = str(p.get("style") or "conversational")[:40]
    system = SYSTEM_BASE + """
TASK: Write speaker notes the presenter can read from the teleprompter.
Return: {"slides": [{"index": int, "notes": "3-6 natural spoken sentences, with one [pause] cue where it lands"}]}
Expand on what's on the slide — add the story, the "why", a transition line into the next slide. Don't just read the slide back.
"""
    digests = [digest_slide(s.get("slide") or s, s.get("index"), with_ids=False) for s in slides[:25]]
    data, model = gemini_json(system, f"Tone: {style}\nSLIDES:\n" + json.dumps(digests)[:30000],
                              temperature=0.8, max_tokens=12000)
    return {"slides": (data or {}).get("slides") or []}, model


def action_rewrite(p):
    text = str(p.get("text") or "").strip()[:2000]
    if not text:
        raise AIError("Select a text box first.", status=400)
    how = str(p.get("style") or "punchier")[:200]
    system = ("You are Hanns AI, an expert copywriter for presentation slides. Return ONLY JSON: "
              '{"options": ["rewrite 1", "rewrite 2", "rewrite 3"]}. Each option must fit on a slide '
              "(similar length or shorter than the original unless asked), keep line breaks sensible, keep facts.")
    data, model = gemini_json(system, f"Rewrite this slide text — {how}:\n\n{text}", temperature=1.0, max_tokens=2000)
    opts = [str(o)[:2000] for o in ((data or {}).get("options") or []) if isinstance(o, (str, int, float))]
    if not opts:
        raise AIError("The AI didn't return any rewrites. Try again.")
    return {"options": opts[:4]}, model


ACTIONS = {
    "deck": action_deck, "slide": action_slide, "polish": action_polish, "decorate": action_decorate,
    "animate": action_animate, "ideas": action_ideas, "notes": action_notes, "rewrite": action_rewrite,
}


def run(action, payload, deck_code):
    if action == "background":
        return action_background(payload, deck_code)
    fn = ACTIONS.get(action)
    if not fn:
        raise AIError("Unknown AI action.", status=400)
    return fn(payload)
