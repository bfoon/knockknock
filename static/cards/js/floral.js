/* Watercolour floral background painter.
   Every element with [data-kk-floral] gets an SVG background injected, themed
   by a palette passed as a JSON data attribute. Center is kept clear so card
   text stays readable. Used on the post page, live wall and organiser detail.

   Usage:
     <div data-kk-floral data-palette='{"paper":"#f5f1ea",...}'></div>
   The element is positioned relative; the SVG is inserted as an absolutely
   positioned layer behind its children.
*/
(function () {
  // Scatter layout: [x%, y%, scale, rotation, shape]. Dense at the edges,
  // clear through the middle so messages remain legible.
  var SCATTER = [
    [11, 7, 1.15, 15, "blossom"], [34, 4, 0.85, -20, "blossom2"],
    [64, 7, 0.9, 40, "blossom"], [87, 12, 1.05, -12, "blossom"],
    [22, 16, 0.8, 200, "leaf"], [93, 25, 0.85, 30, "leaf"],
    [5, 31, 1.05, -15, "blossom"], [95, 47, 0.95, 12, "blossom2"],
    [7, 47, 0.95, 150, "bud"],
    [6, 63, 0.8, 80, "leaf"], [91, 65, 1.1, -25, "blossom"],
    [12, 78, 1.05, 25, "blossom"], [88, 83, 0.95, 45, "blossom2"],
    [31, 91, 0.82, -30, "leaf"], [59, 94, 0.9, 15, "blossom"],
    [9, 93, 0.78, 120, "leaf"], [49, 89, 0.8, 210, "leaf"],
    [75, 90, 0.72, -40, "bud"]
  ];

  function ring(cx, cy, r, color) {
    var out = "";
    for (var a = 0; a < 360; a += 72) {
      var rad = (a - 90) * Math.PI / 180;
      out += '<circle cx="' + (Math.cos(rad) * r).toFixed(1) +
             '" cy="' + (Math.sin(rad) * r).toFixed(1) +
             '" r="0.85" fill="' + color + '"/>';
    }
    return out;
  }

  function defs(id, c) {
    var petal = "M0 2 C -7 -2 -9 -12 -5 -18 C -2 -22 2 -22 5 -18 C 9 -12 7 -2 0 2 Z";
    var petal2 = "M0 4 C -8 0 -11 -10 -7 -16 C -3 -20 3 -20 7 -16 C 11 -10 8 0 0 4 Z";
    var blossomPetals = "", blossom2Petals = "";
    [0, 72, 144, 216, 288].forEach(function (a) {
      blossomPetals += '<path d="' + petal + '" transform="rotate(' + a + ')"/>';
    });
    [0, 90, 180, 270].forEach(function (a) {
      blossom2Petals += '<path d="' + petal2 + '" transform="rotate(' + a + ')" opacity="0.92"/>';
    });
    return (
      '<defs>' +
      '<radialGradient id="pg_' + id + '" cx="50%" cy="80%" r="78%">' +
        '<stop offset="0%" stop-color="' + c.pD + '" stop-opacity="0.9"/>' +
        '<stop offset="48%" stop-color="' + c.p + '" stop-opacity="0.85"/>' +
        '<stop offset="100%" stop-color="' + c.pL + '" stop-opacity="0.62"/>' +
      '</radialGradient>' +
      '<radialGradient id="lg_' + id + '" cx="50%" cy="92%" r="92%">' +
        '<stop offset="0%" stop-color="' + c.lD + '" stop-opacity="0.9"/>' +
        '<stop offset="60%" stop-color="' + c.l + '" stop-opacity="0.85"/>' +
        '<stop offset="100%" stop-color="' + c.lL + '" stop-opacity="0.55"/>' +
      '</radialGradient>' +
      '<radialGradient id="vig_' + id + '" cx="50%" cy="48%" r="62%">' +
        '<stop offset="58%" stop-color="' + c.paper + '" stop-opacity="0"/>' +
        '<stop offset="100%" stop-color="' + c.paper2 + '" stop-opacity="0.75"/>' +
      '</radialGradient>' +
      '<filter id="soft_' + id + '" x="-30%" y="-30%" width="160%" height="160%">' +
        '<feGaussianBlur stdDeviation="0.4"/></filter>' +
      '<g id="blossom_' + id + '"><g filter="url(#soft_' + id + ')">' +
        '<g fill="url(#pg_' + id + ')">' + blossomPetals + '</g>' +
        '<circle r="3" fill="' + c.ctrS + '" opacity="0.85"/>' +
        '<g>' + ring(0, 0, 3.5, c.ctr) + '<circle r="1.1" fill="' + c.ctr + '"/></g>' +
      '</g></g>' +
      '<g id="blossom2_' + id + '"><g filter="url(#soft_' + id + ')" fill="url(#pg_' + id + ')">' +
        blossom2Petals + '<circle r="2.6" fill="' + c.ctr + '" opacity="0.85"/>' +
      '</g></g>' +
      '<g id="leaf_' + id + '">' +
        '<path d="M0 0 C 9 -6 15 -20 11 -34 C 5 -28 -4 -22 -8 -11 C -6 -5 -3 -1 0 0 Z" fill="url(#lg_' + id + ')" filter="url(#soft_' + id + ')"/>' +
        '<path d="M0 -1 C 3 -10 6 -20 10 -31" stroke="' + c.lD + '" stroke-width="0.7" fill="none" opacity="0.55"/>' +
      '</g>' +
      '<g id="bud_' + id + '">' +
        '<path d="M0 0 C 3 6 2 16 0 22" stroke="' + c.lD + '" stroke-width="1" fill="none" opacity="0.5"/>' +
        '<path d="M0 0 C 3 -3 4 -11 1 -16 C -2 -11 -3 -4 0 0 Z" fill="url(#pg_' + id + ')" filter="url(#soft_' + id + ')"/>' +
        '<path d="M-1 -2 C -4 -4 -4 -11 -1 -15" stroke="' + c.l + '" stroke-width="2" fill="none" opacity="0.55"/>' +
      '</g>' +
      '</defs>'
    );
  }

  function texture(W, H) {
    var out = '<g opacity="0.05">';
    for (var i = 0; i < 150; i++) {
      var x = Math.random() * W, y = Math.random() * H,
          len = Math.random() * 8 + 2, a = Math.random() * Math.PI;
      out += '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) +
             '" x2="' + (x + Math.cos(a) * len).toFixed(1) +
             '" y2="' + (y + Math.sin(a) * len).toFixed(1) +
             '" stroke="#8a7866" stroke-width="0.5"/>';
    }
    return out + "</g>";
  }

  function buildSvg(c, W, H, id) {
    var uses = SCATTER.map(function (s) {
      var x = (s[0] / 100 * W).toFixed(1), y = (s[1] / 100 * H).toFixed(1);
      return '<use href="#' + s[4] + "_" + id + '" transform="translate(' +
             x + " " + y + ") rotate(" + s[3] + ") scale(" + s[2] + ')"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="100%" ' +
      'preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" ' +
      'style="position:absolute;inset:0;z-index:0">' +
      defs(id, c) +
      '<rect width="' + W + '" height="' + H + '" fill="' + c.paper + '"/>' +
      texture(W, H) +
      '<rect width="' + W + '" height="' + H + '" fill="url(#vig_' + id + ')"/>' +
      uses + "</svg>";
  }

  var seq = 0;
  function paint(el) {
    if (el.dataset.kkFloralPainted) return;
    var palette;
    try { palette = JSON.parse(el.getAttribute("data-palette")); }
    catch (e) { return; }
    if (!palette || !palette.paper) return;

    var rect = el.getBoundingClientRect();
    var W = Math.max(Math.round(rect.width) || 800, 400);
    var H = Math.max(Math.round(rect.height) || 1000, 400);
    var id = "f" + (seq++);

    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    var layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none";
    layer.innerHTML = buildSvg(palette, W, H, id);
    el.insertBefore(layer, el.firstChild);
    // Ensure real content sits above the painted layer.
    for (var i = 0; i < el.children.length; i++) {
      var ch = el.children[i];
      if (ch === layer) continue;
      var pos = getComputedStyle(ch).position;
      if (pos === "static") ch.style.position = "relative";
      if (!ch.style.zIndex) ch.style.zIndex = "1";
    }
    el.dataset.kkFloralPainted = "1";
  }

  function init() {
    var nodes = document.querySelectorAll("[data-kk-floral]");
    for (var i = 0; i < nodes.length; i++) paint(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.kkPaintFloral = init;
})();
