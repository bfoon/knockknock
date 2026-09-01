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

ZOOM REGIONS
    Elements of ``type:"focus"`` are authored close-ups: an area of the
    slide the presenter magnifies from the phone on the night. A reader
    working through the file alone has no phone, so the player exposes
    them as a pill in the corner (and the "z" key): tapping it steps
    through the slide's close-ups and then back to the plain slide. If the
    bundled renderer predates focus support the pill never appears.

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
# The SAME Google Fonts request present.html makes. Without it every deck
# fell back to system serif/sans, which is why an export rarely matched
# the live stage: almost every theme is built on Fraunces, Archivo
# Expanded, Anton, Bebas and friends. Fonts are the single biggest
# visual difference between the two, ahead of anything structural.
GOOGLE_FONTS_CSS = (
    "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Archivo:wght@400;500;600;700;800&family=Archivo+Expanded:wght@600;700;800&family=Spline+Sans+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700;800;900&family=Manrope:wght@300;400;500;600;700;800&family=Poppins:wght@300;400;500;600;700;800;900&family=Montserrat:wght@300;400;500;600;700;800;900&family=Roboto:wght@300;400;500;700;900&family=Open+Sans:wght@300;400;500;600;700;800&family=Lato:wght@300;400;700;900&family=Nunito+Sans:wght@300;400;600;700;800;900&family=Raleway:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=DM+Serif+Display:ital@0;1&family=Bebas+Neue&family=Oswald:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700;900&family=Libre+Baskerville:wght@400;700&family=Lora:ital,wght@0,400..700;1,400..700&family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&family=Space+Grotesk:wght@300;400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@300;400;500;600;700&family=Barlow+Condensed:wght@300;400;500;600;700;800&family=Rubik:wght@300;400;500;600;700;800;900&family=Quicksand:wght@300;400;500;600;700&family=Sora:wght@300;400;500;600;700;800&family=Exo+2:wght@300;400;500;600;700;800;900&family=Ubuntu:wght@300;400;500;700&family=Work+Sans:wght@300;400;500;600;700;800;900&family=Noto+Sans:wght@300;400;500;600;700;800;900&family=Noto+Serif:wght@400;500;600;700;800;900&family=Source+Serif+4:opsz,wght@8..60,300..900&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Serif:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700;800&family=Fira+Code:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Cinzel:wght@400;500;600;700;800;900&family=Abril+Fatface&family=Anton&family=Pacifico&family=Caveat:wght@400;500;600;700&family=Permanent+Marker&family=Righteous&family=Kanit:wght@300;400;500;600;700;800;900&family=Lexend:wght@300;400;500;600;700;800;900&family=Urbanist:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
)

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

  // Authored close-ups. Same story as cues: an older bundle simply has no
  // showFocus(), and the pill stays hidden.
  var CAN_FOCUS = !!(window.Hanns && typeof window.Hanns.showFocus === "function");
  var regions = [];          // focus elements on this slide, in author order
  var focusAt = -1;          // -1 = plain slide

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

  function collectRegions(slide) {
    if (!CAN_FOCUS) return [];
    return elsOf(slide).filter(function (el) {
      return el && el.type === "focus" && el.id != null;
    });
  }

  // Step: plain slide → close-up 1 → close-up 2 → … → plain slide.
  function stepFocus() {
    if (!regions.length) return;
    focusAt += 1;
    if (focusAt >= regions.length) focusAt = -1;
    if (focusAt < 0) window.Hanns.hideFocus(stage);
    else window.Hanns.showFocus(stage, regions[focusAt]);
    updateChrome();
  }
  function dropFocus() {
    if (CAN_FOCUS && focusAt >= 0) { window.Hanns.hideFocus(stage, { instant: true }); }
    focusAt = -1;
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
    var zb = document.getElementById("hanns-zoom");
    if (zb) {
      zb.style.display = regions.length ? "inline-flex" : "none";
      zb.textContent = focusAt < 0
        ? "🔍 " + regions.length + " close-up" + (regions.length === 1 ? "" : "s")
        : "🔍 " + (regions[focusAt].label || "Close-up")
            + (focusAt === regions.length - 1 ? " · tap to close" : " · tap for next");
    }
  }

  function paint() {
    if (!slides.length) return;
    idx = Math.max(0, Math.min(slides.length - 1, idx));
    var slide = slides[idx];
    // Clear and repaint using the real Hanns renderer in "live" mode so
    // entrance animations and count-ups run exactly like the stage.
    // Capture the outgoing slide before it is destroyed — exit effects
    // animate this clone over the incoming one.
    var ghost = null;
    try { ghost = window.Hanns.captureSlide ? window.Hanns.captureSlide(stage) : null; }
    catch (e) { ghost = null; }
    stage.className = "slide-stage";
    stage.innerHTML = "";
    pending = [];
    focusAt = -1;
    regions = [];
    try {
      window.Hanns.paintSlide(stage, slide, { live: true, revealAll: !CAN_CUE });
      pending = collectPending(slide);
      regions = collectRegions(slide);
    } catch (e) {
      stage.innerHTML = '<div style="color:#fff;padding:2rem;font-family:sans-serif">'
        + 'Could not render this slide.</div>';
      if (window.console) console.error(e);
    }
    playTransition(slide, ghost);
    updateChrome();
  }

  // Slide-to-slide transition. Delegates to hanns_core.js so the download
  // behaves exactly like the live stage, including the exit effects (hand,
  // shatter, burn, wind) that animate the OUTGOING slide.
  function playTransition(slide, ghost) {
    var t = (slide && slide.transition) || "fade";
    try {
      if (window.Hanns && window.Hanns.playTransition) {
        window.Hanns.playTransition(stage, t, ghost || null, { seed: idx + 1 });
        return;
      }
      if (stage.animate) stage.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 420, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
    } catch (e) { /* transitions are a bonus */ }
  }


  // Forward first works through the slide's build, then moves on. Backward
  // always leaves the slide — stepping a build in reverse would mean
  // un-animating, which reads worse than simply replaying it.
  function go(n) {
    // A close-up is a detour, not a step — leave it before moving on.
    if (focusAt >= 0) { dropFocus(); if (CAN_FOCUS) window.Hanns.hideFocus(stage); updateChrome(); return; }
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
    else if (e.key === "z" || e.key === "Z") { stepFocus(); e.preventDefault(); }
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
  var zoomBtn = document.getElementById("hanns-zoom");
  if (zoomBtn) zoomBtn.addEventListener("click", function (e) {
    e.stopPropagation();          // the pill is not a "next slide" tap
    stepFocus();
  });

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
  /* The viewport also carries .present, because 17 rules in hanns.css are
     scoped to it — the entrance animations for bullet bars, ranked bars,
     ring gauges, the plant, the journey vehicle, the thermometer and the
     speedometer, plus interactive maps and charts. Without the class an
     exported deck rendered every one of those in its resting state and
     looked flat next to the live stage.

     .present itself is `position:fixed; background:#000; display:none`,
     which would blank the page — but an ID selector outranks a class, so
     the declarations below win. They are repeated here deliberately: this
     rule is load-bearing, not cosmetic. */
  #hanns-viewport {
    position: fixed; inset: 0; display: block; cursor: pointer;
    background: radial-gradient(120% 120% at 50% 0%, #15151c, #07070a);
  }
  #hanns-viewport.present { display: block; background: radial-gradient(120% 120% at 50% 0%, #15151c, #07070a); }
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
  #hanns-zoom {
    position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 60;
    display: none; align-items: center; gap: .4rem; cursor: pointer;
    font: 700 12.5px/1 system-ui, sans-serif; color: rgba(255,255,255,.9);
    background: rgba(29,78,137,.9); border: 1px solid rgba(255,255,255,.18);
    padding: 8px 14px; border-radius: 999px; letter-spacing: .02em;
  }
  #hanns-zoom:active { transform: translateX(-50%) scale(.96); }
  #hanns-hint {
    position: fixed; left: 16px; bottom: 12px; z-index: 50;
    font: 500 12px/1 system-ui, sans-serif; color: rgba(255,255,255,.4);
    pointer-events: none;
  }
