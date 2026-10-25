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


def fallback_provider():
    """Optional OpenAI-compatible provider tried after Gemini (Groq, OpenRouter,
    Mistral, Together, a local Ollama…). Set in .env:
        HANNS_AI_FALLBACK_URL=https://api.groq.com/openai/v1/chat/completions
        HANNS_AI_FALLBACK_KEY=…
        HANNS_AI_FALLBACK_MODEL=llama-3.3-70b-versatile
    """
    url = (_setting("HANNS_AI_FALLBACK_URL") or "").strip()
    model = (_setting("HANNS_AI_FALLBACK_MODEL") or "").strip()
    if not url or not model:
        return None
    return {"url": url, "key": (_setting("HANNS_AI_FALLBACK_KEY") or "").strip(), "model": model}


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
    if not isinstance(data, dict):
        return ""
    for cand in data.get("candidates") or []:
        if not isinstance(cand, dict):
            continue
        for part in ((cand.get("content") or {}).get("parts") or []):
            if not isinstance(part, dict) or part.get("thought"):
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


def _error_message(data, status):
    """Google's error body is usually {"error": {"message": …}}, but be ready
    for a list, a bare string or HTML from a proxy."""
    if isinstance(data, list) and data:
        data = data[0]
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or f"HTTP {status}")
        if isinstance(err, str):
            return err
    return f"HTTP {status}"


def _cooling(model):
    return bool(cache.get(f"hanns-ai:cool:{model}"))


def _cool(model, seconds):
    cache.set(f"hanns-ai:cool:{model}", 1, seconds)


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
    chain = model_chain()
    # Models that just said "quota used up" are skipped for a couple of
    # minutes. If ALL of them are cooling down, don't waste the user's time
    # re-asking Gemini — go straight to the next fallback layer.
    live = [m for m in chain if not _cooling(m)]
    if not live:
        raise AIError("Gemini's free quota is used up for now on every model. Try again in a minute, "
                      "or tomorrow if the daily limit was reached.", status=429)
    for model in live:
        retried = False
        for cfg in shapes:
            remaining = TIME_BUDGET - (time.monotonic() - started)
            if remaining < 8:
                timed_out = True
                break
            status, data = _post(model, dict(base, generationConfig=cfg), timeout=min(120, remaining))
            if status in (500, 502, 503) and not retried and remaining > 20:
                # "The model is overloaded" is common on the free tier and
                # usually clears within seconds.
                retried = True
                time.sleep(2)
                status, data = _post(model, dict(base, generationConfig=cfg), timeout=min(120, remaining - 2))
            if status == 200:
                text = _extract_text(data)
                if not text:
                    cand = ((data or {}).get("candidates") or [{}]) if isinstance(data, dict) else [{}]
                    reason = ((cand[0] if isinstance(cand[0], dict) else {}).get("finishReason")
                              or ((data or {}).get("promptFeedback") or {}).get("blockReason") if isinstance(data, dict) else None) or "empty"
                    last_error = f"The AI returned no content ({reason})."
                    break  # try the next model
                try:
                    return _parse_json(text), model
                except AIError as e:
                    last_error = str(e)
                    break  # malformed JSON from this model: try the next one
            last_error = _error_message(data, status)
            if status == 400:
                continue          # simpler request shape, same model
            if status == 429:
                quota_hit = True
                _cool(model, 120)
            elif status == 404:
                _cool(model, 6 * 3600)   # retired model name
            break                 # 401/403/404/429/5xx/network → next model
        if status in (401, 403):
            raise AIError("Gemini rejected the API key. Check GEMINI_API_KEY in the .env file.", status=503)
        if timed_out:
            break

    logger.warning("Hanns AI: every Gemini model failed — %s", last_error)
    if timed_out or (status == 0 and "timed out" in last_error.lower()):
        raise AIError("Gemini is taking too long right now. Try again, or ask for fewer slides.", status=504)
    if quota_hit:
        raise AIError("Gemini's free quota is used up for now on every model. Try again in a minute, "
                      "or tomorrow if the daily limit was reached.", status=429)
    raise AIError("The AI service didn't answer: " + last_error[:200])


