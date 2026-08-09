"""Hanns deck → standalone HTML exporter.

Produces ONE self-contained .html file that plays the deck in any browser,
offline. Rather than re-implementing the (large, evolving) slide renderer, it
bundles the real one: the deck JSON + the actual ``hanns.css`` and
``hanns_core.js`` are inlined, and a tiny player boots ``Hanns.paintSlide``
exactly as the live stage does — so the exported file looks identical to the
editor and present mode.

Chart/map elements use Plotly / Leaflet, loaded from CDN with graceful
degradation (an element simply renders its non-rich fallback when offline).

REVEAL-ON-CUE
    Elements authored with ``revealOn:"cue"`` are held back on the live stage
    until the presenter taps them in from the phone controller. A downloaded
    file has no controller, so the player below turns each cue into a
    click-step instead: a tap brings in the next held element, and only once
    the slide has nothing left held does a tap move on. That keeps the
    author's build order intact for a reader working through the deck alone.

    If the bundled ``hanns_core.js`` predates cue support the player falls
    back to painting everything at once, so an older static bundle still
    exports a usable file.

Public API:
    export_deck_to_html(deck, *, css_text, core_js_text, request=None) -> str
    html_export_filename(deck) -> str

The Django view is responsible for reading the static asset text (so this
module stays free of static-finder knowledge and is unit-testable):

    from django.contrib.staticfiles import finders
    css = open(finders.find("hanns/hanns.css")).read()
    js  = open(finders.find("hanns/hanns_core.js")).read()
    html = export_deck_to_html(deck, css_text=css, core_js_text=js, request=request)
"""

from __future__ import annotations

import json
import re

# CDNs for the optional rich renderers (charts / maps). Kept identical to what
# the live app uses so exported decks match.
PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js"
LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"

DESIGN_W = 960
DESIGN_H = 540


def _esc_script(text: str) -> str:
    """Make text safe to embed inside a <script> block.

    The only sequence that can break out of a script element is ``</script``
    (and, defensively, an HTML comment opener). Escaping the slash is enough
    and keeps the JS/JSON semantically identical.
    """
    if not text:
        return ""
    text = text.replace("</script", "<\\/script")
    text = text.replace("<!--", "<\\!--")
    return text


def _deck_payload(deck) -> dict:
    """The deck shape the player needs — mirrors Deck.as_dict()."""
    if hasattr(deck, "as_dict"):
        d = deck.as_dict()
    else:  # very defensive fallback
        d = {
            "title": getattr(deck, "title", "Deck"),
            "code": getattr(deck, "code", ""),
            "slides": [],
        }
    # Player only needs title + slides; keep it lean.
    return {
        "title": d.get("title", "Deck"),
        "code": d.get("code", ""),
        "slides": d.get("slides", []),
    }


