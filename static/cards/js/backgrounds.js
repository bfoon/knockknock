/* KnockKnock card background pattern library.
   One source of truth for every non-floral background, used by:
     - the picker (small swatches on create/manage)
     - the live painter (full-bleed on post page + wall)
   Each generator returns an SVG string sized to W×H. Patterns tile or scatter
   and stay light/translucent so card text on top stays readable.

   Palettes live in BG_PATTERNS keyed by id; each has {kind, bg, icons, name,
   group}. The floral background is handled separately by floral.js. */
(function () {
  function wrapSvg(W, H, bg, cells) {
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="100%" ' +
      'preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" ' +
      'style="position:absolute;inset:0">' +
      '<defs><radialGradient id="vg" cx="50%" cy="45%" r="62%">' +
      '<stop offset="55%" stop-color="' + bg + '" stop-opacity="0"/>' +
      '<stop offset="100%" stop-color="#000000" stop-opacity="0.05"/>' +
      '</radialGradient></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>' +
      cells +
      '<rect width="' + W + '" height="' + H + '" fill="url(#vg)"/></svg>';
  }

  // Deterministic PRNG so scattered patterns look identical every render
  // (picker swatch matches the live page).
  function rng(seed) {
    var s = seed || 1;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  function hearts(W, H, c) {
    var heart = "M0,3 C0,1 -2,-1 -4,-1 C-7,-1 -7,2 -7,2 C-7,5 -3,8 0,11 C3,8 7,5 7,2 C7,2 7,-1 4,-1 C2,-1 0,1 0,3 Z";
    var cells = "", sx = 46, sy = 46;
    for (var r = 0; r * sy < H + sy; r++) {
      for (var col = 0; col * sx < W + sx; col++) {
        var x = col * sx + (r % 2 ? sx / 2 : 0), y = r * sy;
        var k = (r * 7 + col * 3) % c.icons.length;
        cells += '<g transform="translate(' + x + " " + y + ') scale(1.3)" fill="' +
          c.icons[k] + '" opacity="0.9"><path d="' + heart + '"/></g>';
      }
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function music(W, H, c) {
    var note = '<g><ellipse cx="0" cy="10" rx="4.2" ry="3" transform="rotate(-20 0 10)"/>' +
      '<rect x="3.4" y="-12" width="1.6" height="22"/>' +
      '<path d="M3.4 -12 q9 1 9 8 q-4 -5 -9 -3 Z"/></g>';
    var cells = "", sx = 52, sy = 50;
    for (var r = 0; r * sy < H + sy; r++) {
      for (var col = 0; col * sx < W + sx; col++) {
        var x = col * sx + (r % 2 ? sx / 2 : 0), y = r * sy;
        var k = (r * 5 + col * 3) % c.icons.length;
        var rot = ((r + col) % 3 - 1) * 14;
        cells += '<g transform="translate(' + x + " " + y + ") rotate(" + rot +
          ') scale(1.1)" fill="' + c.icons[k] + '" opacity="0.88">' + note + "</g>";
      }
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function star5() {
    var p = "";
    for (var i = 0; i < 5; i++) {
      var a = (i * 144 - 90) * Math.PI / 180;
      p += (i ? "L" : "M") + (Math.cos(a) * 7).toFixed(1) + " " + (Math.sin(a) * 7).toFixed(1) + " ";
    }
    return '<path d="' + p + 'Z"/>';
  }
  function spark() {
    return '<path d="M0 -7 Q1 -1 7 0 Q1 1 0 7 Q-1 1 -7 0 Q-1 -1 0 -7 Z"/>';
  }
  function stars(W, H, c) {
    var cells = "", sx = 50, sy = 50;
    for (var r = 0; r * sy < H + sy; r++) {
      for (var col = 0; col * sx < W + sx; col++) {
        var x = col * sx + (r % 2 ? sx / 2 : 0), y = r * sy;
        var k = (r * 3 + col * 5) % c.icons.length;
        var useSpark = (r + col) % 2;
        var rot = ((r * col) % 5) * 15;
        var sc = useSpark ? 0.9 : 0.8;
        cells += '<g transform="translate(' + x + " " + y + ") rotate(" + rot +
          ") scale(" + sc + ')" fill="' + c.icons[k] + '" opacity="0.9">' +
          (useSpark ? spark() : star5()) + "</g>";
      }
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function confetti(W, H, c) {
    var cells = "", n = Math.round(W * H / 900), rnd = rng(42);
    for (var i = 0; i < n; i++) {
      var x = rnd() * W, y = rnd() * H, rot = rnd() * 360,
          k = Math.floor(rnd() * c.icons.length), t = Math.floor(rnd() * 3),
          col = c.icons[k], shape;
      if (t === 0) shape = '<rect x="-3" y="-1.5" width="6" height="3" rx="1" fill="' + col + '"/>';
      else if (t === 1) shape = '<circle r="2.4" fill="' + col + '"/>';
      else shape = '<path d="M0 -3 L3 3 L-3 3 Z" fill="' + col + '"/>';
      cells += '<g transform="translate(' + x.toFixed(1) + " " + y.toFixed(1) +
        ") rotate(" + rot.toFixed(0) + ')" opacity="0.9">' + shape + "</g>";
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function dots(W, H, c) {
    var cells = "", sx = 34, sy = 34;
    for (var r = 0; r * sy < H + sy; r++) {
      for (var col = 0; col * sx < W + sx; col++) {
        var x = col * sx + (r % 2 ? sx / 2 : 0), y = r * sy;
        var k = (r + col) % c.icons.length;
        var rr = (r + col) % 2 ? 5 : 3;
        cells += '<circle cx="' + x + '" cy="' + y + '" r="' + rr +
          '" fill="' + c.icons[k] + '" opacity="0.8"/>';
      }
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function waves(W, H, c) {
    var cells = "", step = 38, row = 0;
    for (var i = 0; i < H + step; i += step, row++) {
      var col = c.icons[row % c.icons.length];
      var d = "M0 " + i;
      for (var x = 0; x <= W; x += 40) d += " q20 -14 40 0";
      cells += '<path d="' + d + '" fill="none" stroke="' + col +
        '" stroke-width="3" opacity="0.7"/>';
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function bubbles(W, H, c) {
    var cells = "", rnd = rng(7), n = Math.round(W * H / 2600);
    for (var i = 0; i < n; i++) {
      var x = rnd() * W, y = rnd() * H, rr = rnd() * 16 + 6,
          k = Math.floor(rnd() * c.icons.length);
      cells += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' +
        rr.toFixed(1) + '" fill="' + c.icons[k] + '" opacity="0.5"/>' +
        '<circle cx="' + (x - rr * 0.3).toFixed(1) + '" cy="' + (y - rr * 0.3).toFixed(1) +
        '" r="' + (rr * 0.25).toFixed(1) + '" fill="#ffffff" opacity="0.5"/>';
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  function balloons(W, H, c) {
    function balloon(col) {
      return '<g><ellipse cx="0" cy="0" rx="8" ry="10" fill="' + col + '"/>' +
        '<path d="M0 10 L0 26" stroke="' + col + '" stroke-width="1" opacity="0.6"/>' +
        '<path d="M-2 10 L2 10 L0 13 Z" fill="' + col + '"/>' +
        '<ellipse cx="-2.5" cy="-3" rx="2" ry="3" fill="#ffffff" opacity="0.4"/></g>';
    }
    var cells = "", sx = 58, sy = 70;
    for (var r = 0; r * sy < H + sy; r++) {
      for (var col = 0; col * sx < W + sx; col++) {
        var x = col * sx + (r % 2 ? sx / 2 : 0), y = r * sy + 10;
        var k = (r * 3 + col) % c.icons.length;
        var rot = ((r + col) % 3 - 1) * 8;
        cells += '<g transform="translate(' + x + " " + y + ") rotate(" + rot + ')">' +
          balloon(c.icons[k]) + "</g>";
      }
    }
    return wrapSvg(W, H, c.bg, cells);
  }

  var GENERATORS = {
    hearts: hearts, music: music, stars: stars, confetti: confetti,
    dots: dots, waves: waves, bubbles: bubbles, balloons: balloons
  };

  // The catalogue. `group` drives the section headers in the picker.
  var BG_PATTERNS = {
    hearts_love:   { name: "Hearts", group: "Love & cute", kind: "hearts",
      bg: "#fff0f3", icons: ["#ff8fab", "#ffb3c6", "#fb6f92", "#ffc2d1"] },
    music_party:   { name: "Music notes", group: "Fun & playful", kind: "music",
      bg: "#f3efff", icons: ["#9b8cff", "#b9aaff", "#7c6cf0", "#cdb8ff"] },
    starry_joy:    { name: "Stars", group: "Fun & playful", kind: "stars",
      bg: "#fff8e6", icons: ["#ffd43b", "#ffc078", "#ffe066", "#fcc419"] },
    confetti_pop:  { name: "Confetti", group: "Festive", kind: "confetti",
      bg: "#eefcf5", icons: ["#ff8fab", "#ffd43b", "#74c0fc", "#b2f2bb", "#ffa94d", "#da77f2"] },
    balloons_fest: { name: "Balloons", group: "Festive", kind: "balloons",
      bg: "#fff4ee", icons: ["#ff922b", "#ff6b6b", "#ffd43b", "#69db7c", "#4dabf7"] },
    polka_dots:    { name: "Polka dots", group: "Geometric", kind: "dots",
      bg: "#e7f9ff", icons: ["#4dabf7", "#74c0fc", "#a5d8ff", "#3bc9db"] },
    ocean_waves:   { name: "Waves", group: "Geometric", kind: "waves",
      bg: "#e3f7fb", icons: ["#3bc9db", "#66d9e8", "#22b8cf"] },
    bubbly:        { name: "Bubbles", group: "Geometric", kind: "bubbles",
      bg: "#eafff3", icons: ["#69db7c", "#8ce99a", "#38d9a9", "#b2f2bb"] }
  };

  function render(id, W, H) {
    var c = BG_PATTERNS[id];
    if (!c) return "";
    var gen = GENERATORS[c.kind];
    return gen ? gen(W, H, c) : "";
  }

  window.KKBackgrounds = {
    patterns: BG_PATTERNS,
    render: render,
    bgColor: function (id) { return BG_PATTERNS[id] ? BG_PATTERNS[id].bg : "#ffffff"; }
  };

  // Live painter: any element with [data-kk-pattern="id"] gets a full-bleed
  // pattern SVG injected behind its children (same approach as floral.js).
  function paint(el) {
    if (el.dataset.kkPatternPainted) return;
    var id = el.getAttribute("data-kk-pattern");
    if (!id || !BG_PATTERNS[id]) return;
    var rect = el.getBoundingClientRect();
    var W = Math.max(Math.round(rect.width) || 800, 320);
    var H = Math.max(Math.round(rect.height) || 1000, 320);
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    var layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none";
    layer.innerHTML = render(id, W, H);
    el.insertBefore(layer, el.firstChild);
    el.dataset.kkPatternPainted = "1";
  }
  function initPatterns() {
    var nodes = document.querySelectorAll("[data-kk-pattern]");
    for (var i = 0; i < nodes.length; i++) paint(nodes[i]);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPatterns);
  } else {
    initPatterns();
  }
  window.kkPaintPatterns = initPatterns;
})();