def openai_compatible_json(system, user, temperature=0.9, max_tokens=8192):
    """The optional second provider (any OpenAI-compatible chat endpoint)."""
    fb = fallback_provider()
    if not fb:
        raise AIError("No fallback AI provider configured.", status=503)
    body = {"model": fb["model"], "temperature": temperature, "max_tokens": min(max_tokens, 8000),
            "messages": [{"role": "system", "content": system + "\nReply with ONE JSON object only."},
                         {"role": "user", "content": user}]}
    headers = {"Content-Type": "application/json"}
    if fb["key"]:
        headers["Authorization"] = f"Bearer {fb['key']}"
    req = urllib.request.Request(fb["url"], data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=min(90, TIME_BUDGET)) as resp:
            data = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise AIError(f"Fallback AI answered HTTP {e.code}.", status=502)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        raise AIError(f"Fallback AI unreachable: {e}", status=502)
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise AIError("Fallback AI returned no content.", status=502)
    return _parse_json(text), "fallback:" + fb["model"]


def ai_json(system, user, temperature=0.9, max_tokens=8192):
    """Gemini first, then the optional second provider."""
    try:
        return gemini_json(system, user, temperature, max_tokens)
    except AIError as first:
        if first.status == 400 or not fallback_provider():
            raise
        logger.warning("Hanns AI: Gemini failed (%s) — trying the fallback provider", first)
        try:
            return openai_compatible_json(system, user, temperature, max_tokens)
        except AIError as second:
            logger.warning("Hanns AI: fallback provider failed too — %s", second)
            raise first


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


DEFAULTS = {"rot": 0, "italic": False, "animDelay": 0, "stroke": "none", "fill": "none", "radius": 0}


def compact(d):
    """Drop fields at their default value — big decks fit far more slides per request."""
    return {k: v for k, v in d.items() if not (k in DEFAULTS and v == DEFAULTS[k])}


# ─────────────────────────── waves (big decks) ───────────────────────────
# One huge request used to carry the whole deck: the prompt was cut at 30 000
# characters (≈ 6-10 real slides) and the reply ran out of tokens part-way, so
# "whole deck" only ever touched the first handful of slides. Now each request
# takes a WAVE of slides that comfortably fits; the browser sends the rest in
# later waves (it gets them back in `pending`) and carries a style guide from
# wave to wave so the deck stays consistent.

WAVE_CHARS = 14_000     # slide digests per request
WAVE_MAX = 6            # slides per request


def take_wave(slides, with_ids=True):
    """Split [{index, slide}] into (digests for this request, pending indexes)."""
    digests, pending, used = [], [], 0
    for item in slides or []:
        if not isinstance(item, dict):
            continue
        idx = item.get("index")
        d = digest_slide(item.get("slide") or item, idx, with_ids=with_ids)
        d["els"] = [compact(e) for e in d["els"]]
        size = len(json.dumps(d))
        if digests and (used + size > WAVE_CHARS or len(digests) >= WAVE_MAX):
            pending.append(idx)
            continue
        digests.append(d)
        used += size
    return digests, pending


def _guide_block(p):
    guide = str(p.get("guide") or "").strip()[:1500]
    deck = str(p.get("outline") or "").strip()[:2500]
    out = ""
    if deck:
        out += "\nWHOLE DECK (for context — you only edit the slides listed below):\n" + deck + "\n"
    if guide:
        out += "\nDECK STYLE GUIDE (already applied to other slides of this deck — follow it exactly):\n" + guide + "\n"
    return out


GUIDE_ASK = ('Also return "guide": 2-4 short lines recording the concrete style decisions you made '
             "(fonts, sizes, colours, spacing, decorative motifs) so later batches of this deck match.")


