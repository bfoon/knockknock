/* Chalk — line icons.
 *
 * An icon is several strokes, not one: an envelope is a box and two lines, a
 * key is a ring and a shaft and its teeth. A free shape holds one path, so
 * each icon arrives as a handful of elements grouped together — it moves,
 * resizes and turns as one thing, and it still comes apart when a teacher
 * wants the ring of the key a different colour from the shaft.
 *
 * That is the difference between these and the emoji: an emoji is a picture
 * of a key, and an icon is a key you can take to bits.
 *
 * Each icon is written in its own 0..100 box, out of five kinds of part:
 *
 *   ["r", x, y, w, h, radius?]        a box, optionally round-cornered
 *   ["c", cx, cy, r]                  a circle
 *   ["l", x1, y1, x2, y2]             a line
 *   ["p", closed, smooth, x, y, ...]  a path through some points
 *   ["t", x, y, size, "text"]         a letter or a digit
 *
 * window.ChalkIcons = { list, cats, build, preview }
 */
(function (global) {
  "use strict";

  var LIST = [];
  function I(cat, id, name, parts) {
    LIST.push({ cat: cat, id: id, name: name, parts: parts });
  }

  /* ---- school ------------------------------------------------------- */

  I("School", "book", "Book", [
    ["p", 1, 0, 10, 18, 46, 26, 50, 34, 54, 26, 90, 18, 90, 76, 54, 84, 50, 92, 46, 84, 10, 76],
    ["l", 50, 34, 50, 92]
  ]);
  I("School", "pencil", "Pencil", [
    ["p", 1, 0, 22, 82, 30, 58, 74, 14, 88, 28, 44, 72],
    ["p", 1, 0, 22, 82, 30, 58, 44, 72],
    ["l", 74, 14, 88, 28]
  ]);
  I("School", "ruler", "Ruler", [
    ["r", 10, 34, 80, 32, 6],
    ["l", 26, 34, 26, 48], ["l", 42, 34, 42, 52],
    ["l", 58, 34, 58, 48], ["l", 74, 34, 74, 52]
  ]);
  I("School", "globe", "Globe", [
    ["c", 50, 50, 40],
    ["p", 0, 1, 50, 10, 30, 30, 30, 70, 50, 90],
    ["p", 0, 1, 50, 10, 70, 30, 70, 70, 50, 90],
    ["l", 12, 38, 88, 38], ["l", 12, 62, 88, 62]
  ]);
  I("School", "clock", "Clock", [
    ["c", 50, 50, 40],
    ["l", 50, 50, 50, 26], ["l", 50, 50, 68, 58]
  ]);
  I("School", "calendar", "Calendar", [
    ["r", 10, 20, 80, 72, 8],
    ["l", 10, 40, 90, 40],
    ["l", 32, 10, 32, 28], ["l", 68, 10, 68, 28],
    ["l", 30, 58, 44, 58], ["l", 56, 58, 70, 58],
    ["l", 30, 76, 44, 76], ["l", 56, 76, 70, 76]
  ]);
  I("School", "clipboard", "Clipboard", [
    ["r", 16, 16, 68, 78, 8],
    ["r", 36, 6, 28, 18, 5],
    ["l", 30, 46, 70, 46], ["l", 30, 62, 70, 62], ["l", 30, 78, 56, 78]
  ]);
  I("School", "cap", "Graduation cap", [
    ["p", 1, 0, 50, 18, 94, 38, 50, 58, 6, 38],
    ["p", 0, 0, 22, 46, 22, 74, 50, 84, 78, 74, 78, 46],
    ["l", 90, 42, 90, 72]
  ]);
  I("School", "bulb", "Idea", [
    ["c", 50, 40, 26],
    ["p", 0, 0, 38, 60, 38, 74, 62, 74, 62, 60],
    ["l", 40, 84, 60, 84], ["l", 44, 92, 56, 92]
  ]);
  I("School", "search", "Magnifier", [
    ["c", 42, 42, 28],
    ["l", 63, 63, 88, 88]
  ]);
  I("School", "flask", "Flask", [
    ["p", 0, 0, 38, 10, 38, 40, 16, 84, 84, 84, 62, 40, 62, 10],
    ["l", 32, 10, 68, 10],
    ["l", 27, 64, 73, 64]
  ]);
  I("School", "calculator", "Calculator", [
    ["r", 18, 10, 64, 80, 8],
    ["r", 28, 20, 44, 18, 3],
    ["c", 34, 54, 5], ["c", 50, 54, 5], ["c", 66, 54, 5],
    ["c", 34, 74, 5], ["c", 50, 74, 5], ["c", 66, 74, 5]
  ]);
  I("School", "board", "Board", [
    ["r", 8, 12, 84, 56, 4],
    ["l", 50, 68, 50, 88],
    ["l", 26, 92, 50, 68], ["l", 74, 92, 50, 68]
  ]);
  I("School", "question", "Question", [
    ["c", 50, 50, 40],
    ["t", 50, 26, 46, "?"]
  ]);
  I("School", "warning", "Warning", [
    ["p", 1, 0, 50, 8, 94, 88, 6, 88],
    ["t", 50, 36, 40, "!"]
  ]);
  I("School", "info", "Information", [
    ["c", 50, 50, 40],
    ["t", 50, 26, 44, "i"]
  ]);

  /* ---- nature ------------------------------------------------------- */

  I("Nature", "sun", "Sun", (function () {
    var parts = [["c", 50, 50, 24]], i;
    for (i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      parts.push(["l",
        Math.round(50 + Math.cos(a) * 32), Math.round(50 + Math.sin(a) * 32),
        Math.round(50 + Math.cos(a) * 46), Math.round(50 + Math.sin(a) * 46)]);
    }
    return parts;
  })());
  I("Nature", "cloud", "Cloud", [
    ["p", 1, 1, 22, 68, 10, 56, 14, 40, 30, 32, 38, 20, 58, 16, 74, 24, 82, 38,
      92, 46, 92, 62, 80, 68]
  ]);
  I("Nature", "rain", "Rain", [
    ["p", 1, 1, 24, 52, 12, 42, 16, 28, 32, 22, 40, 12, 60, 10, 74, 18, 80, 30,
      90, 36, 88, 50, 78, 54],
    ["l", 30, 66, 24, 84], ["l", 50, 66, 44, 84], ["l", 70, 66, 64, 84]
  ]);
  I("Nature", "thermometer", "Thermometer", [
    ["p", 0, 0, 40, 66, 40, 16, 60, 16, 60, 66],
    ["c", 50, 78, 16],
    ["l", 64, 30, 76, 30], ["l", 64, 44, 76, 44]
  ]);
  I("Nature", "tree", "Tree", [
    ["p", 1, 0, 50, 8, 82, 52, 18, 52],
    ["p", 1, 0, 50, 30, 88, 78, 12, 78],
    ["r", 44, 78, 12, 16, 2]
  ]);
  I("Nature", "plant", "Plant", [
    ["p", 0, 1, 50, 92, 50, 44],
    ["p", 1, 1, 50, 56, 24, 46, 22, 24, 46, 34],
    ["p", 1, 1, 50, 62, 78, 52, 80, 30, 54, 40]
  ]);
  I("Nature", "drop", "Water drop", [
    ["p", 1, 1, 50, 8, 72, 38, 84, 62, 76, 84, 50, 94, 24, 84, 16, 62, 28, 38]
  ]);
  I("Nature", "battery", "Battery", [
    ["r", 8, 32, 74, 36, 6],
    ["r", 84, 42, 8, 16, 3],
    ["l", 20, 40, 20, 60], ["l", 34, 40, 34, 60], ["l", 48, 40, 48, 60]
  ]);
  I("Nature", "magnet", "Magnet", [
    ["p", 0, 1, 20, 82, 20, 44, 50, 20, 80, 44, 80, 82],
    ["p", 0, 1, 44, 82, 44, 46, 50, 42, 56, 46, 56, 82],
    ["l", 20, 66, 44, 66], ["l", 56, 66, 80, 66]
  ]);
  I("Nature", "gear", "Gear", (function () {
    var out = [], teeth = 8, i;
    var step = Math.PI * 2 / teeth;
    for (i = 0; i < teeth; i++) {
      var a = i * step - Math.PI / 2;
      [[a - step * 0.17, 46], [a + step * 0.17, 46],
       [a + step * 0.31, 32], [a + step * 0.69, 32]].forEach(function (p) {
        out.push(Math.round((50 + Math.cos(p[0]) * p[1]) * 10) / 10,
                 Math.round((50 + Math.sin(p[0]) * p[1]) * 10) / 10);
      });
    }
    return [["p", 1, 0].concat(out), ["c", 50, 50, 14]];
  })());

  /* ---- places ------------------------------------------------------- */

  I("Places", "house", "House", [
    ["p", 1, 0, 50, 8, 92, 42, 92, 92, 8, 92, 8, 42],
    ["r", 40, 62, 20, 30, 2]
  ]);
  I("Places", "door", "Door", [
    ["r", 22, 8, 56, 84, 4],
    ["c", 64, 52, 5]
  ]);
  I("Places", "car", "Car", [
    ["p", 0, 0, 8, 62, 14, 44, 28, 30, 72, 30, 86, 44, 92, 62],
    ["l", 8, 62, 92, 62],
    ["l", 30, 32, 34, 44], ["l", 70, 32, 66, 44], ["l", 16, 44, 84, 44],
    ["c", 28, 68, 10], ["c", 72, 68, 10]
  ]);
  I("Places", "bus", "Bus", [
    ["r", 12, 16, 76, 56, 8],
    ["l", 12, 38, 88, 38],
    ["l", 50, 16, 50, 38],
    ["c", 28, 78, 9], ["c", 72, 78, 9]
  ]);
  I("Places", "bike", "Bicycle", [
    ["c", 22, 68, 20], ["c", 78, 68, 20],
    ["p", 0, 0, 22, 68, 42, 68, 56, 36, 78, 68],
    ["l", 42, 68, 56, 36], ["l", 46, 36, 66, 36]
  ]);
  I("Places", "boat", "Boat", [
    ["p", 1, 0, 8, 68, 92, 68, 80, 88, 20, 88],
    ["l", 50, 68, 50, 10],
    ["p", 1, 0, 54, 16, 84, 62, 54, 62]
  ]);
  I("Places", "plane", "Aeroplane", [
    ["p", 1, 1, 50, 6, 58, 38, 92, 58, 92, 68, 58, 58, 56, 78, 68, 88, 68, 94,
      50, 86, 32, 94, 32, 88, 44, 78, 42, 58, 8, 68, 8, 58, 42, 38]
  ]);
  I("Places", "flag", "Flag", [
    ["l", 22, 8, 22, 94],
    ["p", 1, 1, 22, 14, 84, 24, 22, 52]
  ]);
  I("Places", "pin", "Location", [
    ["p", 1, 1, 50, 94, 20, 52, 20, 30, 50, 10, 80, 30, 80, 52],
    ["c", 50, 38, 13]
  ]);

  /* ---- things ------------------------------------------------------- */

  /* Laid on its side with the teeth hanging down. Drawn on the diagonal it
   * was a magnifier with two scratches on the handle. */
  I("Things", "key", "Key", [
    ["c", 26, 50, 18],
    ["c", 26, 50, 7],
    ["l", 44, 50, 92, 50],
    ["l", 70, 50, 70, 68], ["l", 84, 50, 84, 64]
  ]);
  I("Things", "lock", "Lock", [
    ["r", 18, 44, 64, 48, 8],
    ["p", 0, 0, 32, 44, 32, 28, 50, 16, 68, 28, 68, 44],
    ["c", 50, 66, 6]
  ]);
  I("Things", "bell", "Bell", [
    ["p", 0, 1, 20, 74, 28, 62, 28, 42, 50, 18, 72, 42, 72, 62, 80, 74],
    ["l", 20, 74, 80, 74],
    ["c", 50, 84, 7]
  ]);
  I("Things", "mail", "Envelope", [
    ["r", 8, 24, 84, 56, 6],
    ["p", 0, 0, 8, 28, 50, 58, 92, 28],
    ["l", 8, 76, 36, 52], ["l", 92, 76, 64, 52]
  ]);
  I("Things", "phone", "Phone", [
    ["r", 28, 6, 44, 88, 10],
    ["l", 42, 16, 58, 16],
    ["c", 50, 82, 5]
  ]);
  I("Things", "camera", "Camera", [
    ["r", 8, 28, 84, 58, 8],
    ["c", 50, 58, 18],
    ["r", 34, 16, 24, 14, 4],
    ["c", 78, 42, 4]
  ]);
  I("Things", "computer", "Computer", [
    ["r", 10, 16, 80, 52, 6],
    ["l", 34, 88, 66, 88],
    ["l", 50, 68, 50, 88]
  ]);
  I("Things", "folder", "Folder", [
    ["p", 1, 0, 8, 82, 8, 22, 38, 22, 46, 34, 92, 34, 92, 82]
  ]);
  I("Things", "file", "Document", [
    ["p", 1, 0, 20, 6, 62, 6, 80, 26, 80, 94, 20, 94],
    ["p", 0, 0, 62, 6, 62, 26, 80, 26],
    ["l", 32, 46, 68, 46], ["l", 32, 62, 68, 62], ["l", 32, 78, 56, 78]
  ]);
  I("Things", "bin", "Bin", [
    ["l", 12, 24, 88, 24],
    ["p", 0, 0, 40, 24, 40, 12, 60, 12, 60, 24],
    ["p", 0, 0, 22, 24, 28, 92, 72, 92, 78, 24],
    ["l", 42, 40, 42, 78], ["l", 58, 40, 58, 78]
  ]);
  I("Things", "cup", "Cup", [
    ["p", 0, 0, 20, 24, 26, 82, 62, 82, 68, 24],
    ["l", 16, 24, 72, 24],
    ["p", 0, 1, 68, 36, 88, 40, 86, 62, 66, 66]
  ]);
  I("Things", "bag", "Bag", [
    ["p", 1, 0, 16, 34, 84, 34, 90, 92, 10, 92],
    ["p", 0, 1, 34, 34, 34, 18, 50, 10, 66, 18, 66, 34]
  ]);
  I("Things", "gift", "Gift", [
    ["r", 10, 38, 80, 54, 4],
    ["l", 10, 54, 90, 54],
    ["l", 50, 38, 50, 92],
    ["p", 0, 1, 50, 38, 30, 34, 28, 18, 46, 22, 50, 38],
    ["p", 0, 1, 50, 38, 70, 34, 72, 18, 54, 22, 50, 38]
  ]);

  /* ---- people ------------------------------------------------------- */

  I("People", "person", "Person", [
    ["c", 50, 28, 18],
    ["p", 0, 1, 16, 94, 20, 68, 50, 54, 80, 68, 84, 94]
  ]);
  I("People", "people", "Two people", [
    ["c", 34, 30, 16],
    ["p", 0, 1, 6, 92, 10, 68, 34, 56, 58, 68, 62, 92],
    ["c", 72, 34, 13],
    ["p", 0, 1, 66, 92, 70, 72, 78, 66, 94, 72, 96, 92]
  ]);
  I("People", "heart", "Heart", [
    ["p", 1, 1, 50, 90, 14, 56, 10, 34, 24, 18, 40, 18, 50, 32, 60, 18, 76, 18,
      90, 34, 86, 56]
  ]);
  I("People", "aid", "First aid", [
    ["r", 10, 22, 80, 60, 10],
    ["l", 50, 36, 50, 68], ["l", 34, 52, 66, 52]
  ]);
  I("People", "hand", "Raised hand", [
    ["p", 0, 1, 28, 92, 20, 62, 22, 48, 32, 54, 32, 20, 42, 16, 44, 46, 46, 12,
      56, 10, 56, 46, 60, 18, 70, 18, 70, 50, 78, 40, 84, 46, 76, 78, 70, 92]
  ]);

  /* ---- marks -------------------------------------------------------- */

  I("Marks", "tick-c", "Tick in a circle", [
    ["c", 50, 50, 40],
    ["p", 0, 0, 30, 52, 44, 66, 72, 34]
  ]);
  I("Marks", "cross-c", "Cross in a circle", [
    ["c", 50, 50, 40],
    ["l", 34, 34, 66, 66], ["l", 66, 34, 34, 66]
  ]);
  I("Marks", "plus-c", "Plus in a circle", [
    ["c", 50, 50, 40],
    ["l", 50, 30, 50, 70], ["l", 30, 50, 70, 50]
  ]);
  I("Marks", "minus-c", "Minus in a circle", [
    ["c", 50, 50, 40],
    ["l", 30, 50, 70, 50]
  ]);
  I("Marks", "star", "Star", [
    ["p", 1, 0, 50, 8, 62, 36, 92, 40, 70, 60, 76, 90, 50, 74, 24, 90, 30, 60,
      8, 40, 38, 36]
  ]);
  I("Marks", "play", "Play", [
    ["c", 50, 50, 40],
    ["p", 1, 0, 40, 30, 72, 50, 40, 70]
  ]);
  I("Marks", "pause", "Pause", [
    ["c", 50, 50, 40],
    ["r", 36, 32, 10, 36, 3], ["r", 54, 32, 10, 36, 3]
  ]);
  I("Marks", "menu", "Menu", [
    ["l", 14, 28, 86, 28], ["l", 14, 50, 86, 50], ["l", 14, 72, 86, 72]
  ]);
  I("Marks", "down", "Download", [
    ["l", 50, 10, 50, 62],
    ["p", 0, 0, 28, 44, 50, 66, 72, 44],
    ["p", 0, 0, 14, 76, 14, 90, 86, 90, 86, 76]
  ]);
  I("Marks", "up", "Upload", [
    ["l", 50, 90, 50, 38],
    ["p", 0, 0, 28, 56, 50, 34, 72, 56],
    ["p", 0, 0, 14, 24, 14, 10, 86, 10, 86, 24]
  ]);
  I("Marks", "refresh", "Refresh", [
    ["p", 0, 1, 78, 34, 66, 20, 46, 16, 26, 24, 16, 44, 20, 66, 36, 80, 58, 84,
      76, 76, 84, 62],
    ["p", 0, 0, 62, 30, 82, 30, 82, 12]
  ]);

  var CATS = [];
  LIST.forEach(function (ic) {
    if (CATS.indexOf(ic.cat) === -1) CATS.push(ic.cat);
  });

  /* ---- turning parts into elements ----------------------------------- */

  /* Local 0..100 -> the board box the icon is being dropped into. The box is
   * square on screen, so the x scale and the y scale differ: the board is
   * 16:9 and a circle drawn with one scale for both comes out an oval. */
  function mapper(box) {
    return {
      x: function (v) { return box.x + (v / 100) * box.w; },
      y: function (v) { return box.y + (v / 100) * box.h; },
      w: function (v) { return (v / 100) * box.w; },
      h: function (v) { return (v / 100) * box.h; }
    };
  }

  function build(icon, box, p) {
    var mk = ChalkTemplates.make;
    var m = mapper(box);
    var out = [];
    icon.parts.forEach(function (part) {
      var kind = part[0];
      if (kind === "c") {
        out.push(mk.circle(p, m.x(part[1]), m.y(part[2]),
          m.w(part[3]), m.h(part[3]), { strokeW: 2.5, stroke: p.ink }));
      } else if (kind === "l") {
        out.push(mk.seg(p, m.x(part[1]), m.y(part[2]), m.x(part[3]), m.y(part[4]),
          { strokeW: 2.5, stroke: p.ink }));
      } else if (kind === "r") {
        var rad = part[5] || 0;
        out.push(mk.box(p, m.x(part[1]), m.y(part[2]), m.w(part[3]), m.h(part[4]),
          { strokeW: 2.5, stroke: p.ink, edge: rad ? "round" : "sharp",
            radius: Math.min(50, rad * 2) }));
      } else if (kind === "t") {
        out.push(mk.text(p, m.x(part[1]) - m.w(30), m.y(part[2]), m.w(60),
          part[4], {
            size: (part[3] / 100) * box.h,
            align: "center", bold: true, color: p.ink
          }));
      } else {
        var coords = [];
        for (var i = 3; i < part.length; i += 2) {
          coords.push(m.x(part[i]), m.y(part[i + 1]));
        }
        out.push(mk.poly(p, coords, {
          closed: !!part[1],
          edge: part[2] ? "smooth" : "sharp",
          radius: part[2] ? 26 : 14,
          strokeW: 2.5, stroke: p.ink
        }));
      }
    });
    return out;
  }

  /* The picker thumbnail, drawn from the same parts the board will use. */
  function preview(icon) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-6 -6 112 112");
    svg.setAttribute("class", "thumb");
    svg.setAttribute("aria-hidden", "true");
    icon.parts.forEach(function (part) {
      var kind = part[0], node;
      var ns = svg.namespaceURI;
      if (kind === "c") {
        node = document.createElementNS(ns, "circle");
        node.setAttribute("cx", part[1]);
        node.setAttribute("cy", part[2]);
        node.setAttribute("r", part[3]);
      } else if (kind === "l") {
        node = document.createElementNS(ns, "line");
        node.setAttribute("x1", part[1]);
        node.setAttribute("y1", part[2]);
        node.setAttribute("x2", part[3]);
        node.setAttribute("y2", part[4]);
      } else if (kind === "r") {
        node = document.createElementNS(ns, "rect");
        node.setAttribute("x", part[1]);
        node.setAttribute("y", part[2]);
        node.setAttribute("width", part[3]);
        node.setAttribute("height", part[4]);
        if (part[5]) node.setAttribute("rx", part[5]);
      } else if (kind === "t") {
        node = document.createElementNS(ns, "text");
        node.setAttribute("x", part[1]);
        node.setAttribute("y", part[2] + part[3] * 0.82);
        node.setAttribute("font-size", part[3]);
        node.setAttribute("text-anchor", "middle");
        node.setAttribute("font-weight", "700");
        node.setAttribute("font-family", "sans-serif");
        node.setAttribute("fill", "currentColor");
        node.setAttribute("stroke", "none");
        node.textContent = part[4];
        svg.appendChild(node);
        return;
      } else {
        node = document.createElementNS(ns, "polyline");
        var pts = [];
        for (var i = 3; i < part.length; i += 2) {
          pts.push(part[i] + "," + part[i + 1]);
        }
        if (part[1]) pts.push(pts[0]);
        node.setAttribute("points", pts.join(" "));
      }
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", "currentColor");
      node.setAttribute("stroke-width", "6");
      node.setAttribute("stroke-linecap", "round");
      node.setAttribute("stroke-linejoin", "round");
      svg.appendChild(node);
    });
    return svg;
  }

  global.ChalkIcons = {
    list: LIST, cats: CATS, build: build, preview: preview
  };
})(window);