# Player bootstrap: scales the 960×540 stage to the viewport, paints the
# current slide with the REAL renderer, steps through any cue-held elements,
# and wires keyboard / click / swipe navigation.
_PLAYER_JS = """
(function () {
  "use strict";
  var DESIGN_W = %DESIGN_W%, DESIGN_H = %DESIGN_H%;
  var DECK = window.__HANNS_DECK__ || { slides: [] };
  var slides = Array.isArray(DECK.slides) ? DECK.slides : [];
  var idx = 0;

  var stage = document.getElementById("hanns-stage");
  var scaler = document.getElementById("hanns-scaler");
  var counter = document.getElementById("hanns-counter");
  var hint = document.getElementById("hanns-hint");

  // Cue support depends on the bundled renderer. An older hanns_core.js has
  // no revealElement(), and also never holds anything back — so we simply
  // ask it to paint everything and the file still plays start to finish.
  var CAN_CUE = !!(window.Hanns && typeof window.Hanns.revealElement === "function");
  var pending = [];          // cue-held elements on this slide, in author order

  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var scale = Math.min(vw / DESIGN_W, vh / DESIGN_H);
    scaler.style.transform = "translate(-50%,-50%) scale(" + scale + ")";
  }

  function elsOf(slide) {
    return (slide && Array.isArray(slide.els)) ? slide.els : [];
  }

  // Collect the held nodes in the order the author laid them out, so the
  // build steps through the slide the same way it would on the big screen.
  function collectPending(slide) {
    if (!CAN_CUE) return [];
    var out = [];
    elsOf(slide).forEach(function (el) {
      if (!el || el.revealOn !== "cue" || el.id == null) return;
      var node = stage.querySelector('.el[data-id="' + String(el.id).replace(/["\\\\]/g, "\\\\$&") + '"]');
      if (node) out.push({ node: node, el: el });
    });
    return out;
  }

  function revealNext() {
    var next = pending.shift();
    if (!next) return false;
    try {
      window.Hanns.revealElement(next.node, next.el, {});
    } catch (e) {
      next.node.style.opacity = "1";
      if (window.console) console.error(e);
    }
    updateChrome();
    return true;
  }

  function updateChrome() {
    if (counter) {
      counter.textContent = (idx + 1) + " / " + slides.length
        + (pending.length ? "  ·  " + pending.length + " to reveal" : "");
    }
    if (hint) {
      hint.textContent = pending.length
        ? "click or → to reveal the next item"
        : "← → or click · F for fullscreen";
    }
  }

  function paint() {
    if (!slides.length) return;
    idx = Math.max(0, Math.min(slides.length - 1, idx));
    var slide = slides[idx];
    // Clear and repaint using the real Hanns renderer in "live" mode so
    // entrance animations and count-ups run exactly like the stage.
    stage.className = "slide-stage";
    stage.innerHTML = "";
    pending = [];
    try {
      window.Hanns.paintSlide(stage, slide, { live: true, revealAll: !CAN_CUE });
      pending = collectPending(slide);
    } catch (e) {
      stage.innerHTML = '<div style="color:#fff;padding:2rem;font-family:sans-serif">'
        + 'Could not render this slide.</div>';
      if (window.console) console.error(e);
    }
    playTransition(slide, lastDir);
    updateChrome();
  }

  // Slide-to-slide transition, mirroring the live stage. The deck stores the
  // INCOMING slide's transition ({fade|slide|push|zoom|flip|reveal|none}).
  var lastDir = 1;
  function playTransition(slide, dir) {
    var t = (slide && slide.transition) || "fade";
    if (t === "none" || !stage.animate) return;
    var d = dir < 0 ? -1 : 1;
    var frames = {
      fade:  [{ opacity: 0 }, { opacity: 1 }],
      slide: [{ opacity: 0, transform: "translateX(" + (60 * d) + "px)" },
              { opacity: 1, transform: "translateX(0)" }],
      push:  [{ transform: "translateX(" + (100 * d) + "%)" },
              { transform: "translateX(0)" }],
      zoom:  [{ opacity: 0, transform: "scale(.82)" },
              { opacity: 1, transform: "scale(1)" }],
      flip:  [{ opacity: 0, transform: "perspective(1400px) rotateY(" + (55 * d) + "deg)" },
              { opacity: 1, transform: "perspective(1400px) rotateY(0deg)" }],
      reveal:[{ clipPath: d > 0 ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)" },
              { clipPath: "inset(0 0 0 0)" }]
    };
    try {
      stage.animate(frames[t] || frames.fade,
        { duration: t === "push" ? 460 : 520, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
    } catch (e) { /* transitions are a bonus */ }
  }

  // Forward first works through the slide's build, then moves on. Backward
  // always leaves the slide — stepping a build in reverse would mean
  // un-animating, which reads worse than simply replaying it.
  function go(n) {
    if (n > 0 && pending.length) { revealNext(); return; }
    lastDir = n < 0 ? -1 : 1;
    idx += n;
    paint();
  }
  function goto(i) { lastDir = i >= idx ? 1 : -1; idx = i; paint(); }
  function revealRest() { while (pending.length) { revealNext(); } }

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { go(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { go(-1); e.preventDefault(); }
    else if (e.key === "ArrowDown") { revealRest(); e.preventDefault(); }
    else if (e.key === "Home") { goto(0); }
    else if (e.key === "End") { goto(slides.length - 1); }
    else if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    }
  });

  // Click right half = next (or reveal), left half = previous slide.
  // Bound to the full-bleed viewport, not the scaled stage: the page sets
  // cursor:pointer everywhere, and on any screen that is not exactly 16:9
  // the letterboxed margins are a large part of what a reader will click.
  var clickTarget = document.getElementById("hanns-viewport") || stage.parentElement;
  clickTarget.addEventListener("click", function (e) {
    var midX = window.innerWidth / 2;
    go(e.clientX >= midX ? 1 : -1);
  });

  // Touch swipe.
  var tsx = 0;
  document.addEventListener("touchstart", function (e) { tsx = e.touches[0].clientX; }, { passive: true });
  document.addEventListener("touchend", function (e) {
    var dx = e.changedTouches[0].clientX - tsx;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener("resize", fit);
  fit();
  paint();
})();
""".replace("%DESIGN_W%", str(DESIGN_W)).replace("%DESIGN_H%", str(DESIGN_H))