def deck_outline(slides, limit=30):
    lines = []
    for i, s in enumerate((slides or [])[:limit]):
        texts = [str(e.get("text", "")).replace("\n", " ")[:90]
                 for e in (s.get("els") or []) if isinstance(e, dict) and e.get("type") == "text" and e.get("text")]
        lines.append(f"{i + 1}. " + (" | ".join(texts[:3]) or "(visual slide)"))
    return "\n".join(lines)


# ─────────────────────────── actions ───────────────────────────

def _list(v):
    return [x for x in v if isinstance(x, dict) or isinstance(x, str)] if isinstance(v, list) else []


def _obj(data, key):
    """Models sometimes return a bare list (or wrap the object one level
    deeper). Normalise to a dict that has `key`."""
    if isinstance(data, list):
        return {key: data}
    if isinstance(data, dict):
        if key in data:
            return data
        for v in data.values():
            if isinstance(v, dict) and key in v:
                return v
        return data
    return {}

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
    data, model = ai_json(system, user, temperature=0.95, max_tokens=16000)
    data = _obj(data, "slides")
    slides = data.get("slides")
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
    data, model = ai_json(system, user, temperature=0.95, max_tokens=8192)
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
    data, model = ai_json(system, user, temperature=1.0, max_tokens=16000)
    data = _obj(data, "variants")
    raw = data.get("variants")
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
    digests, pending = take_wave(slides)
    system += GUIDE_ASK
    data, model = ai_json(system, _guide_block(p) + "SLIDES:\n" + json.dumps(digests), temperature=0.4, max_tokens=16000)
    data = _obj(data, "slides")
    return {"slides": _list(data.get("slides")), "fixText": fix_text, "pending": pending,
            "guide": str(data.get("guide") or "")[:1500]}, model


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
    digests, pending = take_wave(slides)
    system += GUIDE_ASK
    user = f"Decoration style: {style}\n" + _guide_block(p) + "SLIDES:\n" + json.dumps(digests)
    data, model = ai_json(system, user, temperature=0.9, max_tokens=16000)
    data = _obj(data, "slides")
    return {"slides": _list(data.get("slides")), "pending": pending, "guide": str(data.get("guide") or "")[:1500]}, model


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
    digests, pending = take_wave(slides)
    data, model = ai_json(system, _guide_block(p) + "SLIDES:\n" + json.dumps(digests), temperature=0.7, max_tokens=12000)
    return {"slides": _list(_obj(data, "slides").get("slides")), "pending": pending}, model


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
    data, model = ai_json(system, user, temperature=1.0, max_tokens=6000)
    return _obj(data, "ideas"), model


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
    digests, pending = take_wave(slides, with_ids=False)
    data, model = ai_json(system, f"Tone: {style}\n" + _guide_block({"outline": p.get("outline")}) + "SLIDES:\n" + json.dumps(digests),
                          temperature=0.8, max_tokens=12000)
    return {"slides": _list(_obj(data, "slides").get("slides")), "pending": pending}, model


def action_rewrite(p):
    text = str(p.get("text") or "").strip()[:2000]
    if not text:
        raise AIError("Select a text box first.", status=400)
    how = str(p.get("style") or "punchier")[:200]
    system = ("You are Hanns AI, an expert copywriter for presentation slides. Return ONLY JSON: "
              '{"options": ["rewrite 1", "rewrite 2", "rewrite 3"]}. Each option must fit on a slide '
              "(similar length or shorter than the original unless asked), keep line breaks sensible, keep facts.")
    data, model = ai_json(system, f"Rewrite this slide text — {how}:\n\n{text}", temperature=1.0, max_tokens=2000)
    opts = [str(o)[:2000] for o in _list(_obj(data, "options").get("options")) if isinstance(o, (str, int, float))]
    if not opts:
        raise AIError("The AI didn't return any rewrites. Try again.")
    return {"options": opts[:4]}, model


