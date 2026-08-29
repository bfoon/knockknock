/* Chalk — science figures.
 *
 * Twenty-four more plates for the same board: circuits, computers, cells,
 * mixtures, soil, the water cycle. They register into chalk_figures.js, share
 * its 300 x 190 viewBox and its label gutters, and are animated by
 * chalk_figures_science.css.
 *
 * These are diagrams rather than pictures. A teacher draws a circuit as a
 * rectangle with a gap for the lamp, not as a photograph of wires, and the
 * class understands the rectangle better. Everything here is drawn the way it
 * goes on a board: straight lines, standard symbols, nothing shaded.
 *
 * Most of them arrive with `enter: "draw"`, which draws the strokes on in
 * order — the order a person would draw them in, which is why the parts are
 * listed background-first. What moves afterwards is a class on a part:
 * `current` marches along a wire, `bubble` rises, `packet` travels a cable,
 * `orbit-a` goes round the sun.
 *
 * Categories group the picker. Keep them short; they are buttons on a phone.
 */
(function (global) {
  "use strict";

  var CF = global.ChalkFigures;
  if (!CF || !CF.add) return;

  function ell(cx, cy, rx, ry) {
    return "M" + (cx - rx) + "," + cy +
      "a" + rx + "," + ry + " 0 1,0 " + (rx * 2) + ",0" +
      "a" + rx + "," + ry + " 0 1,0 " + (-rx * 2) + ",0";
  }
  function box(x, y, w, h) {
    return "M" + x + "," + y + " h" + w + " v" + h + " h" + (-w) + " Z";
  }
  function rbox(x, y, w, h, r) {
    return "M" + (x + r) + "," + y + " h" + (w - 2 * r) + " a" + r + "," + r + " 0 0 1 " + r + "," + r +
      " v" + (h - 2 * r) + " a" + r + "," + r + " 0 0 1 " + (-r) + "," + r +
      " h" + (-(w - 2 * r)) + " a" + r + "," + r + " 0 0 1 " + (-r) + "," + (-r) +
      " v" + (-(h - 2 * r)) + " a" + r + "," + r + " 0 0 1 " + r + "," + (-r) + " Z";
  }
  /* An arrow with a head, because half of science is arrows. */
  function arrow(x1, y1, x2, y2) {
    var a = Math.atan2(y2 - y1, x2 - x1), h = 6;
    return "M" + x1 + "," + y1 + " L" + x2 + "," + y2 +
      " M" + x2 + "," + y2 + " L" + (x2 - h * Math.cos(a - 0.4)).toFixed(1) + "," +
      (y2 - h * Math.sin(a - 0.4)).toFixed(1) +
      " M" + x2 + "," + y2 + " L" + (x2 - h * Math.cos(a + 0.4)).toFixed(1) + "," +
      (y2 - h * Math.sin(a + 0.4)).toFixed(1);
  }
  /* Anything that keeps moving is marked, because the two things a part can
   * do are mutually exclusive: it either draws itself on with the rest of the
   * plate, or it is a bubble that has been rising since the beginning. One
   * list here beats remembering to write "moves" on ninety parts. */
  var MOVER = /(^|\s)(current|flow|pulse|blink|spin|rise|fall|drift|sink|fade|climb|buzz|slide|dart|packet|orbit-[abc]|wave|sway|breathe|wriggle|soak|stir|drip|step-[0-9]|glow|signal|grow-late)(\s|$|-)/;

  function F(def) {
    def.parts = def.parts.map(function (part) {
      var cls = part.cls || "";
      return MOVER.test(cls) ? { d: part.d, cls: cls + " moves" } : part;
    });
    CF.add(def);
  }

  /* ================================================================
     ELECTRICITY
     ================================================================ */

  F({
    id: "circuit",
    name: "Simple circuit",
    cat: "Electricity",
    hint: "Current goes round, the lamp lights",
    enter: "draw",
    parts: [
      { d: "M92,58 H134", cls: "wire" },
      { d: "M166,58 H208", cls: "wire" },
      { d: "M208,58 V96", cls: "wire" },
      { d: "M208,116 V142", cls: "wire" },
      { d: "M208,142 H168", cls: "wire" },
      { d: "M132,142 H92", cls: "wire" },
      { d: "M92,142 V58", cls: "wire" },
      /* the loop again, dashed, marching: this is the current */
      { d: "M92,58 H208 V142 H92 Z", cls: "current" },
      { d: ell(150, 58, 16, 16), cls: "lamp glass" },
      { d: "M140,50 L145,64 L150,50 L155,64 L160,50", cls: "filament glow" },
      { d: "M138,72 H162", cls: "lamp" },
      /* switch: two contacts and a lever that closes */
      { d: ell(208, 96, 2.6, 2.6), cls: "solid" },
      { d: ell(208, 116, 2.6, 2.6), cls: "solid" },
      { d: "M208,116 L222,98", cls: "lever" },
      /* cell: one long plate, one short */
      { d: "M132,130 V154", cls: "cell" },
      { d: "M140,136 V148", cls: "cell thick" },
      { d: "M150,130 V154", cls: "cell" },
      { d: "M158,136 V148", cls: "cell thick" },
      { d: "M124,120 L130,126 M124,126 L130,120", cls: "sign" },
      { d: "M164,123 H172", cls: "sign" }
    ],
    labels: [
      { t: "Lamp", at: [150, 42], side: "r", y: 34 },
      { t: "Switch", at: [216, 106], side: "r", y: 96 },
      { t: "Wire", at: [208, 130], side: "r", y: 134 },
      { t: "Cell", at: [145, 152], side: "l", y: 150 },
      { t: "Current", at: [92, 100], side: "l", y: 96 }
    ]
  });

  F({
    id: "circuit2",
    name: "Two lamps",
    cat: "Electricity",
    hint: "In series and side by side",
    enter: "draw",
    parts: [
      { d: "M88,44 H212", cls: "wire" },
      { d: "M88,44 V150 H212 V44", cls: "wire" },
      { d: "M88,96 H212", cls: "wire" },
      { d: "M88,44 V150 H212 V44 H88", cls: "current" },
      { d: ell(150, 44, 13, 13), cls: "lamp glass" },
      { d: "M142,38 L146,50 L150,38 L154,50 L158,38", cls: "filament glow" },
      { d: ell(150, 96, 13, 13), cls: "lamp glass" },
      { d: "M142,90 L146,102 L150,90 L154,102 L158,90", cls: "filament glow glow-b" },
      { d: "M138,140 V160", cls: "cell" },
      { d: "M146,146 V154", cls: "cell thick" },
      { d: "M156,140 V160", cls: "cell" },
      { d: "M164,146 V154", cls: "cell thick" }
    ],
    labels: [
      { t: "Branch one", at: [150, 32], side: "r", y: 30 },
      { t: "Branch two", at: [150, 84], side: "r", y: 74 },
      { t: "Both lamps light", at: [166, 96], side: "r", y: 110 },
      { t: "Cell", at: [150, 156], side: "l", y: 150 },
      { t: "Junction", at: [88, 96], side: "l", y: 96 }
    ]
  });

  F({
    id: "battery",
    name: "Inside a cell",
    cat: "Electricity",
    hint: "Where the push comes from",
    enter: "draw",
    parts: [
      { d: rbox(112, 44, 76, 112, 8), cls: "case" },
      { d: "M136,36 h28 v8 h-28 Z", cls: "case" },
      { d: "M118,58 H182", cls: "faint" },
      { d: "M118,142 H182", cls: "faint" },
      { d: "M150,58 V142", cls: "rod" },
      { d: "M128,72 H172 M128,86 H172 M128,100 H172 M128,114 H172 M128,128 H172",
        cls: "paste" },
      { d: "M144,26 L156,26 M150,20 V32", cls: "sign" },
      { d: "M140,164 H160", cls: "sign" },
      { d: arrow(196, 132, 196, 66), cls: "current-arrow" }
    ],
    labels: [
      { t: "Positive terminal", at: [150, 30], side: "r", y: 32 },
      { t: "Carbon rod", at: [150, 90], side: "r", y: 74 },
      { t: "Chemical paste", at: [166, 114], side: "r", y: 118 },
      { t: "Metal case", at: [112, 100], side: "l", y: 96 },
      { t: "Negative terminal", at: [150, 160], side: "l", y: 148 }
    ]
  });

  F({
    id: "bulb",
    name: "Light bulb",
    cat: "Electricity",
    hint: "The filament heats and glows",
    enter: "draw",
    parts: [
      { d: "M126,96 C126,60 138,34 150,34 C162,34 174,60 174,96 Z", cls: "glass" },
      { d: "M134,96 H166", cls: "faint" },
      { d: "M138,96 V78 M162,96 V78", cls: "support" },
      { d: "M138,78 q3,-8 6,0 q3,-8 6,0 q3,-8 6,0 q3,-8 6,0", cls: "filament glow" },
      { d: box(134, 96, 32, 26), cls: "cap" },
      { d: "M134,102 H166 M134,110 H166 M134,118 H166", cls: "thread" },
      { d: ell(150, 128, 8, 6), cls: "contact solid" },
      { d: "M96,66 L112,72 M96,110 L112,104 M96,88 H112", cls: "ray pulse" }
    ],
    labels: [
      { t: "Glass bulb", at: [168, 60], side: "r", y: 44 },
      { t: "Filament", at: [156, 76], side: "r", y: 82 },
      { t: "Screw cap", at: [166, 110], side: "r", y: 116 },
      { t: "Support wires", at: [138, 86], side: "l", y: 66 },
      { t: "Contact", at: [150, 132], side: "l", y: 140 }
    ]
  });

  F({
    id: "components",
    name: "Components",
    cat: "Electricity",
    hint: "The symbols, and what they do",
    enter: "draw",
    parts: [
      { d: "M84,52 H98 L102,44 L110,60 L118,44 L126,60 L130,52 H144", cls: "wire" },
      { d: "M164,52 H188 M188,42 V62 M198,42 V62 M198,52 H222", cls: "wire" },
      { d: "M84,104 H104 M104,94 L104,114 L122,104 Z M122,94 V114 M122,104 H144",
        cls: "wire" },
      { d: "M126,88 L134,80 M130,86 L138,78", cls: "ray pulse" },
      { d: ell(192, 104, 18, 18), cls: "faint" },
      { d: "M164,104 H180 M180,92 V116 M180,98 L206,88 M180,110 L206,120",
        cls: "wire" },
      { d: "M84,148 H104 M124,148 H144 M104,148 L122,138", cls: "wire" },
      { d: ell(104, 148, 2.4, 2.4), cls: "solid" },
      { d: ell(124, 148, 2.4, 2.4), cls: "solid" }
    ],
    labels: [
      { t: "Resistor", at: [114, 52], side: "r", y: 38 },
      { t: "Capacitor", at: [193, 52], side: "r", y: 66 },
      { t: "Transistor", at: [196, 104], side: "r", y: 104 },
      { t: "Light-emitting diode", at: [112, 104], side: "l", y: 108 },
      { t: "Switch", at: [114, 144], side: "l", y: 146 }
    ]
  });

  F({
    id: "magnet",
    name: "Magnet",
    cat: "Electricity",
    hint: "Field lines run north to south",
    enter: "draw",
    parts: [
      { d: box(112, 88, 76, 26), cls: "case" },
      { d: "M150,88 V114", cls: "faint" },
      { d: "M112,66 C112,30 188,30 188,66", cls: "field flow" },
      { d: "M112,74 C118,48 182,48 188,74", cls: "field flow" },
      { d: "M112,136 C112,172 188,172 188,136", cls: "field flow" },
      { d: "M112,128 C118,154 182,154 188,128", cls: "field flow" },
      { d: "M100,101 C86,101 86,60 112,66", cls: "field flow" },
      { d: "M200,101 C214,101 214,60 188,66", cls: "field flow" },
      { d: ell(150, 150, 13, 13), cls: "compass" },
      { d: "M150,140 L154,150 L150,160 L146,150 Z", cls: "needle solid" }
    ],
    labels: [
      { t: "North pole", at: [124, 101], side: "l", y: 96 },
      { t: "Field lines", at: [150, 44], side: "r", y: 40 },
      { t: "South pole", at: [176, 101], side: "r", y: 100 },
      { t: "Compass", at: [150, 150], side: "l", y: 150 },
      { t: "The field is strongest at the poles", at: [188, 74], side: "r", y: 132 }
    ]
  });

  /* ================================================================
     COMPUTERS AND NETWORKS
     ================================================================ */

  F({
    id: "computer",
    name: "Computer",
    cat: "Computers",
    hint: "The parts you can touch",
    enter: "draw",
    parts: [
      { d: rbox(96, 34, 96, 66, 4), cls: "case" },
      { d: box(102, 40, 84, 54), cls: "screen blink" },
      { d: "M136,100 h16 v14 h-16 Z", cls: "case" },
      { d: "M122,116 H166", cls: "case" },
      { d: rbox(200, 44, 32, 88, 4), cls: "case" },
      { d: "M206,54 H226 M206,62 H226", cls: "faint" },
      { d: ell(216, 76, 3, 3), cls: "led blink solid" },
      { d: "M206,116 h20 v8 h-20 Z", cls: "faint" },
      { d: rbox(96, 130, 74, 24, 3), cls: "case" },
      { d: "M102,136 H164 M102,142 H164 M110,148 H150", cls: "faint" },
      { d: rbox(178, 136, 16, 22, 7), cls: "case" },
      { d: "M186,138 V146", cls: "faint" }
    ],
    labels: [
      { t: "Screen", at: [144, 60], side: "r", y: 40 },
      { t: "System unit", at: [216, 90], side: "r", y: 84 },
      { t: "Power light", at: [216, 76], side: "r", y: 112 },
      { t: "Keyboard", at: [130, 142], side: "l", y: 140 },
      { t: "Mouse", at: [186, 148], side: "r", y: 150 }
    ]
  });

  F({
    id: "inside",
    name: "Inside the box",
    cat: "Computers",
    hint: "Processor, memory, storage",
    enter: "draw",
    parts: [
      { d: box(80, 34, 140, 124), cls: "case" },
      { d: box(104, 52, 40, 40), cls: "chip" },
      { d: "M108,56 H140 M108,88 H140 M112,52 V92 M136,52 V92", cls: "faint" },
      { d: "M118,62 h12 v12 h-12 Z", cls: "chip" },
      { d: ell(124, 72, 13, 13), cls: "fan spin" },
      { d: "M124,60 L131,72 L124,84 L117,72 Z", cls: "fan spin" },
      { d: box(158, 46, 10, 52), cls: "chip" },
      { d: box(172, 46, 10, 52), cls: "chip" },
      { d: box(186, 46, 10, 52), cls: "chip" },
      { d: box(96, 108, 56, 34), cls: "case" },
      { d: ell(124, 125, 11, 11), cls: "disc spin" },
      { d: "M116,120 L132,130", cls: "disc spin" },
      { d: box(166, 108, 44, 34), cls: "case" },
      { d: "M172,116 H204 M172,124 H204 M172,132 H190", cls: "faint" },
      { d: "M144,72 H158 M144,80 H158", cls: "trace flow" }
    ],
    labels: [
      { t: "Memory (RAM)", at: [176, 50], side: "r", y: 40 },
      { t: "Power supply", at: [188, 124], side: "r", y: 118 },
      { t: "Circuit board", at: [212, 152], side: "r", y: 148 },
      { t: "Processor and fan", at: [110, 66], side: "l", y: 56 },
      { t: "Hard drive", at: [110, 125], side: "l", y: 122 }
    ]
  });

  F({
    id: "network",
    name: "Network",
    cat: "Computers",
    hint: "Machines talking to each other",
    enter: "draw",
    parts: [
      { d: rbox(128, 82, 44, 20, 4), cls: "case" },
      { d: "M136,74 V82 M164,74 V82", cls: "wire" },
      { d: "M136,74 c-4,-6 4,-6 0,-12 M164,74 c4,-6 -4,-6 0,-12", cls: "signal pulse" },
      { d: "M134,92 H166", cls: "faint" },
      { d: rbox(78, 44, 40, 26, 3), cls: "case" },
      { d: "M78,70 h40 l8,8 h-56 Z", cls: "case" },
      { d: "M118,60 L134,82", cls: "wire" },
      { d: rbox(196, 40, 22, 34, 3), cls: "case" },
      { d: "M200,44 h14 v24 h-14 Z", cls: "screen blink" },
      { d: "M196,64 L172,84", cls: "wire" },
      { d: rbox(186, 116, 40, 34, 3), cls: "case" },
      { d: "M192,122 H220 M192,130 H220 M192,138 H210", cls: "faint" },
      { d: "M186,124 L170,100", cls: "wire" },
      { d: rbox(80, 112, 40, 30, 4), cls: "case" },
      { d: "M86,120 H114 M86,128 H108", cls: "faint" },
      { d: "M120,120 L132,100", cls: "wire" },
      { d: "M118,60 L134,82", cls: "packet packet-a" },
      { d: "M170,100 L186,124", cls: "packet packet-b" },
      { d: "M132,100 L120,120", cls: "packet packet-c" }
    ],
    labels: [
      { t: "Router", at: [150, 92], side: "r", y: 92 },
      { t: "Phone", at: [207, 56], side: "r", y: 44 },
      { t: "Server", at: [206, 132], side: "r", y: 134 },
      { t: "Computer", at: [98, 56], side: "l", y: 46 },
      { t: "Printer", at: [100, 126], side: "l", y: 130 },
      { t: "Cable", at: [126, 70], side: "l", y: 94 }
    ]
  });

  F({
    id: "internet",
    name: "Asking the internet",
    cat: "Computers",
    hint: "A request goes out, a page comes back",
    enter: "draw",
    parts: [
      { d: rbox(74, 96, 38, 26, 3), cls: "case" },
      { d: "M74,122 h38 l7,7 h-52 Z", cls: "case" },
      { d: "M80,102 h26 v14 h-26 Z", cls: "screen blink" },
      { d: rbox(126, 100, 30, 16, 3), cls: "case" },
      { d: "M133,94 V100 M149,94 V100", cls: "wire" },
      { d: "M112,108 H126", cls: "wire" },
      { d: "M156,108 H172", cls: "wire" },
      { d: "M176,74 c-10,0 -12,12 -4,15 c-4,8 6,14 12,10 c4,8 18,6 19,-3 c10,1 13,-11 5,-15 c2,-9 -10,-15 -16,-9 c-4,-6 -14,-4 -16,2 Z",
        cls: "cloud" },
      { d: "M212,96 H226 V120", cls: "wire" },
      { d: rbox(206, 120, 34, 34, 3), cls: "case" },
      { d: "M212,128 H234 M212,136 H234 M212,144 H226", cls: "faint" },
      { d: "M112,108 L172,92", cls: "packet packet-a" },
      { d: "M206,132 L120,116", cls: "packet packet-back" }
    ],
    labels: [
      { t: "The internet", at: [192, 74], side: "r", y: 46 },
      { t: "Server", at: [223, 137], side: "r", y: 140 },
      { t: "Request goes out", at: [150, 96], side: "r", y: 82 },
      { t: "Your computer", at: [93, 110], side: "l", y: 104 },
      { t: "Router", at: [141, 108], side: "l", y: 132 },
      { t: "The page comes back", at: [150, 120], side: "l", y: 152 }
    ]
  });

  /* ================================================================
     LIVING THINGS
     ================================================================ */

  F({
    id: "living",
    name: "Living things",
    cat: "Living world",
    hint: "What everything alive does",
    enter: "draw",
    parts: [
      { d: "M90,160 H210", cls: "ground" },
      { d: "M116,160 V104", cls: "stem sway" },
      { d: "M116,124 c-16,-6 -20,-20 -4,-22 c10,-1 8,14 4,22 Z", cls: "leaf sway" },
      { d: "M116,112 c16,-6 20,-20 4,-22 c-10,-1 -8,14 -4,22 Z", cls: "leaf sway" },
      { d: ell(116, 96, 9, 9), cls: "petal grow-late" },
      { d: "M116,160 c-8,8 -14,10 -18,10 M116,160 c8,8 14,10 18,10", cls: "root" },
      { d: ell(184, 132, 22, 15), cls: "body breathe" },
      { d: ell(204, 116, 11, 10), cls: "head breathe" },
      { d: "M170,144 L166,158 M184,146 L182,158 M198,144 L200,158", cls: "leg-a" },
      { d: ell(207, 113, 2, 2), cls: "eye solid" },
      { d: "M212,112 c6,-8 10,-4 6,2", cls: "ear-a" },
      { d: "M162,128 c-8,-4 -10,-10 -4,-12", cls: "tail" }
    ],
    labels: [
      { t: "Grows", at: [116, 96], side: "l", y: 44 },
      { t: "Feeds", at: [116, 118], side: "l", y: 74 },
      { t: "Needs water", at: [110, 166], side: "l", y: 150 },
      { t: "Moves", at: [184, 150], side: "r", y: 150 },
      { t: "Breathes", at: [184, 132], side: "r", y: 118 },
      { t: "Senses and responds", at: [207, 113], side: "r", y: 52 }
    ]
  });

  F({
    id: "nonliving",
    name: "Non-living things",
    cat: "Living world",
    hint: "Same board, nothing alive",
    enter: "draw",
    parts: [
      { d: "M90,160 H210", cls: "ground" },
      { d: "M96,160 c2,-24 16,-32 30,-26 c12,4 14,20 10,26 Z", cls: "rock" },
      { d: "M104,146 L118,138 M110,152 L126,144", cls: "faint" },
      { d: "M144,160 V116 h26 v44 Z", cls: "case" },
      { d: "M144,126 h26", cls: "faint" },
      { d: "M170,130 c12,0 12,16 0,16", cls: "case" },
      { d: "M188,160 V120", cls: "case" },
      { d: "M182,120 h12 v-10 h-12 Z", cls: "case" },
      { d: "M188,110 V96", cls: "case" },
      { d: ell(188, 92, 5, 5), cls: "case" }
    ],
    labels: [
      { t: "Does not grow", at: [112, 142], side: "l", y: 60 },
      { t: "Does not feed", at: [157, 132], side: "l", y: 96 },
      { t: "Does not move by itself", at: [112, 156], side: "l", y: 140 },
      { t: "Rock", at: [120, 150], side: "r", y: 44 },
      { t: "Cup", at: [166, 140], side: "r", y: 88 },
      { t: "Nail", at: [188, 104], side: "r", y: 132 }
    ]
  });

  F({
    id: "plantcell",
    name: "Plant cell",
    cat: "Living world",
    hint: "Wall, chloroplasts, vacuole",
    enter: "draw",
    parts: [
      { d: box(80, 40, 140, 112), cls: "wall" },
      { d: box(86, 46, 128, 100), cls: "membrane" },
      { d: ell(150, 96, 44, 34), cls: "vacuole" },
      { d: ell(108, 74, 14, 12), cls: "nucleus" },
      { d: ell(108, 74, 4, 4), cls: "solid" },
      { d: ell(112, 124, 9, 5), cls: "chloro drift" },
      { d: ell(148, 138, 9, 5), cls: "chloro drift drift-b" },
      { d: ell(186, 116, 9, 5), cls: "chloro drift drift-c" },
      { d: ell(180, 62, 9, 5), cls: "chloro drift drift-b" },
      { d: ell(140, 56, 8, 5), cls: "chloro drift drift-c" },
      { d: "M96,104 c8,-6 14,4 22,-2", cls: "stream flow" },
      { d: "M196,86 c-8,6 -14,-4 -22,2", cls: "stream flow" }
    ],
    labels: [
      { t: "Cell wall", at: [80, 60], side: "l", y: 44 },
      { t: "Membrane", at: [86, 96], side: "l", y: 84 },
      { t: "Nucleus", at: [108, 74], side: "l", y: 122 },
      { t: "Chloroplast", at: [186, 116], side: "r", y: 130 },
      { t: "Vacuole", at: [168, 96], side: "r", y: 88 },
      { t: "Cytoplasm", at: [196, 86], side: "r", y: 46 }
    ]
  });

  F({
    id: "animalcell",
    name: "Animal cell",
    cat: "Living world",
    hint: "No wall, no chloroplasts",
    enter: "draw",
    parts: [
      { d: "M150,38 c40,0 66,24 66,56 c0,34 -30,58 -66,58 c-38,0 -66,-24 -66,-58 c0,-32 28,-56 66,-56 Z",
        cls: "membrane" },
      { d: ell(140, 92, 22, 19), cls: "nucleus" },
      { d: ell(140, 92, 6, 6), cls: "solid" },
      { d: "M96,72 c10,-10 22,-2 12,8 c-8,8 -20,2 -12,-8 Z", cls: "mito drift" },
      { d: "M186,120 c10,-10 22,-2 12,8 c-8,8 -20,2 -12,-8 Z", cls: "mito drift drift-b" },
      { d: "M180,62 c10,-10 22,-2 12,8 c-8,8 -20,2 -12,-8 Z", cls: "mito drift drift-c" },
      { d: "M104,124 c8,-8 18,-2 10,7 c-7,6 -17,1 -10,-7 Z", cls: "mito drift drift-b" },
      { d: "M118,120 c10,6 24,4 30,-4", cls: "stream flow" },
      { d: "M170,88 c-10,-6 -22,-4 -28,2", cls: "stream flow" }
    ],
    labels: [
      { t: "Cell membrane", at: [88, 100], side: "l", y: 52 },
      { t: "Nucleus", at: [140, 92], side: "l", y: 96 },
      { t: "Cytoplasm", at: [124, 122], side: "l", y: 140 },
      { t: "Mitochondrion", at: [192, 126], side: "r", y: 132 },
      { t: "No cell wall", at: [212, 84], side: "r", y: 60 },
      { t: "No chloroplasts", at: [186, 66], side: "r", y: 42 }
    ]
  });

  F({
    id: "photosynthesis",
    name: "Photosynthesis",
    cat: "Living world",
    hint: "Light in, food and oxygen out",
    enter: "draw",
    parts: [
      { d: "M90,160 H210", cls: "ground" },
      { d: "M150,160 V96", cls: "stem sway" },
      { d: "M150,116 c-30,-10 -38,-32 -8,-36 c18,-2 14,24 8,36 Z", cls: "leaf sway" },
      { d: "M150,106 c30,-10 38,-32 8,-36 c-18,-2 -14,24 -8,36 Z", cls: "leaf sway" },
      { d: "M150,160 c-10,10 -18,12 -24,12 M150,160 c10,10 18,12 24,12", cls: "root" },
      { d: ell(96, 48, 12, 12), cls: "sun pulse" },
      { d: "M96,30 V22 M80,48 H72 M84,36 L78,30 M108,36 L114,30 M84,60 L78,66",
        cls: "ray pulse" },
      { d: arrow(110, 58, 132, 78), cls: "in-arrow flow" },
      { d: arrow(206, 68, 176, 82), cls: "in-arrow flow" },
      { d: arrow(168, 62, 196, 44), cls: "out-arrow flow" },
      { d: arrow(150, 150, 150, 122), cls: "up-arrow flow" }
    ],
    labels: [
      { t: "Sunlight", at: [96, 48], side: "l", y: 40 },
      { t: "Water from the roots", at: [150, 146], side: "l", y: 140 },
      { t: "Leaf", at: [134, 96], side: "l", y: 96 },
      { t: "Carbon dioxide in", at: [200, 70], side: "r", y: 94 },
      { t: "Oxygen out", at: [194, 46], side: "r", y: 42 },
      { t: "Sugar made in the leaf", at: [158, 110], side: "r", y: 130 }
    ]
  });

  F({
    id: "foodchain",
    name: "Food chain",
    cat: "Living world",
    hint: "Energy passes along, one arrow at a time",
    enter: "draw",
    parts: [
      { d: ell(86, 62, 11, 11), cls: "sun pulse" },
      { d: "M86,46 V38 M72,62 H64 M74,50 L68,44 M74,74 L68,80", cls: "ray pulse" },
      { d: "M78,132 V112 M86,132 V106 M94,132 V114", cls: "grass sway" },
      { d: "M70,132 H102", cls: "ground" },
      { d: ell(140, 122, 13, 8), cls: "body" },
      { d: "M132,128 L128,134 M146,128 L150,134", cls: "leg-a" },
      { d: "M150,118 c6,-6 8,-2 4,2", cls: "ear-a" },
      { d: "M126,132 H156", cls: "ground" },
      { d: ell(186, 116, 14, 10), cls: "body" },
      { d: "M196,110 c8,-4 10,2 2,4", cls: "beak" },
      { d: "M180,124 L178,132 M190,124 L190,132", cls: "leg-a" },
      { d: "M172,116 c8,-10 20,-10 24,0", cls: "wing-r" },
      { d: "M170,132 H204", cls: "ground" },
      { d: arrow(98, 74, 116, 104), cls: "step step-1" },
      { d: arrow(112, 122, 124, 122), cls: "step step-2" },
      { d: arrow(158, 120, 170, 118), cls: "step step-3" }
    ],
    labels: [
      { t: "The sun starts it", at: [86, 62], side: "l", y: 46 },
      { t: "Grass — producer", at: [86, 118], side: "l", y: 110 },
      { t: "Grasshopper", at: [140, 122], side: "l", y: 148 },
      { t: "Energy passes on", at: [118, 110], side: "r", y: 62 },
      { t: "Bird — consumer", at: [186, 116], side: "r", y: 104 },
      { t: "Each arrow points at the eater", at: [164, 119], side: "r", y: 146 }
    ]
  });

  /* ================================================================
     MATTER AND MIXTURES
     ================================================================ */

  F({
    id: "states",
    name: "Solid, liquid, gas",
    cat: "Matter",
    hint: "The same particles, packed differently",
    enter: "draw",
    parts: [
      { d: box(74, 60, 48, 48), cls: "vessel" },
      { d: box(126, 60, 48, 48), cls: "vessel" },
      { d: box(178, 60, 48, 48), cls: "vessel" },
      { d: ell(86, 72, 5, 5), cls: "grain buzz" },
      { d: ell(98, 72, 5, 5), cls: "grain buzz buzz-b" },
      { d: ell(110, 72, 5, 5), cls: "grain buzz buzz-c" },
      { d: ell(86, 84, 5, 5), cls: "grain buzz buzz-c" },
      { d: ell(98, 84, 5, 5), cls: "grain buzz" },
      { d: ell(110, 84, 5, 5), cls: "grain buzz buzz-b" },
      { d: ell(86, 96, 5, 5), cls: "grain buzz buzz-b" },
      { d: ell(98, 96, 5, 5), cls: "grain buzz buzz-c" },
      { d: ell(110, 96, 5, 5), cls: "grain buzz" },
      { d: ell(138, 86, 5, 5), cls: "grain slide" },
      { d: ell(152, 92, 5, 5), cls: "grain slide slide-b" },
      { d: ell(164, 84, 5, 5), cls: "grain slide slide-c" },
      { d: ell(144, 98, 5, 5), cls: "grain slide slide-c" },
      { d: ell(158, 100, 5, 5), cls: "grain slide" },
      { d: "M126,78 H174", cls: "surface" },
      { d: ell(190, 70, 5, 5), cls: "grain dart" },
      { d: ell(212, 82, 5, 5), cls: "grain dart dart-b" },
      { d: ell(196, 98, 5, 5), cls: "grain dart dart-c" },
      { d: ell(216, 66, 5, 5), cls: "grain dart dart-b" },
      { d: ell(202, 84, 5, 5), cls: "grain dart dart-c" }
    ],
    labels: [
      { t: "Solid — packed and vibrating", at: [98, 84], side: "l", y: 44 },
      { t: "Fixed shape", at: [98, 108], side: "l", y: 128 },
      { t: "Liquid — sliding past", at: [150, 92], side: "r", y: 40 },
      { t: "Takes the shape of the jar", at: [150, 108], side: "r", y: 128 },
      { t: "Gas — flying about", at: [204, 82], side: "r", y: 148 },
      { t: "Fills everything", at: [222, 60], side: "l", y: 148 }
    ]
  });

  F({
    id: "glass",
    name: "Water in a glass",
    cat: "Matter",
    hint: "Surface, meniscus, level",
    enter: "pour",
    parts: [
      { d: "M112,38 L120,152 h60 L188,38", cls: "glass vessel" },
      { d: "M116,152 h68", cls: "vessel" },
      { d: "M124,84 L131,150 h38 L176,84 Z", cls: "water fill" },
      { d: "M124,84 c8,6 44,6 52,0", cls: "surface wave" },
      { d: "M124,84 c2,4 6,5 8,2", cls: "meniscus" },
      { d: "M176,84 c-2,4 -6,5 -8,2", cls: "meniscus" },
      { d: ell(140, 140, 3, 3), cls: "bubble rise" },
      { d: ell(156, 146, 2.4, 2.4), cls: "bubble rise rise-b" },
      { d: ell(148, 134, 2, 2), cls: "bubble rise rise-c" },
      { d: "M132,52 c6,3 30,3 36,0", cls: "faint" }
    ],
    labels: [
      { t: "Glass", at: [116, 110], side: "l", y: 60 },
      { t: "Water", at: [140, 120], side: "l", y: 108 },
      { t: "Bubbles of air", at: [148, 140], side: "l", y: 148 },
      { t: "Air above the water", at: [150, 56], side: "r", y: 42 },
      { t: "Surface", at: [162, 86], side: "r", y: 82 },
      { t: "Meniscus — it curves at the glass", at: [176, 86], side: "r", y: 122 }
    ]
  });

  F({
    id: "oilwater",
    name: "Oil and water",
    cat: "Matter",
    hint: "Shaken, and then separating again",
    enter: "pour",
    parts: [
      { d: "M122,36 v122 h56 V36", cls: "glass vessel" },
      { d: "M122,36 h56", cls: "faint" },
      { d: "M126,64 h48 v34 h-48 Z", cls: "oil fill" },
      { d: "M126,98 h48 v58 h-48 Z", cls: "water fill" },
      { d: "M126,98 h48", cls: "boundary" },
      { d: "M126,64 c8,4 40,4 48,0", cls: "surface wave" },
      { d: ell(140, 120, 5, 4), cls: "droplet climb" },
      { d: ell(160, 136, 4, 3), cls: "droplet climb climb-b" },
      { d: ell(150, 110, 3, 2.6), cls: "droplet climb climb-c" },
      { d: "M186,64 V98", cls: "brace" },
      { d: "M186,98 V156", cls: "brace" }
    ],
    labels: [
      { t: "Oil floats — it is less dense", at: [126, 80], side: "l", y: 56 },
      { t: "Water", at: [126, 128], side: "l", y: 122 },
      { t: "Drops rise back to the oil", at: [140, 120], side: "l", y: 152 },
      { t: "They do not mix", at: [178, 98], side: "r", y: 46 },
      { t: "Boundary", at: [174, 98], side: "r", y: 98 },
      { t: "Two layers, always this way round", at: [186, 130], side: "r", y: 140 }
    ]
  });

  F({
    id: "saltwater",
    name: "Salt in water",
    cat: "Matter",
    hint: "It dissolves — it does not disappear",
    enter: "draw",
    parts: [
      { d: "M112,60 v92 c0,6 6,8 12,8 h52 c6,0 12,-2 12,-8 V60", cls: "glass vessel" },
      { d: "M112,60 h76", cls: "faint" },
      { d: "M116,88 h68 v66 c0,4 -4,6 -8,6 h-52 c-4,0 -8,-2 -8,-6 Z", cls: "water fill" },
      { d: "M116,88 c10,5 58,5 68,0", cls: "surface wave" },
      { d: "M150,30 c-12,4 -14,14 -4,16 h8 c10,-2 8,-12 -4,-16 Z", cls: "spoon" },
      { d: "M154,34 L186,24", cls: "spoon" },
      { d: "M144,52 h5 v5 h-5 Z", cls: "crystal sink" },
      { d: "M156,52 h4 v4 h-4 Z", cls: "crystal sink sink-b" },
      { d: "M150,52 h4 v4 h-4 Z", cls: "crystal sink sink-c" },
      { d: "M132,120 h3 v3 h-3 Z", cls: "crystal fade" },
      { d: "M166,132 h2.6 v2.6 h-2.6 Z", cls: "crystal fade fade-b" },
      /* In the water, where a stirring rod belongs. It was standing beside
       * the beaker, next to a second part that was a curve back to where it
       * started — a stir with nothing to stir and nothing to see. */
      { d: "M172,44 L158,138", cls: "rod stir" }
    ],
    labels: [
      { t: "Salt — the solute", at: [150, 44], side: "l", y: 40 },
      { t: "It breaks up as it falls", at: [150, 66], side: "l", y: 78 },
      { t: "Water — the solvent", at: [122, 120], side: "l", y: 128 },
      { t: "Stirring rod", at: [170, 52], side: "r", y: 46 },
      { t: "The water stays clear", at: [178, 110], side: "r", y: 100 },
      { t: "Salt water — a solution", at: [150, 150], side: "r", y: 146 }
    ]
  });

  F({
    id: "filtration",
    name: "Filtering",
    cat: "Matter",
    hint: "What stays behind, what runs through",
    enter: "draw",
    parts: [
      { d: "M104,40 h92", cls: "stand" },
      { d: "M104,40 V160", cls: "stand" },
      { d: "M96,160 h30", cls: "stand" },
      { d: "M132,54 h64 l-26,34 v20 h-12 V88 Z", cls: "vessel" },
      { d: "M140,58 h48 l-24,30 Z", cls: "paper" },
      { d: "M150,72 h12 l-6,8 Z", cls: "residue" },
      { d: ell(164, 118, 2.4, 3), cls: "drip" },
      { d: ell(164, 132, 2.2, 2.8), cls: "drip drip-b" },
      { d: "M138,140 v22 c0,4 4,6 8,6 h36 c4,0 8,-2 8,-6 v-22", cls: "vessel" },
      { d: "M140,150 h50 v14 c0,3 -3,4 -6,4 h-38 c-3,0 -6,-1 -6,-4 Z", cls: "water fill" },
      { d: "M140,150 c8,4 42,4 50,0", cls: "surface wave" }
    ],
    labels: [
      { t: "Filter funnel", at: [136, 62], side: "l", y: 52 },
      { t: "Filter paper", at: [150, 74], side: "l", y: 86 },
      { t: "Residue stays on top", at: [156, 76], side: "l", y: 120 },
      { t: "Drips through", at: [164, 124], side: "r", y: 106 },
      { t: "Filtrate", at: [164, 156], side: "r", y: 150 },
      { t: "Beaker", at: [190, 158], side: "r", y: 60 }
    ]
  });

  /* ================================================================
     EARTH AND SPACE
     ================================================================ */

  F({
    id: "soil",
    name: "Soil",
    cat: "Earth",
    hint: "Down through the layers",
    enter: "draw",
    parts: [
      { d: box(84, 40, 132, 124), cls: "vessel" },
      { d: "M84,58 H216", cls: "layer" },
      { d: "M84,92 H216", cls: "layer" },
      { d: "M84,126 H216", cls: "layer" },
      { d: "M92,50 c6,-8 12,-8 18,0 M130,50 c6,-8 12,-8 18,0 M170,50 c6,-8 12,-8 18,0",
        cls: "litter" },
      { d: "M96,70 h4 v4 h-4 Z M120,78 h3 v3 h-3 Z M150,68 h4 v4 h-4 Z M186,80 h3 v3 h-3 Z",
        cls: "grain" },
      { d: "M100,104 c8,-4 14,4 22,-2 M150,110 c8,-4 14,4 22,-2", cls: "faint" },
      { d: "M96,140 c14,-10 26,6 40,-4 c14,-8 26,8 40,-2 c10,-6 18,2 24,0",
        cls: "rock" },
      { d: "M110,44 V58 c-4,10 -8,16 -6,30 c2,12 -4,18 -6,26", cls: "root grow-late" },
      { d: "M110,52 c10,4 14,10 16,18", cls: "root grow-late" },
      { d: "M150,84 c10,-6 18,2 10,8 c-8,6 -18,-2 -10,-8 Z", cls: "worm wriggle" },
      { d: ell(196, 66, 3, 4), cls: "drip soak" }
    ],
    labels: [
      { t: "Leaf litter", at: [110, 48], side: "l", y: 40 },
      { t: "Topsoil — dark, full of life", at: [100, 74], side: "l", y: 76 },
      { t: "Subsoil", at: [100, 108], side: "l", y: 116 },
      { t: "Roots reach down", at: [104, 100], side: "l", y: 150 },
      { t: "Water soaks through", at: [196, 70], side: "r", y: 54 },
      { t: "Broken rock, then bedrock", at: [176, 140], side: "r", y: 128 }
    ]
  });

  F({
    id: "watercycle",
    name: "Water cycle",
    cat: "Earth",
    hint: "Up, across, down, back",
    enter: "draw",
    parts: [
      { d: "M74,150 h152", cls: "ground" },
      { d: "M74,150 c26,-4 54,-4 80,0 c22,4 50,4 72,0 V178 H74 Z", cls: "sea water fill" },
      { d: "M74,138 c20,-6 44,-6 64,0", cls: "surface wave" },
      { d: ell(94, 44, 11, 11), cls: "sun pulse" },
      { d: "M94,28 V20 M80,44 H72 M82,32 L76,26", cls: "ray pulse" },
      { d: "M152,52 c-12,0 -14,14 -4,17 c-2,9 8,15 15,10 c5,8 20,5 21,-4 c11,0 13,-13 4,-17 c1,-10 -12,-16 -18,-9 c-5,-6 -16,-4 -18,3 Z",
        cls: "cloud" },
      { d: arrow(110, 132, 128, 78), cls: "up-arrow flow" },
      { d: arrow(200, 74, 208, 120), cls: "down-arrow flow" },
      { d: "M158,90 V102 M170,92 V104 M182,90 V102", cls: "rain fall" },
      { d: "M164,104 V116 M176,106 V118", cls: "rain fall fall-b" },
      { d: "M216,124 c-10,10 -20,14 -30,20", cls: "river flow" },
      { d: "M190,60 c10,-6 20,-2 24,4", cls: "wind flow" }
    ],
    labels: [
      { t: "The sun heats the sea", at: [94, 44], side: "l", y: 38 },
      { t: "Evaporation", at: [118, 104], side: "l", y: 86 },
      { t: "The sea", at: [96, 146], side: "l", y: 142 },
      { t: "Condensation — clouds form", at: [170, 62], side: "r", y: 44 },
      { t: "Rain falls", at: [172, 104], side: "r", y: 96 },
      { t: "It runs back to the sea", at: [204, 132], side: "r", y: 142 }
    ]
  });

  F({
    id: "solarsystem",
    name: "Sun and planets",
    cat: "Earth",
    hint: "Everything goes round, at its own speed",
    enter: "draw",
    parts: [
      { d: ell(150, 96, 18, 18), cls: "sun pulse solid-faint" },
      { d: "M150,72 V64 M150,120 V128 M126,96 H118 M174,96 H182 M133,79 L127,73 M167,113 L173,119",
        cls: "ray pulse" },
      /* Circles, not ellipses. A planet moved by a CSS rotation travels a
       * circle, so an ellipse drawn under it is a path the planet does not
       * follow — it wandered off the line twice an orbit. */
      { d: ell(150, 96, 32, 32), cls: "orbit-path" },
      { d: ell(150, 96, 52, 52), cls: "orbit-path" },
      { d: ell(150, 96, 72, 72), cls: "orbit-path" },
      { d: ell(182, 96, 4, 4), cls: "planet orbit-a solid" },
      { d: ell(202, 96, 6, 6), cls: "planet orbit-b solid" },
      { d: ell(222, 96, 5, 5), cls: "planet orbit-c solid" },
      /* The moon keeps its planet's class, so it travels with it rather than
       * setting off round the sun on its own. */
      { d: ell(212, 96, 2.4, 2.4), cls: "moon orbit-b" }
    ],
    labels: [
      { t: "The sun", at: [150, 96], side: "l", y: 60 },
      { t: "Orbit", at: [98, 96], side: "l", y: 104 },
      { t: "A planet takes its own time", at: [150, 142], side: "l", y: 146 },
      { t: "Nearest — quickest", at: [182, 96], side: "r", y: 48 },
      { t: "Earth", at: [202, 96], side: "r", y: 92 },
      { t: "Its moon travels with it", at: [212, 96], side: "r", y: 138 }
    ]
  });

})(window);