""".replace("%W", str(DESIGN_W)).replace("%H", str(DESIGN_H))


def export_deck_to_html(deck, *, css_text: str, core_js_text: str,
                        actors_js_text: str = "", post_core_js_text: str = "",
                        request=None) -> str:
    """Return a complete standalone HTML document string for ``deck``.

    ``actors_js_text`` is hanns_actors.js. renderObject() asks
    window.HannsActors whether it owns a kind and, finding nothing, falls
    back to a plain count grid — so without this an exported deck quietly
    replaced every farm character with a row of emoji.

    ``post_core_js_text`` is for modules that must load AFTER core because
    they read window.Hanns at load time and wrap window.HannsActors —
    hanns_studio.js and hanns_fluid.js. Concatenate them in the same order
    the templates use. Without it a downloaded deck loses every studio
    chart and every liquid, exactly the way it used to lose actors.
    """
    payload = _deck_payload(deck)
    deck_json = json.dumps(payload, ensure_ascii=False)
    title = payload.get("title") or "Hanns deck"

    # Escape everything that gets inlined into <script> contexts.
    deck_json_safe = _esc_script(deck_json)
    core_js_safe = _esc_script(core_js_text or "")
    actors_js_safe = _esc_script(actors_js_text or "")
    post_core_js_safe = _esc_script(post_core_js_text or "")
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{GOOGLE_FONTS_CSS}" rel="stylesheet">
<link rel="stylesheet" href="{LEAFLET_CSS}">
<style>
{css_text or ""}
</style>
<style>
{_PAGE_CSS}
</style>
</head>
<body>
<div id="hanns-viewport" class="present">
  <div id="hanns-scaler">
    <div id="hanns-stage" class="slide-stage"></div>
  </div>
</div>
<div id="hanns-counter">1 / 1</div>
<div id="hanns-hint">← → or click · F for fullscreen</div>
<button id="hanns-zoom" type="button"></button>

<!-- Optional rich renderers: charts (Plotly) and maps (Leaflet). The deck
     degrades gracefully if these fail to load offline. -->
<script src="{PLOTLY_CDN}"></script>
<script src="{LEAFLET_JS}"></script>

<!-- Deck data -->
<script>window.__HANNS_DECK__ = {deck_json_safe};</script>

<!-- Actor characters. Loaded BEFORE core, same order as present.html. -->
<script>{actors_js_safe}</script>

<!-- The real Hanns renderer (same code as the editor / live stage) -->
<script>{core_js_safe}</script>

<!-- Modules that wrap core once it exists: studio objects, liquids. -->
<script>{post_core_js_safe}</script>

<!-- Standalone player bootstrap -->
<script>{player_safe}</script>
</body>
</html>
"""


def html_export_filename(deck) -> str:
    base = re.sub(r"[^A-Za-z0-9 _-]+", "", (getattr(deck, "title", "") or "deck")).strip() or "deck"
    return f"{base}.html"
