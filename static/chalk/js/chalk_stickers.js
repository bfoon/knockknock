/* Chalk — emoji and extra shapes.
 *
 * Two galleries that both end up as ordinary elements on the board.
 *
 * EMOJI are text elements. An emoji is a character, so a sticker of one is a
 * text element holding that character — nothing to draw, nothing to store,
 * nothing to load, and it arrives in colour. Anything the board can do to
 * text it can do to these: resize, turn, shadow, send behind the writing.
 *
 * SHAPES are free shapes with their points written out. The built-in shape
 * list is fixed in chalk_shapes.js, but a free shape carries its own
 * geometry, so a heart or a lightning bolt can be added here without
 * touching the renderer — and every one of them can have its corners
 * dragged afterwards, which a built-in shape cannot.
 *
 * Points are in the shape's own 0..100 box. The board stretches that box to
 * wherever the element is, so nothing here needs to know the board's size.
 *
 * window.ChalkStickers = { emoji, shapes, shapeCats }
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* emoji                                                               */
  /*                                                                     */
  /* Stored as one string per row and split on spaces: a few thousand    */
  /* characters instead of a few thousand lines of array punctuation.    */
  /* No names — a screen reader announces an emoji from the character    */
  /* itself, so a name here would be a second, worse one.                */
  /* ------------------------------------------------------------------ */

  var EMOJI = [
    ["Faces",
      "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 " +
      "😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 " +
      "🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 " +
      "😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖 " +
      "😺 😸 😹 😻 😼 😽 🙀 😿 😾"],
    ["People",
      "👋 🤚 🖐 ✋ 👌 🤏 ✌ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 " +
      "👐 🤲 🤝 🙏 💪 🦵 👂 👃 🧠 👀 👁 👄 🧑 👦 👧 👨 👩 🧓 👶 🧕 👮 👷 💂 " +
      "🕵 👨‍🌾 👩‍🌾 👨‍🍳 👩‍🍳 👨‍🎓 👩‍🎓 👨‍🏫 👩‍🏫 👨‍⚕ 👩‍⚕ 👨‍🔧 👩‍🔧 👨‍🔬 👩‍🔬 👨‍💻 👩‍💻 👨‍🚀 👩‍🚀 " +
      "🧑‍🚒 🤴 👸 🦸 🦹 🧙 🧚 🧜 🧞 🚶 🏃 💃 🕺 👪 👥"],
    ["Animals",
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 " +
      "🐣 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦗 🕷 🦂 🐢 🐍 🦎 🦖 🦕 " +
      "🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 " +
      "🦘 🐃 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🦚 🦜 🦢 🕊 🐇 🦝 🦡 🐁 " +
      "🐀 🐿 🦔 🐾"],
    ["Food",
      "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 " +
      "🌶 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🍔 🍟 🍕 🌭 " +
      "🥪 🌮 🌯 🥙 🧆 🥘 🍲 🥣 🥗 🍿 🧂 🍚 🍛 🍜 🍣 🍤 🍡 🥟 🍦 🍩 🍪 🎂 🍰 " +
      "🧁 🥧 🍫 🍬 🍭 🍯 🍼 🥛 ☕ 🍵 🧃 🥤 🧊 🍽 🍴 🥄"],
    ["Nature",
      "🌱 🌿 ☘ 🍀 🎋 🍃 🍂 🍁 🌾 🌵 🌴 🌳 🌲 🪴 🌺 🌸 💐 🌼 🌻 🌹 🥀 🌷 🏵 " +
      "🌰 🎃 🐚 🪨 🌍 🌎 🌏 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 ⭐ 🌟 ✨ ⚡ ☄ 💥 🔥 " +
      "🌈 ☀ 🌤 ⛅ 🌥 ☁ 🌦 🌧 ⛈ 🌩 🌨 ❄ ☃ ⛄ 🌬 💨 🌪 🌫 🌊 💧 💦 ☔ 🏔 ⛰ " +
      "🌋 🏕 🏞 🏜 🏝"],
    ["School",
      "📚 📖 📕 📗 📘 📙 📔 📓 📒 📝 ✏ ✒ 🖊 🖋 🖌 🖍 📏 📐 📌 📍 📎 🖇 ✂ " +
      "📁 📂 🗂 📅 📆 🗓 📇 🗒 🗃 📋 📊 📈 📉 🔍 🔎 🔬 🔭 🧪 🧫 🧬 ⚗ 🧮 🖥 " +
      "💻 ⌨ 🖱 🖨 💾 📱 ☎ 📞 📠 📺 📻 🔔 📢 📣 ⏰ ⏳ ⌛ 🕐 📦 ✉ 📧 📨 📩 " +
      "🎓 🏫 🚪 🪑 💡 🔑 🔒 🔓 🗝 🔨 🪓 🔧 🪛 ⚙ 🧰 🧲 🔋 🔌 🧹 🧺 🪣 🧼"],
    ["Sport",
      "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🥅 🏒 🏑 🥍 🏏 ⛳ 🪁 🏹 🎣 🤿 " +
      "🥊 🥋 🎽 🛹 🛼 🛷 ⛸ 🥌 🎿 ⛷ 🏂 🏋 🤼 🤸 ⛹ 🤺 🤾 🏌 🏇 🧘 🏊 🚴 🚵 " +
      "🏆 🥇 🥈 🥉 🏅 🎖 🎯 🎲 🧩 🎮 🎰 🎨 🎭 🎬 🎤 🎧 🎼 🎵 🎶 🥁 🎹 🎷 🎺 " +
      "🎸 🪕 🎻 🪘"],
    ["Travel",
      "🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🛴 🚲 🛵 🏍 🛺 🚨 🚔 " +
      "🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈ 🛫 🛬 🛩 💺 " +
      "🛰 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥 🛳 ⛴ 🚢 ⚓ ⛽ 🚧 🚦 🚥 🗺 🗿 🗽 🗼 🏰 🏯 🏟 " +
      "🎡 🎢 🎠 ⛲ ⛱ 🏖 🏠 🏡 🏘 🏢 🏬 🏭 🏥 🏦 🏨 🏪 🏩 💒 ⛪ 🕌 🛕 🕍 ⛩ " +
      "🌁 🌃 🏙 🌄 🌅 🌆 🌇 🌉 🌌 🎆 🎇 🎑"],
    ["Symbols",
      "❤ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣ 💕 💞 💓 💗 💖 💘 💝 ✅ ❌ ❎ ✔ ✖ ➕ " +
      "➖ ➗ 🟰 ♾ ❓ ❔ ❗ ❕ ‼ ⁉ 💯 🔥 ⭐ 🌟 💫 ⚠ 🚫 ⛔ ♻ ✳ ❇ ✴ 🔱 ⚜ 🔰 " +
      "⭕ 🆗 🆕 🆒 🆓 🆙 🔝 🔙 🔛 🔜 🔚 🔤 🔡 🔠 🔢 🔣 ℹ 🅰 🅱 🅾 🆎 🈶 🚻 🚹 " +
      "🚺 ♿ 🚼 🛗 🚮 🔞 📵 🚭 ⬆ ↗ ➡ ↘ ⬇ ↙ ⬅ ↖ ↕ ↔ ↩ ↪ ⤴ ⤵ 🔃 🔄 🔀 🔁 " +
      "🔂 ▶ ⏸ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ 🔼 🔽 ⏫ ⏬"],
    ["Shapes",
      "🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ ◼ ◻ ◾ ◽ ▪ ▫ " +
      "🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲 ♠ ♥ ♦ ♣ ♟ 🀄 🎴 🃏 🕐 🕑 🕒 🕓 🕔 🕕 " +
      "🕖 🕗 🕘 🕙 🕚 🕛"]
  ].map(function (row) {
    return { name: row[0], chars: row[1].split(" ").filter(Boolean) };
  });

  /* ------------------------------------------------------------------ */
  /* extra shapes                                                        */
  /* ------------------------------------------------------------------ */

  function ring(cx, cy, r, from, to, steps, squash) {
    var out = [], i;
    for (i = 0; i <= steps; i++) {
      var a = (from + (to - from) * i / steps) * Math.PI / 180;
      out.push(
        Math.round((cx + Math.cos(a) * r) * 10) / 10,
        Math.round((cy + Math.sin(a) * r * (squash == null ? 1 : squash)) * 10) / 10
      );
    }
    return out;
  }

  /* Alternating long and short spokes — one generator covers stars,
   * bursts, cogs, seals and flowers, which are all the same idea with
   * different numbers in it. */
  function spokes(points, outer, inner, rounded) {
    var out = [], i;
    for (i = 0; i < points * 2; i++) {
      var a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      var r = i % 2 ? inner : outer;
      out.push(
        Math.round((50 + Math.cos(a) * r) * 10) / 10,
        Math.round((50 + Math.sin(a) * r) * 10) / 10
      );
    }
    return { pts: out, edge: rounded ? "smooth" : "sharp", radius: 18 };
  }

  function S(cat, id, name, pts, opts) {
    opts = opts || {};
    LIST.push({
      cat: cat, id: id, name: name, pts: pts,
      closed: opts.closed !== false,
      edge: opts.edge || "sharp",
      radius: opts.radius == null ? 14 : opts.radius,
      wide: !!opts.wide
    });
  }

  var LIST = [];

  /* ---- everyday ---- */
  S("Everyday", "heart", "Heart",
    [50, 96, 12, 58, 6, 34, 20, 14, 38, 14, 50, 30, 62, 14, 80, 14, 94, 34, 88, 58],
    { edge: "smooth", radius: 26 });
  S("Everyday", "cloud", "Cloud",
    [18, 78, 6, 66, 8, 50, 22, 42, 30, 26, 50, 18, 68, 24, 78, 38, 92, 46, 94, 64, 84, 78],
    { edge: "smooth", radius: 30, wide: true });
  S("Everyday", "bubble", "Speech bubble",
    [8, 8, 92, 8, 92, 64, 44, 64, 22, 94, 26, 64, 8, 64],
    { edge: "round", radius: 16, wide: true });
  /* A ring of shallow bumps. Nine evenly spaced points came out as a plain
   * oval, which is a shape the board already has. */
  S("Everyday", "think", "Thought bubble", spokes(9, 48, 38, true).pts,
    { edge: "smooth", radius: 44 });
  S("Everyday", "bolt", "Lightning",
    [56, 2, 18, 54, 44, 54, 34, 98, 80, 42, 52, 42]);
  S("Everyday", "tick", "Tick",
    [12, 52, 26, 38, 42, 56, 76, 12, 90, 26, 42, 86]);
  S("Everyday", "xmark", "Cross",
    [20, 8, 50, 38, 80, 8, 92, 20, 62, 50, 92, 80, 80, 92, 50, 62, 20, 92, 8, 80, 38, 50, 8, 20]);
  S("Everyday", "plus", "Plus",
    [38, 8, 62, 8, 62, 38, 92, 38, 92, 62, 62, 62, 62, 92, 38, 92, 38, 62, 8, 62, 8, 38, 38, 38]);
  /* Points crowd together near the top so the smoothing cannot round the
   * tip away — which it did, and a flame with no point is a balloon. */
  S("Everyday", "flame", "Flame",
    [50, 2, 57, 14, 61, 28, 57, 40, 74, 48, 82, 70, 66, 92, 40, 96, 19, 82,
     17, 58, 33, 48, 37, 30, 43, 15],
    { edge: "smooth", radius: 12 });
  S("Everyday", "drop", "Drop",
    [50, 4, 68, 32, 84, 58, 78, 82, 50, 96, 22, 82, 16, 58, 32, 32],
    { edge: "smooth", radius: 26 });
  S("Everyday", "leaf", "Leaf",
    [6, 94, 18, 52, 50, 18, 94, 6, 82, 48, 48, 82],
    { edge: "smooth", radius: 30 });
  S("Everyday", "moon", "Crescent moon",
    (function () {
      var out = ring(58, 50, 46, 55, 305, 14), back = [], i;
      var inner = ring(58, 50, 46, 55, 305, 14);
      for (i = inner.length - 2; i >= 0; i -= 2) {
        var t = 1 - (i / 2) / 14;
        var pull = Math.sin(t * Math.PI) * 34;
        var ax = inner[i] - 58, ay = inner[i + 1] - 50;
        var len = Math.sqrt(ax * ax + ay * ay) || 1;
        back.push(
          Math.round((58 + ax / len * (46 - pull)) * 10) / 10,
          Math.round((50 + ay / len * (46 - pull)) * 10) / 10
        );
      }
      return out.concat(back);
    })(),
    { edge: "smooth", radius: 10 });

  /* ---- arrows ---- */
  S("Arrows", "arrow-up", "Arrow up",
    [50, 4, 94, 46, 68, 46, 68, 96, 32, 96, 32, 46, 6, 46]);
  S("Arrows", "arrow-down", "Arrow down",
    [50, 96, 94, 54, 68, 54, 68, 4, 32, 4, 32, 54, 6, 54]);
  S("Arrows", "arrow-left", "Arrow left",
    [4, 50, 46, 6, 46, 32, 96, 32, 96, 68, 46, 68, 46, 94]);
  S("Arrows", "arrow-right", "Arrow right",
    [96, 50, 54, 6, 54, 32, 4, 32, 4, 68, 54, 68, 54, 94]);
  S("Arrows", "arrow-both", "Arrow both ways",
    [4, 50, 28, 18, 28, 38, 72, 38, 72, 18, 96, 50, 72, 82, 72, 62, 28, 62, 28, 82],
    { wide: true });
  S("Arrows", "arrow-bent", "Bent arrow",
    [8, 96, 8, 36, 56, 36, 56, 14, 94, 48, 56, 82, 56, 60, 32, 60, 32, 96]);
  S("Arrows", "arrow-curve", "Curved arrow",
    [6, 92, 10, 58, 30, 32, 60, 22, 60, 6, 96, 34, 60, 58, 60, 42, 40, 50, 28, 68, 26, 92],
    { edge: "smooth", radius: 14 });
  S("Arrows", "chevron", "Chevron",
    [8, 6, 46, 50, 8, 94, 44, 94, 82, 50, 44, 6], { wide: true });
  S("Arrows", "arrow-return", "Return arrow",
    [4, 62, 34, 34, 34, 50, 66, 50, 66, 8, 92, 8, 92, 76, 34, 76, 34, 92]);

  /* ---- badges ---- */
  S("Badges", "shield", "Shield",
    /* Square shoulders and a flat top. Smoothing a point at the apex turned
     * this into a rounded triangle. */
    [10, 6, 90, 6, 88, 40, 82, 64, 50, 96, 18, 64, 12, 40],
    { edge: "smooth", radius: 8 });
  S("Badges", "star4", "Sparkle", spokes(4, 48, 12).pts);
  S("Badges", "star6", "Six-point star", spokes(6, 48, 22).pts);
  S("Badges", "star8", "Eight-point star", spokes(8, 48, 26).pts);
  S("Badges", "burst", "Burst", spokes(14, 48, 32).pts);
  S("Badges", "seal", "Seal", spokes(12, 48, 40, true).pts,
    { edge: "smooth", radius: 24 });
  /* Four points a tooth — two along the top of it and two in the gap.
   * Triangular spokes make a star, not a cog. */
  S("Badges", "cog", "Cog", (function () {
    var out = [], teeth = 9, i;
    for (i = 0; i < teeth; i++) {
      var step = Math.PI * 2 / teeth;
      var a = i * step - Math.PI / 2;
      [[a - step * 0.16, 48], [a + step * 0.16, 48],
       [a + step * 0.3, 34], [a + step * 0.7, 34]].forEach(function (p) {
        out.push(
          Math.round((50 + Math.cos(p[0]) * p[1]) * 10) / 10,
          Math.round((50 + Math.sin(p[0]) * p[1]) * 10) / 10
        );
      });
    }
    return out;
  })());
  S("Badges", "flower", "Flower", spokes(7, 48, 34, true).pts,
    { edge: "smooth", radius: 50 });
  S("Badges", "sun", "Sun", spokes(16, 48, 30).pts);
  S("Badges", "banner", "Banner",
    [6, 14, 94, 14, 94, 70, 50, 56, 6, 70], { wide: true });
  S("Badges", "ribbon", "Ribbon",
    [4, 12, 96, 12, 96, 62, 84, 62, 96, 94, 68, 80, 50, 94, 32, 80, 4, 94,
     16, 62, 4, 62],
    { wide: true });
  S("Badges", "bookmark", "Bookmark",
    [16, 4, 84, 4, 84, 96, 50, 70, 16, 96]);
  S("Badges", "tag", "Tag",
    [4, 50, 40, 6, 96, 6, 96, 94, 40, 94], { wide: true });
  S("Badges", "plaque", "Plaque",
    [4, 22, 22, 4, 78, 4, 96, 22, 96, 78, 78, 96, 22, 96, 4, 78], { wide: true });

  /* ---- structures ---- */
  S("Structures", "pent-house", "House shape",
    [50, 4, 96, 38, 96, 96, 4, 96, 4, 38]);
  S("Structures", "arch", "Arch",
    [8, 96, 8, 46].concat(ring(50, 46, 42, 180, 360, 12), [92, 96]));
  S("Structures", "semi", "Half circle",
    ring(50, 84, 46, 180, 360, 16).concat([96, 84]), { wide: true });
  S("Structures", "quarter", "Quarter circle",
    [6, 94].concat(ring(6, 94, 88, 270, 360, 10)));
  S("Structures", "wave", "Wave",
    [2, 60, 18, 30, 34, 60, 50, 30, 66, 60, 82, 30, 98, 60],
    { closed: false, edge: "smooth", radius: 30, wide: true });
  S("Structures", "zigzag", "Zigzag",
    [2, 70, 18, 24, 34, 70, 50, 24, 66, 70, 82, 24, 98, 70],
    { closed: false, wide: true });
  S("Structures", "steps", "Steps",
    [4, 96, 4, 72, 28, 72, 28, 50, 52, 50, 52, 28, 76, 28, 76, 6, 96, 6, 96, 96]);
  S("Structures", "bracket-l", "Left bracket",
    [66, 4, 34, 4, 34, 96, 66, 96], { closed: false });
  S("Structures", "bracket-r", "Right bracket",
    [34, 4, 66, 4, 66, 96, 34, 96], { closed: false });
  S("Structures", "blob", "Blob",
    [30, 92, 6, 66, 16, 34, 44, 16, 74, 8, 94, 30, 86, 58, 92, 78, 62, 88],
    { edge: "smooth", radius: 34 });
  S("Structures", "egg", "Egg", (function () {
    /* Width grows towards the bottom, which is the whole difference between
     * an egg and the circle this used to draw. */
    var out = [], i, steps = 20;
    for (i = 0; i < steps; i++) {
      var a = (i / steps) * Math.PI * 2 - Math.PI / 2;
      out.push(
        Math.round((50 + Math.cos(a) * 36 * (1 + 0.2 * Math.sin(a))) * 10) / 10,
        Math.round((52 + Math.sin(a) * 44) * 10) / 10
      );
    }
    return out;
  })(), { edge: "smooth", radius: 20 });
  S("Structures", "spiral", "Spiral",
    (function () {
      var out = [], i, turns = 42;
      for (i = 0; i <= turns; i++) {
        var t = i / turns;
        var a = t * Math.PI * 2 * 2.6 - Math.PI / 2;
        var r = 6 + t * 44;
        out.push(
          Math.round((50 + Math.cos(a) * r) * 10) / 10,
          Math.round((50 + Math.sin(a) * r) * 10) / 10
        );
      }
      return out;
    })(),
    { closed: false, edge: "smooth", radius: 30 });

  var CATS = [];
  LIST.forEach(function (sh) {
    if (CATS.indexOf(sh.cat) === -1) CATS.push(sh.cat);
  });

  /* An SVG path for the picker thumbnail, from the same points the board
   * will use. A drawn icon would go stale the first time a shape changed. */
  function pathOf(sh) {
    var d = "M" + sh.pts[0] + "," + sh.pts[1];
    for (var i = 2; i < sh.pts.length; i += 2) {
      d += " L" + sh.pts[i] + "," + sh.pts[i + 1];
    }
    return d + (sh.closed ? " Z" : "");
  }

  global.ChalkStickers = {
    emoji: EMOJI,
    shapes: LIST,
    shapeCats: CATS,
    pathOf: pathOf
  };
})(window);