_PAGE_CSS = """
  html, body { margin: 0; padding: 0; height: 100%; background: #0a0a0a; overflow: hidden; }
  #hanns-viewport {
    position: fixed; inset: 0; display: block; cursor: pointer;
    background: radial-gradient(120% 120% at 50% 0%, #15151c, #07070a);
  }
  #hanns-scaler {
    position: absolute; left: 50%; top: 50%;
    transform-origin: center center;
    width: %Wpx; height: %Hpx;
  }
  .slide-stage {
    position: relative; width: %Wpx; height: %Hpx; overflow: hidden;
    border-radius: 6px; box-shadow: 0 30px 90px rgba(0,0,0,.55);
    background: #f6f1e7;
  }
  #hanns-counter {
    position: fixed; right: 16px; bottom: 12px; z-index: 50;
    font: 600 13px/1 system-ui, sans-serif; color: rgba(255,255,255,.65);
    background: rgba(0,0,0,.35); padding: 6px 10px; border-radius: 999px;
    pointer-events: none; letter-spacing: .03em;
  }
  #hanns-hint {
    position: fixed; left: 16px; bottom: 12px; z-index: 50;
    font: 500 12px/1 system-ui, sans-serif; color: rgba(255,255,255,.4);
    pointer-events: none;
  }
""".replace("%W", str(DESIGN_W)).replace("%H", str(DESIGN_H))


def export_deck_to_html(deck, *, css_text: str, core_js_text: str, request=None) -> str:
    """Return a complete standalone HTML document string for ``deck``."""
    payload = _deck_payload(deck)
    deck_json = json.dumps(payload, ensure_ascii=False)
    title = payload.get("title") or "Hanns deck"

    # Escape everything that gets inlined into <script> contexts.
    deck_json_safe = _esc_script(deck_json)
    core_js_safe = _esc_script(core_js_text or "")
    player_safe = _esc_script(_PLAYER_JS)

    # HTML-escape the visible <title>.
    title_html = (
        str(title).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title_html}</title>
<link rel="stylesheet" href="{LEAFLET_CSS}">
<style>
{css_text or ""}
</style>
<style>
{_PAGE_CSS}
</style>
</head>
<body>
<div id="hanns-viewport">
  <div id="hanns-scaler">
    <div id="hanns-stage" class="slide-stage"></div>
  </div>
</div>
<div id="hanns-counter">1 / 1</div>
<div id="hanns-hint">← → or click · F for fullscreen</div>

<!-- Optional rich renderers: charts (Plotly) and maps (Leaflet). The deck
     degrades gracefully if these fail to load offline. -->
<script src="{PLOTLY_CDN}"></script>
<script src="{LEAFLET_JS}"></script>

<!-- Deck data -->
<script>window.__HANNS_DECK__ = {deck_json_safe};</script>

<!-- The real Hanns renderer (same code as the editor / live stage) -->
<script>{core_js_safe}</script>

<!-- Standalone player bootstrap -->
<script>{player_safe}</script>
</body>
</html>
"""


def html_export_filename(deck) -> str:
    base = re.sub(r"[^A-Za-z0-9 _-]+", "", (getattr(deck, "title", "") or "deck")).strip() or "deck"
    return f"{base}.html"
