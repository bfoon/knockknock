/* Chalk — figures.
 *
 * The drawing a teacher does at the start of a lesson and rubs out at the
 * end: a rabbit, a butterfly, a tree, a car. Drawn in chalk lines, arriving
 * the way the thing itself would arrive — the rabbit runs in from the side,
 * the tree grows out of the ground — and then putting its own labels up, one
 * at a time or all at once.
 *
 * Everything lives in one viewBox, 300 x 190, laid out the way a textbook
 * plate is: the drawing in the middle band, a gutter down each side for the
 * labels, and a leader line from each label to the part it names. That layout
 * is the reason the labels never collide and never need dragging.
 *
 *   x 0..64     left gutter, text ends at 58
 *   x 70..230   the drawing
 *   x 236..300  right gutter, text starts at 242
 *   y 160       the ground, for anything that stands on it
 *
 * A part is { d, cls }. The class is what the stylesheet animates: a leg, a
 * wing, a wheel. Nothing here knows how it moves — chalk_figures.css does.
 *
 * A label is { t, at:[x,y], side, y }. `at` is the point on the drawing being
 * named; `y` is the height of the text in its gutter.
 *
 * window.ChalkFigures = { list, get, ids }
 */
(function (global) {
  "use strict";

  /* An ellipse as a path, because a part is a path and nothing else. */
  function ell(cx, cy, rx, ry) {
    return "M" + (cx - rx) + "," + cy +
      "a" + rx + "," + ry + " 0 1,0 " + (rx * 2) + ",0" +
      "a" + rx + "," + ry + " 0 1,0 " + (-rx * 2) + ",0";
  }

  var FIGS = {};
  var ORDER = [];

  function F(def) { FIGS[def.id] = def; ORDER.push(def.id); }

  /* ================================================================
     Rabbit — runs in from the side
     ================================================================ */

  F({
    id: "rabbit",
    name: "Rabbit",
    hint: "Runs in from the left",
    enter: "run",
    ground: true,
    parts: [
      { d: ell(120, 138, 16, 11), cls: "leg-b" },
      { d: "M118,146 L112,152 M124,146 L130,152", cls: "leg-b" },
      { d: ell(106, 112, 9, 9), cls: "tail" },
      { d: ell(140, 120, 34, 22), cls: "body" },
      { d: "M160,136 L163,152 M163,152 L172,152", cls: "leg-a" },
      { d: ell(180, 98, 17, 15), cls: "head" },
      { d: "M176,86 C169,58 172,38 180,34 C188,38 186,62 183,87 Z", cls: "ear ear-a" },
      { d: "M187,89 C188,62 194,44 202,42 C208,52 198,70 193,91 Z", cls: "ear ear-b" },
      { d: ell(186, 95, 2.4, 2.4), cls: "eye solid" },
      { d: ell(196, 102, 2, 1.6), cls: "nose solid" },
      { d: "M197,100 L218,94 M198,103 L220,103 M197,106 L218,111", cls: "whisker" }
    ],
    labels: [
      { t: "Ears", at: [186, 48], side: "r", y: 42 },
      { t: "Eye", at: [186, 95], side: "r", y: 80 },
      { t: "Whiskers", at: [214, 103], side: "r", y: 116 },
      { t: "Tail", at: [104, 110], side: "l", y: 96 },
      { t: "Hind leg", at: [120, 140], side: "l", y: 142 }
    ]
  });

  /* ================================================================
     Butterfly — flies in on a curve, and keeps flapping
     ================================================================ */

  F({
    id: "butterfly",
    name: "Butterfly",
    hint: "Flies in and keeps flapping",
    enter: "fly",
    parts: [
      { d: "M144,80 C110,40 68,50 76,80 C82,100 122,98 145,88 Z", cls: "wing wing-l" },
      { d: "M156,80 C190,40 232,50 224,80 C218,100 178,98 155,88 Z", cls: "wing wing-r" },
      { d: "M144,96 C118,100 96,120 112,136 C130,146 142,120 147,106 Z", cls: "wing hind-l" },
      { d: "M156,96 C182,100 204,120 188,136 C170,146 158,120 153,106 Z", cls: "wing hind-r" },
      { d: ell(150, 98, 6, 30), cls: "body" },
      { d: ell(150, 64, 7, 7), cls: "head" },
      { d: "M147,58 C140,44 132,38 125,36 M153,58 C160,44 168,38 175,36", cls: "antenna" },
      { d: ell(125, 36, 2.4, 2.4) + ell(175, 36, 2.4, 2.4), cls: "solid" }
    ],
    labels: [
      { t: "Antenna", at: [175, 38], side: "r", y: 34 },
      { t: "Forewing", at: [200, 66], side: "r", y: 70 },
      { t: "Hindwing", at: [180, 124], side: "r", y: 126 },
      { t: "Head", at: [146, 62], side: "l", y: 44 },
      { t: "Thorax", at: [146, 84], side: "l", y: 84 },
      { t: "Abdomen", at: [148, 122], side: "l", y: 130 }
    ]
  });

  /* ================================================================
     Tree — grows out of the ground
     ================================================================ */

  F({
    id: "tree",
    name: "Tree",
    hint: "Grows up out of the ground",
    enter: "grow",
    ground: true,
    parts: [
      { d: "M146,160 C138,166 128,168 118,173 M150,160 C150,168 150,172 150,178 " +
           "M154,160 C162,166 172,168 182,173", cls: "root" },
      { d: "M143,160 L147,96 L155,96 L158,160 Z", cls: "trunk" },
      { d: "M149,122 C132,114 121,100 113,88 M151,108 C170,100 181,88 189,78",
        cls: "branch" },
      { d: ell(150, 64, 40, 32), cls: "crown crown-a" },
      { d: ell(112, 86, 24, 20), cls: "crown crown-b" },
      { d: ell(189, 84, 24, 20), cls: "crown crown-c" },
      { d: ell(132, 58, 4, 4) + ell(168, 74, 4, 4) + ell(150, 40, 4, 4),
        cls: "fruit solid" }
    ],
    labels: [
      { t: "Leaves", at: [176, 48], side: "r", y: 38 },
      { t: "Fruit", at: [170, 74], side: "r", y: 78 },
      { t: "Branch", at: [186, 80], side: "r", y: 112 },
      { t: "Trunk", at: [146, 130], side: "l", y: 122 },
      { t: "Roots", at: [126, 170], side: "l", y: 172 },
      { t: "Crown", at: [118, 56], side: "l", y: 46 }
    ]
  });

  /* ================================================================
     Car — drives in, wheels turning
     ================================================================ */

  F({
    id: "car",
    name: "Car",
    hint: "Drives in from the left",
    enter: "drive",
    ground: true,
    parts: [
      { d: "M78,134 L84,114 L120,114 L134,94 L184,94 L198,114 L226,116 L228,134 Z",
        cls: "body" },
      { d: "M128,112 L139,99 L158,99 L158,112 Z", cls: "glass" },
      { d: "M164,99 L182,99 L192,112 L164,112 Z", cls: "glass" },
      { d: "M160,114 L160,134 M150,120 L156,120", cls: "door" },
      { d: ell(224, 122, 5, 4), cls: "lamp solid" },
      { d: ell(108, 134, 15, 15), cls: "wheel wheel-a" },
      { d: ell(108, 134, 5, 5), cls: "wheel wheel-a solid" },
      { d: ell(200, 134, 15, 15), cls: "wheel wheel-b" },
      { d: ell(200, 134, 5, 5), cls: "wheel wheel-b solid" }
    ],
    labels: [
      { t: "Windscreen", at: [146, 104], side: "r", y: 60 },
      { t: "Bonnet", at: [206, 110], side: "r", y: 96 },
      { t: "Headlight", at: [224, 122], side: "r", y: 130 },
      { t: "Roof", at: [158, 95], side: "l", y: 62 },
      { t: "Door", at: [140, 122], side: "l", y: 104 },
      { t: "Wheel", at: [106, 134], side: "l", y: 146 }
    ]
  });

  /* ================================================================
     Flower — grows, then opens
     ================================================================ */

  var PETALS = (function () {
    var out = [], i;
    for (i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      var cx = 150 + Math.cos(a) * 24, cy = 70 + Math.sin(a) * 24;
      out.push({ d: ell(Math.round(cx), Math.round(cy), 12, 9),
                 cls: "petal petal-" + i });
    }
    return out;
  })();

  F({
    id: "flower",
    name: "Flower",
    hint: "Grows and opens out",
    enter: "grow",
    ground: true,
    parts: [
      { d: "M148,160 C144,166 136,170 128,174 M150,160 L150,178 " +
           "M152,160 C158,166 166,170 174,174", cls: "root" },
      { d: "M149,160 C146,132 148,110 150,92", cls: "stem" },
      { d: "M148,134 C130,126 117,133 115,143 C128,151 142,145 148,138 Z",
        cls: "leaf leaf-a" },
      { d: "M151,118 C169,110 182,117 184,127 C171,135 157,129 151,122 Z",
        cls: "leaf leaf-b" }
    ].concat(PETALS).concat([
      { d: ell(150, 70, 12, 12), cls: "middle" },
      { d: ell(150, 70, 4, 4), cls: "middle solid" }
    ]),
    labels: [
      { t: "Petal", at: [174, 52], side: "r", y: 40 },
      { t: "Centre", at: [160, 70], side: "r", y: 78 },
      { t: "Leaf", at: [178, 126], side: "r", y: 124 },
      { t: "Bud", at: [128, 50], side: "l", y: 44 },
      { t: "Stem", at: [149, 148], side: "l", y: 120 },
      { t: "Roots", at: [134, 172], side: "l", y: 172 }
    ]
  });

  /* ================================================================
     Fish — swims in
     ================================================================ */

  F({
    id: "fish",
    name: "Fish",
    hint: "Swims in from the left",
    enter: "swim",
    parts: [
      { d: "M98,108 L74,86 L80,108 L74,132 Z", cls: "tail-fin" },
      { d: "M98,108 C112,76 182,70 210,100 C184,130 114,140 98,108 Z", cls: "body" },
      { d: "M148,78 C158,62 174,60 180,68", cls: "fin fin-top" },
      { d: "M158,118 C168,132 182,132 186,124", cls: "fin fin-low" },
      { d: "M182,84 C176,96 176,110 184,120", cls: "gill" },
      { d: ell(196, 96, 3, 3), cls: "eye solid" },
      { d: "M126,96 C132,104 132,110 126,118 M140,92 C146,102 146,110 140,120",
        cls: "scale" }
    ],
    labels: [
      { t: "Dorsal fin", at: [166, 64], side: "r", y: 50 },
      { t: "Eye", at: [198, 96], side: "r", y: 88 },
      { t: "Gills", at: [182, 112], side: "r", y: 122 },
      { t: "Tail fin", at: [80, 96], side: "l", y: 76 },
      { t: "Scales", at: [132, 104], side: "l", y: 108 },
      { t: "Fin", at: [170, 128], side: "l", y: 140 }
    ]
  });

  global.ChalkFigures = {
    ids: ORDER.slice(),
    list: function () {
      return ORDER.map(function (id) {
        var f = FIGS[id];
        return { id: id, name: f.name, hint: f.hint, enter: f.enter,
                 labels: f.labels.length };
      });
    },
    get: function (id) { return FIGS[id] || null; },
    /* The box everything is drawn in. Nothing outside this is a figure. */
    view: { w: 300, h: 190, ground: 160, gutterL: 58, gutterR: 242 }
  };
})(window);