def action_edit(p):
    want = str(p.get("prompt") or "").strip()[:1500]
    slides = p.get("slides") or []
    system = SYSTEM_BASE + """
TASK: Apply the author's INSTRUCTION to each slide listed. Change ONLY what the instruction asks for.
Return: {"slides": [{"index": int,
                     "els": [{"id": same id, ...only the fields you change (text allowed if the instruction is about wording)}],
                     "add": [new ELEMENT, ...], "remove": [ids to delete],
                     "bg": optional, "bgFx": optional, "transition": optional, "notes": optional}],
         "guide": "..."}
- Keep every id exactly. Never invent facts. Keep the slide's language unless asked to translate.
- New elements must fit on the canvas and must not cover existing text.
- Return an entry for EVERY slide listed. If the instruction doesn't apply to a slide, return {"index": i, "unchanged": true}.
- Treat every slide consistently (same sizes/colours/positions for the same kind of change).
""" + GUIDE_ASK
    digests, pending = take_wave(slides)
    user = f"INSTRUCTION: {want}\n" + _guide_block(p) + "SLIDES:\n" + json.dumps(digests)
    data, model = ai_json(system, user, temperature=0.5, max_tokens=16000)
    data = _obj(data, "slides")
    return {"slides": _list(data.get("slides")), "pending": pending, "guide": str(data.get("guide") or "")[:1500]}, model


def _region(p):
    r = p.get("region") or {}
    try:
        x, y, w, h = (max(0, min(lim, int(float(r.get(k, 0))))) for k, lim in (("x", 960), ("y", 540), ("w", 960), ("h", 540)))
    except (TypeError, ValueError):
        raise AIError("Draw an area on the slide first.", status=400)
    w, h = min(w, 960 - x), min(h, 540 - y)
    if w < 24 or h < 16:
        raise AIError("That area is too small — drag a bigger box.", status=400)
    return x, y, w, h


ILLUSTRATION_RULES = """ILLUSTRATION SVG RULES: viewBox="0 0 {w} {h}" exactly, no width/height attributes, NO text, NO images,
NO external references, NO scripts. Flat modern vector illustration (like Stripe / Notion / Headspace art):
simple confident shapes, a limited palette that matches the slide, soft gradients and gentle shadows,
clear silhouette that reads at a glance from the back of a room. Transparent background unless a backdrop is asked for.
Keep it under 14 KB — a few well-drawn shapes beat hundreds of tiny ones."""


def action_region(p, deck_code):
    want = str(p.get("prompt") or "").strip()[:1200]
    x, y, w, h = _region(p)
    mode = p.get("mode") if p.get("mode") in ("auto", "design", "illustration") else "auto"
    slide = p.get("slide") or {}
    system = SYSTEM_BASE + f"""
TASK: The author highlighted a REGION of the current slide and asked for something to be put there.
REGION: x={x}, y={y}, w={w}, h={h} (slide pixels). Everything you create must fit INSIDE it.
Return: {{"els": [ELEMENT, ...], "illustration": null or {{"svg": "<svg ...>...</svg>", "alt": short description}},
          "caption": "what you made, in a few words"}}
- Match the slide: reuse its fonts, colours and style so the addition looks like it was always there.
- Fill the region well (aim to use 80-100% of it) with a clear hierarchy; text must be readable at that size.
- Don't repeat text that's already on the slide outside the region.
""" + ("- The author wants a PICTURE: return an illustration (and at most a small caption text element).\n" if mode == "illustration" else
       "- Build it from elements only (text, shapes, charts) — no illustration.\n" if mode == "design" else
       "- If the request is for a picture, drawing, icon, scene or illustration, return an illustration; "
       "otherwise build it from elements (text, shapes, charts).\n") + \
        ILLUSTRATION_RULES.format(w=w, h=h)
    user = (f"REQUEST: {want}\nCURRENT SLIDE (ids included): " + json.dumps(digest_slide(slide))[:9000] +
            ("\nDECK: " + str(p.get("outline"))[:1500] if p.get("outline") else ""))
    data, model = ai_json(system, user, temperature=0.9, max_tokens=12000)
    data = data if isinstance(data, dict) else {}
    result = {"els": _list(data.get("els")), "caption": str(data.get("caption") or "")[:120],
              "region": {"x": x, "y": y, "w": w, "h": h}}
    ill = data.get("illustration")
    if isinstance(ill, dict) and ill.get("svg"):
        try:
            svg = sanitize_svg(ill.get("svg"))
            result["image"] = {"url": save_svg(deck_code, svg), "alt": str(ill.get("alt") or want)[:160],
                               "x": x, "y": y, "w": w, "h": h}
        except AIError as e:
            logger.info("Hanns AI: region illustration rejected: %s", e)
            if not result["els"]:
                raise AIError("The AI's drawing didn't pass the safety check. Try again.")
    if not result["els"] and not result.get("image"):
        raise AIError("The AI didn't make anything for that area. Try describing it differently.")
    return result, model


ACTIONS = {
    "deck": action_deck, "slide": action_slide, "polish": action_polish, "decorate": action_decorate,
    "animate": action_animate, "ideas": action_ideas, "notes": action_notes, "rewrite": action_rewrite,
    "edit": action_edit,
}


def _validate(action, p):
    """Things only the user can fix — reported, never replaced by a fallback."""
    if action in ("deck", "slide") and len(str(p.get("prompt") or "").strip()) < 3:
        raise AIError("Tell the AI what you want first." if action == "deck" else "Describe the slide you want.", status=400)
    if action == "rewrite" and not str(p.get("text") or "").strip():
        raise AIError("Select a text box first.", status=400)
    if action in ("polish", "decorate", "animate", "notes", "edit") and not (p.get("slides") or []):
        raise AIError("There are no slides to work on.", status=400)
    if action == "edit" and len(str(p.get("prompt") or "").strip()) < 3:
        raise AIError("Tell the AI what to change.", status=400)
    if action == "region":
        if len(str(p.get("prompt") or "").strip()) < 2:
            raise AIError("Say what should go in the area.", status=400)
        _region(p)


def _builtin(action, payload, deck_code):
    from . import ai_fallback as fb
    if action == "background":
        return fb.fb_background(payload, deck_code, sanitize_svg, save_svg)
    if action == "region":
        return fb.fb_region(payload, deck_code, sanitize_svg, save_svg)
    fn = fb.FALLBACKS.get(action)
    if not fn:
        raise AIError("Unknown AI action.", status=400)
    return fn(payload)


def run(action, payload, deck_code, use_ai=True):
    """Run one Studio action. Returns (result, model, notice).

    Layers, each tried only if the previous one fails:
      1. Gemini model chain (retry on overload, cool down exhausted models)
      2. the optional OpenAI-compatible provider (HANNS_AI_FALLBACK_*)
      3. Hanns' built-in designer (hanns/ai_fallback.py) — always works
    A request the user must fix (status 400: empty prompt, no text
    selected) is reported, never papered over.
    """
    if action not in ("background", "region") and action not in ACTIONS:
        raise AIError("Unknown AI action.", status=400)
    _validate(action, payload)

    reason = None
    if use_ai and is_enabled():
        try:
            if action == "background":
                result, model = action_background(payload, deck_code)
            elif action == "region":
                result, model = action_region(payload, deck_code)
            else:
                result, model = ACTIONS[action](payload)
            return result, model, None
        except AIError as e:
            if e.status == 400:
                raise
            reason = str(e)
        except Exception:
            logger.exception("Hanns AI: unexpected error in action %s — using the built-in designer", action)
            reason = "The AI hit an unexpected problem"
    elif not is_enabled():
        reason = "AI isn't set up on this server yet"
    else:
        reason = "You've used your AI requests for this hour"

    try:
        result = _builtin(action, payload, deck_code)
    except AIError:
        raise
    except Exception:
        logger.exception("Hanns AI: built-in designer failed for %s", action)
        raise AIError("Something went wrong — try again in a moment.", status=500)
    notice = (reason.rstrip(".") + " — so Hanns' built-in designer made this instead. "
              "Edit the text, or try again later for an AI version.")
    if isinstance(result, dict) and result.get("notice"):
        notice = result.pop("notice") + " " + notice
    return result, "hanns-builtin", notice
