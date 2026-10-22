/* KnockKnock Arena — SVG character engine.
 *
 * Original, parametric cartoon characters drawn entirely in SVG (no image
 * assets, no third-party art). A character is fully described by its
 * avatar_id string, so it rides the existing wire/DB field unchanged:
 *
 *     kk-<species>-<colour>-<accessory>-<face>     e.g.  kk-cat-8-crown-wink
 *
 * Longest possible id is 23 chars — inside Participant.avatar_id (30).
 * Legacy emoji ids ("dragon", "anime_neko", …) still work everywhere and
 * render as a glossy emoji orb with the same moods.
 *
 * Public API (window.KKAvatar):
 *   html(id, {mood, size, cls})   → markup string for an animated avatar
 *   mount(el, id, {mood, size})   → render into an element
 *   setMood(el, mood)             → re-render a mounted avatar in a new mood
 *   parse(id) / encode(parts) / random() / isBuilt(id) / emojiFor(id) / labelFor(id)
 *   SPECIES, COLORS, ACCESSORIES, FACES, MOODS
 *
 * Moods: idle · cheer · dance · sad · think · win · sleep · wave
 *
 * Also wraps window.kkAvatarsById in a Proxy so every legacy lookup
 * (present.js, play.js, the rooms shim) resolves a built character to a
 * sensible {emoji, label, color, anim} instead of "undefined". Load this
 * file right AFTER games/partials/avatar_data.html and BEFORE play.js /
 * present.js — present.js captures kkAvatarsById at load time.
 */
(function () {
  "use strict";

  // ───────────────────────── catalogue ─────────────────────────
  var SPECIES = [
    { key: "blob", label: "Bloop",   emoji: "🫧" },
    { key: "cat",  label: "Whisk",   emoji: "🐱" },
    { key: "bear", label: "Bruno",   emoji: "🐻" },
    { key: "bun",  label: "Hopper",  emoji: "🐰" },
    { key: "bird", label: "Pip",     emoji: "🐤" },
    { key: "bot",  label: "Bolt",    emoji: "🤖" },
    { key: "boo",  label: "Boo",     emoji: "👻" },
    { key: "dino", label: "Rexy",    emoji: "🦖" },
    { key: "octo", label: "Inky",    emoji: "🐙" },
    { key: "zeep", label: "Zeep",    emoji: "👽" },
    { key: "peng", label: "Waddles", emoji: "🐧" },
    { key: "drak", label: "Ember",   emoji: "🐉" },
  ];

  var COLORS = [
    "#ff6b6b", "#ff9f43", "#feca57", "#1dd1a1", "#10ac84", "#48dbfb",
    "#2e86de", "#5f27cd", "#f368e0", "#a29bfe", "#576574", "#dfe6ee",
  ];

  var ACCESSORIES = [
    { key: "none",  label: "None",      emoji: "∅" },
    { key: "crown", label: "Crown",     emoji: "👑" },
    { key: "cap",   label: "Cap",       emoji: "🧢" },
    { key: "party", label: "Party hat", emoji: "🥳" },
    { key: "top",   label: "Top hat",   emoji: "🎩" },
    { key: "wiz",   label: "Wizard",    emoji: "🪄" },
    { key: "halo",  label: "Halo",      emoji: "😇" },
    { key: "flwr",  label: "Flower",    emoji: "🌼" },
    { key: "bow",   label: "Bow",       emoji: "🎀" },
    { key: "head",  label: "Headset",   emoji: "🎧" },
    { key: "glas",  label: "Glasses",   emoji: "👓" },
    { key: "band",  label: "Headband",  emoji: "🥷" },
  ];

  var FACES = [
    { key: "happy",  label: "Happy",  emoji: "🙂" },
    { key: "cute",   label: "Cute",   emoji: "🥹" },
    { key: "wink",   label: "Wink",   emoji: "😉" },
    { key: "cool",   label: "Cool",   emoji: "😎" },
    { key: "star",   label: "Starry", emoji: "🤩" },
    { key: "tongue", label: "Cheeky", emoji: "😛" },
  ];

  var MOODS = ["idle", "cheer", "dance", "sad", "think", "win", "sleep", "wave"];

  var SPECIES_BY = {}, ACC_BY = {}, FACE_BY = {};
  SPECIES.forEach(function (s) { SPECIES_BY[s.key] = s; });
  ACCESSORIES.forEach(function (a) { ACC_BY[a.key] = a; });
  FACES.forEach(function (f) { FACE_BY[f.key] = f; });

  var ID_RE = /^kk-([a-z]{2,6})-(\d{1,2})-([a-z]{2,6})-([a-z]{2,8})$/;

  function parse(id) {
    var m = ID_RE.exec(String(id || ""));
    if (m && SPECIES_BY[m[1]]) {
      var c = Math.max(0, Math.min(COLORS.length - 1, parseInt(m[2], 10) || 0));
      return {
        kind: "kk",
        species: m[1],
        color: c,
        acc: ACC_BY[m[3]] ? m[3] : "none",
        face: FACE_BY[m[4]] ? m[4] : "happy",
      };
    }
    return { kind: "legacy", id: String(id || "dragon") };
  }

  function encode(p) {
    return ["kk", p.species || "blob", String(p.color || 0), p.acc || "none", p.face || "happy"].join("-");
  }

  function isBuilt(id) { return parse(id).kind === "kk"; }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function random() {
    return {
      species: pick(SPECIES).key,
      color: Math.floor(Math.random() * COLORS.length),
      // Bias towards having *something* on — bare heads are less fun.
      acc: Math.random() < 0.15 ? "none" : pick(ACCESSORIES.slice(1)).key,
      face: pick(FACES).key,
    };
  }

  // ───────────────────────── colour helpers ─────────────────────────
  function hexToRgb(h) {
    h = String(h || "#888").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r) {
    return "#" + r.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function mix(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function shade(c, t) { return t < 0 ? mix(c, "#1b1530", -t) : mix(c, "#ffffff", t); }

  var uidSeq = 0;
  function uid() { uidSeq += 1; return "kka" + uidSeq.toString(36) + Math.random().toString(36).slice(2, 6); }

  // ───────────────────────── species geometry ─────────────────────────
  // Shared frame: viewBox 0 0 120 130, body centred on x=60, feet at y≈114.
  // Each species returns layers; `top` is the y of the crown of the head so
  // hats sit correctly, `fy` nudges the face vertically.
  var BEAN = "M60 40 C85 40 97 58 97 80 C97 103 82 115 60 115 C38 115 23 103 23 80 C23 58 35 40 60 40Z";

  function species(key, C) {
    var body = C.body, dark = C.dark, light = C.light, deep = C.deep;
    var st = ' stroke="' + deep + '" stroke-width="2.4" stroke-linejoin="round"';
    var out = { back: "", body: "", front: "", feet: "nub", arms: "nub", belly: null, top: 40, fy: 0, ink: "#1e1b2e", cheeks: true };

    switch (key) {
      case "blob":
        out.body = '<path d="M60 30 C70 46 97 56 97 84 C97 105 81 115 60 115 C39 115 23 105 23 84 C23 56 50 46 60 30Z" fill="' + body + '"' + st + '/>' +
          '<ellipse cx="44" cy="62" rx="7" ry="11" fill="#fff" opacity=".35" transform="rotate(25 44 62)"/>';
        out.top = 34; out.fy = 4;
        break;

      case "cat":
        out.back =
          '<path class="kka-tail" style="transform-origin:90px 104px" d="M90 104 C112 104 116 84 106 72 C104 70 100 72 102 75 C108 86 104 98 88 98Z" fill="' + body + '"' + st + '/>' +
          '<path d="M33 60 L37 28 L58 45Z" fill="' + body + '"' + st + '/><path d="M38 52 L40 36 L51 46Z" fill="#ffb3c7"/>' +
          '<path d="M87 60 L83 28 L62 45Z" fill="' + body + '"' + st + '/><path d="M82 52 L80 36 L69 46Z" fill="#ffb3c7"/>';
        out.body = '<path d="' + BEAN + '" fill="' + body + '"' + st + '/>';
        out.front =
          '<g stroke="' + deep + '" stroke-width="1.6" stroke-linecap="round" opacity=".55">' +
          '<path d="M30 84 L41 85"/><path d="M31 90 L41 88"/><path d="M90 84 L79 85"/><path d="M89 90 L79 88"/></g>';
        out.belly = { cy: 98, rx: 19, ry: 13 };
        break;

      case "bear":
        out.back =
          '<circle cx="37" cy="47" r="12" fill="' + body + '"' + st + '/><circle cx="37" cy="47" r="6" fill="' + light + '"/>' +
          '<circle cx="83" cy="47" r="12" fill="' + body + '"' + st + '/><circle cx="83" cy="47" r="6" fill="' + light + '"/>';
        out.body = '<path d="' + BEAN + '" fill="' + body + '"' + st + '/>';
        out.front = '<ellipse cx="60" cy="88" rx="14" ry="10.5" fill="' + light + '"/><ellipse cx="60" cy="83.5" rx="4.6" ry="3.4" fill="#2b2140"/>';
        out.belly = { cy: 102, rx: 18, ry: 10 };
        break;

      case "bun":
        out.back =
          '<g class="kka-ear-l" style="transform-origin:48px 46px"><ellipse cx="46" cy="24" rx="9" ry="23" fill="' + body + '"' + st + ' transform="rotate(-12 46 24)"/>' +
          '<ellipse cx="46" cy="25" rx="4.5" ry="16" fill="#ffb3c7" transform="rotate(-12 46 25)"/></g>' +
          '<g class="kka-ear-r" style="transform-origin:72px 46px"><ellipse cx="74" cy="24" rx="9" ry="23" fill="' + body + '"' + st + ' transform="rotate(12 74 24)"/>' +
          '<ellipse cx="74" cy="25" rx="4.5" ry="16" fill="#ffb3c7" transform="rotate(12 74 25)"/></g>';
        out.body = '<path d="' + BEAN + '" fill="' + body + '"' + st + '/>';
        out.front = '<path d="M57 83 Q60 86 63 83" fill="none" stroke="#ff7fa5" stroke-width="2.6" stroke-linecap="round"/>';
        out.belly = { cy: 99, rx: 18, ry: 12 };
        break;

      case "bird":
        out.back = '<path d="M56 42 C52 28 58 22 62 30 C64 22 72 24 66 40Z" fill="' + dark + '"' + st + '/>';
        out.body = '<path d="' + BEAN + '" fill="' + body + '"' + st + '/>';
        out.front = '<path d="M53 83 L67 83 L60 93Z" fill="#ffa62b" stroke="#d9771b" stroke-width="1.8" stroke-linejoin="round"/>';
        out.arms = "wing"; out.belly = { cy: 100, rx: 20, ry: 13 }; out.fy = -2; out.beak = true;
        break;

      case "bot":
        out.back =
          '<line x1="60" y1="42" x2="60" y2="26" stroke="' + deep + '" stroke-width="3"/>' +
          '<circle class="kka-glow" cx="60" cy="23" r="5.5" fill="#ff5e7e" stroke="' + deep + '" stroke-width="2"/>';
        out.body = '<rect x="25" y="42" width="70" height="72" rx="20" fill="' + body + '"' + st + '/>' +
          '<rect x="33" y="57" width="54" height="36" rx="12" fill="#1c1838" stroke="' + deep + '" stroke-width="2"/>' +
          '<circle cx="31" cy="104" r="2.6" fill="' + light + '"/><circle cx="89" cy="104" r="2.6" fill="' + light + '"/>';
        out.ink = "#7efff5"; out.cheeks = false; out.top = 26; out.fy = 1;
        break;

      case "boo":
        out.body = '<path d="M60 38 C86 38 97 58 97 82 L97 112 Q91 104 85 112 Q79 120 73 112 Q66 104 60 112 Q54 120 47 112 Q41 104 35 112 Q29 120 23 112 L23 82 C23 58 34 38 60 38Z" fill="' + body + '"' + st + '/>' +
          '<ellipse cx="42" cy="58" rx="6" ry="9" fill="#fff" opacity=".35" transform="rotate(25 42 58)"/>';
        out.feet = "none"; out.top = 38;
        break;

      case "dino":
        out.back =
          '<path class="kka-tail" style="transform-origin:90px 100px" d="M90 104 Q114 106 116 86 Q106 100 90 92Z" fill="' + body + '"' + st + '/>' +
          '<path d="M40 50 L44 36 L51 45 L57 31 L63 44 L70 32 L75 46 L82 39 L83 54Z" fill="' + dark + '"' + st + '/>';
        out.body = '<path d="' + BEAN + '" fill="' + body + '"' + st + '/>';
        out.front = '<circle cx="53" cy="62" r="2" fill="' + dark + '"/><circle cx="66" cy="58" r="2.4" fill="' + dark + '"/><circle cx="74" cy="64" r="1.8" fill="' + dark + '"/>';
        out.belly = { cy: 99, rx: 20, ry: 14, stripes: true };
        break;

      case "octo":
        out.body = '<path d="M60 34 C86 34 96 52 96 74 C96 92 84 100 60 100 C36 100 24 92 24 74 C24 52 34 34 60 34Z" fill="' + body + '"' + st + '/>' +
          '<ellipse cx="44" cy="52" rx="6" ry="9" fill="#fff" opacity=".3" transform="rotate(25 44 52)"/>' +
          '<circle cx="78" cy="50" r="3" fill="' + light + '"/><circle cx="85" cy="60" r="2" fill="' + light + '"/>';
        out.back = [30, 44, 60, 76, 90].map(function (x, i) {
          var d = i % 2 ? 1 : -1;
          return '<path class="kka-tent kka-tent' + i + '" style="transform-origin:' + x + 'px 94px" d="M' + (x - 7) + ' 92 Q' + (x - 9) + ' 108 ' + (x + 4 * d) + ' 116 Q' + (x + 9 * d) + ' 118 ' + (x + 6) + ' 110 Q' + (x + 3) + ' 102 ' + (x + 7) + ' 92Z" fill="' + dark + '"' + st + '/>';
        }).join("");
        out.feet = "none"; out.top = 34; out.fy = -8; out.arms = "none";
        break;

      case "zeep":
        out.back =
          '<path d="M46 44 Q38 28 34 20" fill="none" stroke="' + deep + '" stroke-width="2.6" stroke-linecap="round"/>' +
          '<path d="M74 44 Q82 28 86 20" fill="none" stroke="' + deep + '" stroke-width="2.6" stroke-linecap="round"/>' +
          '<circle class="kka-glow" cx="34" cy="19" r="4.8" fill="#ffe66d" stroke="' + deep + '" stroke-width="2"/>' +
          '<circle class="kka-glow" cx="86" cy="19" r="4.8" fill="#ffe66d" stroke="' + deep + '" stroke-width="2"/>';
        out.body = '<path d="M60 38 C90 38 98 60 94 80 C90 102 78 115 60 115 C42 115 30 102 26 80 C22 60 30 38 60 38Z" fill="' + body + '"' + st + '/>';
        out.front = '<ellipse cx="60" cy="54" rx="8" ry="3" fill="' + light + '" opacity=".7"/>';
        out.belly = { cy: 101, rx: 15, ry: 9 }; out.top = 22;
        break;

      case "peng":
        out.body = '<path d="M60 36 C84 36 96 56 96 82 C96 104 82 116 60 116 C38 116 24 104 24 82 C24 56 36 36 60 36Z" fill="' + body + '"' + st + '/>' +
          '<path d="M60 56 C78 56 86 70 86 88 C86 104 76 112 60 112 C44 112 34 104 34 88 C34 70 42 56 60 56Z" fill="#fbfcff"/>';
        out.front = '<path d="M54 82 L66 82 L60 90Z" fill="#ffa62b" stroke="#d9771b" stroke-width="1.6" stroke-linejoin="round"/>';
        out.feet = "orange"; out.arms = "flipper"; out.top = 36; out.beak = true;
        break;

      case "drak":
        out.back =
          '<g class="kka-wing-l" style="transform-origin:34px 72px"><path d="M34 74 C18 60 8 62 4 54 C10 66 6 76 12 84 C16 78 22 82 26 86Z" fill="' + dark + '"' + st + '/></g>' +
          '<g class="kka-wing-r" style="transform-origin:86px 72px"><path d="M86 74 C102 60 112 62 116 54 C110 66 114 76 108 84 C104 78 98 82 94 86Z" fill="' + dark + '"' + st + '/></g>' +
          '<path d="M42 50 C36 40 36 30 40 24 C42 34 48 40 52 44Z" fill="#fff4d6" stroke="' + deep + '" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M78 50 C84 40 84 30 80 24 C78 34 72 40 68 44Z" fill="#fff4d6" stroke="' + deep + '" stroke-width="2" stroke-linejoin="round"/>';
        out.body = '<path d="' + BEAN + '" fill="' + body + '"' + st + '/>';
        out.front = '<circle cx="55" cy="84" r="1.3" fill="' + deep + '"/><circle cx="65" cy="84" r="1.3" fill="' + deep + '"/>';
        out.belly = { cy: 100, rx: 19, ry: 13, stripes: true }; out.top = 26;
        break;
    }
    return out;
  }

  // ───────────────────────── faces ─────────────────────────
  function eyeDot(x, y, ink, big) {
    var rx = big ? 6 : 4.9, ry = big ? 7 : 6;
    var hl = ink === "#7efff5" ? "" :
      '<circle cx="' + (x + 1.5) + '" cy="' + (y - 2) + '" r="' + (big ? 2.1 : 1.6) + '" fill="#fff"/>' +
      (big ? '<circle cx="' + (x - 1.8) + '" cy="' + (y + 2.2) + '" r="1" fill="#fff"/>' : "");
    return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + ink + '"/>' + hl;
  }
  function arcEye(x, y, ink, up) {
    return '<path d="M' + (x - 5) + ' ' + (y + (up ? 2 : -1)) + ' Q' + x + ' ' + (y + (up ? -5 : 4)) + ' ' + (x + 5) + ' ' + (y + (up ? 2 : -1)) + '" fill="none" stroke="' + ink + '" stroke-width="2.8" stroke-linecap="round"/>';
  }
  function starEye(x, y) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? 2.8 : 6.6, a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push((x + r * Math.cos(a)).toFixed(1) + "," + (y + r * Math.sin(a)).toFixed(1));
    }
    return '<polygon points="' + pts.join(" ") + '" fill="#ffd32a" stroke="#e1a500" stroke-width="1.2" stroke-linejoin="round"/>';
  }

  function face(f, mood, S, C) {
    var ink = S.ink, y = 74 + S.fy, my = 87 + S.fy, L = 48, R = 72;
    var eyes = "", mouth = "", extra = "";
    var mouthStroke = ' fill="none" stroke="' + ink + '" stroke-width="2.6" stroke-linecap="round"';
    var openMouth = '<path d="M52 ' + (my - 1) + ' Q60 ' + (my + 11) + ' 68 ' + (my - 1) + 'Z" fill="' + (ink === "#7efff5" ? ink : "#3b1530") + '"/>' +
      (ink === "#7efff5" ? "" : '<path d="M55.5 ' + (my + 4) + ' Q60 ' + (my + 1) + ' 64.5 ' + (my + 4) + ' Q60 ' + (my + 9) + ' 55.5 ' + (my + 4) + 'Z" fill="#ff7fa5"/>');

    if (mood === "cheer" || mood === "win") {
      eyes = f === "cool" ? shades(L, R, y) : arcEye(L, y, ink, true) + arcEye(R, y, ink, true);
      mouth = openMouth;
    } else if (mood === "sad") {
      eyes = eyeDot(L, y + 1, ink) + eyeDot(R, y + 1, ink) +
        '<path d="M' + (L - 6) + ' ' + (y - 9) + ' L' + (L + 4) + ' ' + (y - 6) + '"' + mouthStroke + '/>' +
        '<path d="M' + (R + 6) + ' ' + (y - 9) + ' L' + (R - 4) + ' ' + (y - 6) + '"' + mouthStroke + '/>';
      mouth = '<path d="M53 ' + (my + 4) + ' Q60 ' + (my - 3) + ' 67 ' + (my + 4) + '"' + mouthStroke + '/>';
      extra = '<path class="kka-tear" d="M' + (R + 3) + ' ' + (y + 6) + ' q-3 5 0 7 q3 -2 0 -7Z" fill="#7fd3ff"/>';
    } else if (mood === "sleep") {
      eyes = arcEye(L, y, ink, false) + arcEye(R, y, ink, false);
      mouth = '<ellipse cx="60" cy="' + (my + 2) + '" rx="3" ry="2.4" fill="' + ink + '"/>';
      extra = '<g class="kka-zzz" fill="#fff" font-family="Arial Black,Arial,sans-serif" font-weight="900">' +
        '<text x="88" y="46" font-size="10">z</text><text x="96" y="34" font-size="13">z</text><text x="104" y="20" font-size="16">Z</text></g>';
    } else if (mood === "think") {
      eyes = eyeDot(L + 2, y - 2, ink) + eyeDot(R + 2, y - 2, ink);
      mouth = '<path d="M55 ' + (my + 1) + ' L65 ' + (my - 1) + '"' + mouthStroke + '/>';
      extra = '<g class="kka-dots" fill="#fff"><circle cx="92" cy="44" r="2.6"/><circle cx="100" cy="36" r="3.4"/><circle cx="110" cy="26" r="4.4"/></g>';
    } else {
      switch (f) {
        case "cute":
          eyes = eyeDot(L, y, ink, true) + eyeDot(R, y, ink, true);
          mouth = '<path d="M54 ' + my + ' Q57 ' + (my + 4) + ' 60 ' + my + ' Q63 ' + (my + 4) + ' 66 ' + my + '"' + mouthStroke + '/>';
          break;
        case "wink":
          eyes = eyeDot(L, y, ink) + arcEye(R, y, ink, true);
          mouth = '<path d="M52 ' + my + ' Q61 ' + (my + 8) + ' 68 ' + (my - 2) + '"' + mouthStroke + '/>';
          break;
        case "cool":
          eyes = shades(L, R, y);
          mouth = '<path d="M54 ' + (my + 1) + ' Q62 ' + (my + 5) + ' 68 ' + (my - 1) + '"' + mouthStroke + '/>';
          break;
        case "star":
          eyes = starEye(L, y) + starEye(R, y);
          mouth = openMouth;
          break;
        case "tongue":
          eyes = eyeDot(L, y, ink) + eyeDot(R, y, ink);
          mouth = '<path d="M52 ' + my + ' Q60 ' + (my + 7) + ' 68 ' + my + '"' + mouthStroke + '/>' +
            (ink === "#7efff5" ? "" : '<path d="M58 ' + (my + 3) + ' Q58 ' + (my + 11) + ' 62.5 ' + (my + 10) + ' Q65 ' + (my + 9) + ' 64 ' + (my + 2.5) + 'Z" fill="#ff7fa5" stroke="#d94f7c" stroke-width="1.2"/>');
          break;
        default:
          eyes = eyeDot(L, y, ink) + eyeDot(R, y, ink);
          mouth = '<path d="M52 ' + my + ' Q60 ' + (my + 8) + ' 68 ' + my + '"' + mouthStroke + '/>';
      }
    }

    var cheeks = S.cheeks
      ? '<ellipse cx="38" cy="' + (my - 2) + '" rx="5.5" ry="3.4" fill="#ff7fa5" opacity=".45"/><ellipse cx="82" cy="' + (my - 2) + '" rx="5.5" ry="3.4" fill="#ff7fa5" opacity=".45"/>'
      : "";
    // Beaked species: the beak IS the mouth.
    if (S.beak) mouth = "";
    return cheeks + '<g class="kka-eyes" style="transform-origin:60px ' + y + 'px">' + eyes + "</g>" + mouth + extra;
  }

  function shades(L, R, y) {
    return '<g><rect x="' + (L - 9) + '" y="' + (y - 6) + '" width="18" height="12" rx="5" fill="#141225"/>' +
      '<rect x="' + (R - 9) + '" y="' + (y - 6) + '" width="18" height="12" rx="5" fill="#141225"/>' +
      '<path d="M' + (L + 9) + ' ' + (y - 2) + ' Q60 ' + (y - 5) + ' ' + (R - 9) + ' ' + (y - 2) + '" stroke="#141225" stroke-width="2.4" fill="none"/>' +
      '<path d="M' + (L - 5) + ' ' + (y - 2) + ' L' + (L - 1) + ' ' + (y - 4) + '" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>' +
      '<path d="M' + (R - 5) + ' ' + (y - 2) + ' L' + (R - 1) + ' ' + (y - 4) + '" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/></g>';
  }

  // ───────────────────────── accessories ─────────────────────────
  // Drawn around x=60 with the head crown at y=40, then shifted by (top-40).
  function accessory(a, S, G) {
    var dy = S.top - 40, fy = S.fy;
    var g = function (s) { return '<g class="kka-acc" transform="translate(0 ' + dy + ')">' + s + "</g>"; };
    switch (a) {
      case "crown":
        return g('<path d="M41 43 L43 21 L52 32 L60 16 L68 32 L77 21 L79 43Z" fill="#ffd32a" stroke="#d99a00" stroke-width="2" stroke-linejoin="round"/>' +
          '<rect x="41" y="38" width="38" height="6" rx="2" fill="#ffbf00" stroke="#d99a00" stroke-width="1.6"/>' +
          '<circle cx="60" cy="31" r="3" fill="#ff4d6d"/><circle cx="48" cy="35" r="2.2" fill="#4dd0ff"/><circle cx="72" cy="35" r="2.2" fill="#4dd0ff"/>');
      case "cap":
        return g('<path d="M34 49 C34 25 86 25 86 49Z" fill="#ee5253" stroke="#a83236" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M60 49 L101 47 Q104 53 96 55 L60 55Z" fill="#c63b3f" stroke="#a83236" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M60 28 L60 49" stroke="#a83236" stroke-width="1.6"/><circle cx="60" cy="27" r="3" fill="#ff8b8e"/>');
      case "party":
        return g('<path d="M46 45 L60 5 L74 45Z" fill="#48dbfb" stroke="#1f8fb3" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M52 28 L68 28 M49 37 L71 37 M55 18 L65 18" stroke="#ff9ff3" stroke-width="3.2" stroke-linecap="round"/>' +
          '<circle cx="60" cy="5" r="5" fill="#feca57" stroke="#d99a00" stroke-width="1.6"/>');
      case "top":
        return g('<ellipse cx="60" cy="43" rx="27" ry="6" fill="#232036" stroke="#0d0b18" stroke-width="2"/>' +
          '<rect x="44" y="12" width="32" height="31" rx="4" fill="#2d2944" stroke="#0d0b18" stroke-width="2"/>' +
          '<rect x="44" y="32" width="32" height="6" fill="#ff6b6b"/>');
      case "wiz":
        return g('<path d="M37 45 Q60 52 83 45 L68 30 Q64 10 78 0 Q54 4 52 28Z" fill="#5f27cd" stroke="#341473" stroke-width="2" stroke-linejoin="round"/>' +
          '<ellipse cx="60" cy="45" rx="25" ry="5.5" fill="#4a1fa3" stroke="#341473" stroke-width="2"/>' +
          '<path d="M58 26 l1.6 3.4 3.6 .4 -2.7 2.4 .8 3.6 -3.3 -1.9 -3.3 1.9 .8 -3.6 -2.7 -2.4 3.6 -.4Z" fill="#feca57"/>' +
          '<circle cx="70" cy="18" r="1.8" fill="#feca57"/><circle cx="50" cy="38" r="1.4" fill="#fff"/>');
      case "halo":
        return g('<g class="kka-halo"><ellipse cx="60" cy="22" rx="19" ry="5.5" fill="none" stroke="#ffe066" stroke-width="5" opacity=".35"/>' +
          '<ellipse cx="60" cy="22" rx="19" ry="5.5" fill="none" stroke="#ffd32a" stroke-width="3"/></g>');
      case "flwr":
        var petals = "";
        for (var i = 0; i < 5; i++) {
          var an = i * 72 * Math.PI / 180;
          petals += '<circle cx="' + (84 + 7 * Math.cos(an)).toFixed(1) + '" cy="' + (46 + 7 * Math.sin(an)).toFixed(1) + '" r="5.5" fill="#fff" stroke="#f0c" stroke-opacity=".25"/>';
        }
        return g('<g class="kka-flower" style="transform-origin:84px 46px">' + petals + '<circle cx="84" cy="46" r="4.5" fill="#feca57"/></g>');
      case "bow":
        return g('<path d="M80 45 L68 36 L68 54Z" fill="#ff6fae" stroke="#c23a7a" stroke-width="1.8" stroke-linejoin="round"/>' +
          '<path d="M80 45 L92 36 L92 54Z" fill="#ff6fae" stroke="#c23a7a" stroke-width="1.8" stroke-linejoin="round"/>' +
          '<circle cx="80" cy="45" r="4" fill="#ff8fc2" stroke="#c23a7a" stroke-width="1.6"/>');
      case "head":
        return '<g class="kka-acc"><path d="M27 76 C25 30 95 30 93 76" fill="none" stroke="#2b2747" stroke-width="6" stroke-linecap="round" transform="translate(0 ' + Math.min(0, dy / 2) + ')"/>' +
          '<rect x="19" y="' + (66 + fy) + '" width="13" height="22" rx="6" fill="#ff6b6b" stroke="#2b2747" stroke-width="2"/>' +
          '<rect x="88" y="' + (66 + fy) + '" width="13" height="22" rx="6" fill="#ff6b6b" stroke="#2b2747" stroke-width="2"/>' +
          '<path d="M26 ' + (86 + fy) + ' Q30 ' + (98 + fy) + ' 46 ' + (96 + fy) + '" fill="none" stroke="#2b2747" stroke-width="2.6" stroke-linecap="round"/>' +
          '<circle cx="47" cy="' + (96 + fy) + '" r="3" fill="#2b2747"/></g>';
      case "glas":
        var y = 74 + fy;
        return '<g class="kka-acc"><circle cx="48" cy="' + y + '" r="9" fill="#fff" fill-opacity=".22" stroke="#2b2747" stroke-width="2.6"/>' +
          '<circle cx="72" cy="' + y + '" r="9" fill="#fff" fill-opacity=".22" stroke="#2b2747" stroke-width="2.6"/>' +
          '<path d="M57 ' + y + ' Q60 ' + (y - 3) + ' 63 ' + y + '" stroke="#2b2747" stroke-width="2.4" fill="none"/></g>';
      case "band":
        var by = 58 + fy;
        return '<g class="kka-acc"><path d="M25 ' + (by + 2) + ' Q60 ' + (by - 8) + ' 95 ' + (by + 2) + ' L95 ' + (by + 9) + ' Q60 ' + (by - 1) + ' 25 ' + (by + 9) + 'Z" fill="#ee5253" stroke="#a83236" stroke-width="1.8" stroke-linejoin="round"/>' +
          '<g class="kka-band-tail" style="transform-origin:95px ' + (by + 5) + 'px"><path d="M94 ' + (by + 4) + ' Q106 ' + (by + 2) + ' 114 ' + (by + 10) + ' Q104 ' + (by + 8) + ' 96 ' + (by + 10) + 'Z" fill="#ee5253" stroke="#a83236" stroke-width="1.6"/>' +
          '<path d="M94 ' + (by + 6) + ' Q104 ' + (by + 10) + ' 108 ' + (by + 20) + ' Q100 ' + (by + 14) + ' 94 ' + (by + 11) + 'Z" fill="#d84346" stroke="#a83236" stroke-width="1.6"/></g></g>';
    }
    return "";
  }

  // ───────────────────────── arms / feet / belly ─────────────────────────
  function arms(kind, C) {
    if (kind === "none") return "";
    var st = ' stroke="' + C.deep + '" stroke-width="2.2"';
    var L, R;
    if (kind === "wing") {
      L = '<path d="M30 78 C14 82 12 98 22 104 C26 96 30 92 34 90Z" fill="' + C.dark + '"' + st + ' stroke-linejoin="round"/>';
      R = '<path d="M90 78 C106 82 108 98 98 104 C94 96 90 92 86 90Z" fill="' + C.dark + '"' + st + ' stroke-linejoin="round"/>';
    } else if (kind === "flipper") {
      L = '<path d="M30 76 C18 86 16 100 22 106 C28 100 32 92 34 86Z" fill="' + C.body + '"' + st + ' stroke-linejoin="round"/>';
      R = '<path d="M90 76 C102 86 104 100 98 106 C92 100 88 92 86 86Z" fill="' + C.body + '"' + st + ' stroke-linejoin="round"/>';
    } else {
      L = '<ellipse cx="22" cy="92" rx="7.5" ry="11" fill="' + C.body + '"' + st + ' transform="rotate(28 22 92)"/>';
      R = '<ellipse cx="98" cy="92" rx="7.5" ry="11" fill="' + C.body + '"' + st + ' transform="rotate(-28 98 92)"/>';
    }
    return '<g class="kka-arm-l" style="transform-origin:31px 82px">' + L + "</g>" +
      '<g class="kka-arm-r" style="transform-origin:89px 82px">' + R + "</g>";
  }

  function feet(kind, C) {
    if (kind === "none") return "";
    var col = kind === "orange" ? "#ffa62b" : C.dark;
    var stc = kind === "orange" ? "#d9771b" : C.deep;
    return '<ellipse class="kka-foot-l" cx="45" cy="115" rx="11" ry="6.5" fill="' + col + '" stroke="' + stc + '" stroke-width="2.2"/>' +
      '<ellipse class="kka-foot-r" cx="75" cy="115" rx="11" ry="6.5" fill="' + col + '" stroke="' + stc + '" stroke-width="2.2"/>';
  }

  function belly(b, C) {
    if (!b) return "";
    var s = '<ellipse cx="60" cy="' + b.cy + '" rx="' + b.rx + '" ry="' + b.ry + '" fill="' + C.light + '"/>';
    if (b.stripes) {
      for (var i = -1; i <= 1; i++) {
        var yy = b.cy + i * (b.ry * 0.55);
        var w = b.rx * (i === 0 ? 0.8 : 0.62);
        s += '<path d="M' + (60 - w) + " " + yy + " Q60 " + (yy + 3) + " " + (60 + w) + " " + yy + '" stroke="' + C.dark + '" stroke-opacity=".35" stroke-width="1.6" fill="none"/>';
      }
    }
    return s;
  }

  // ───────────────────────── full character ─────────────────────────
  function builtSvg(p, mood) {
    var base = COLORS[p.color] || COLORS[0];
    var C = {
      body: base,
      dark: shade(base, -0.22),
      deep: shade(base, -0.55),
      light: shade(base, 0.55),
    };
    // Very light bodies need a visible outline and a tinted belly.
    if (p.color === COLORS.length - 1) { C.light = "#ffffff"; C.dark = "#b7c3d2"; C.deep = "#5d6b80"; }

    var S = species(p.species, C);
    var gid = uid();
    var shine = '<radialGradient id="' + gid + '" cx="35%" cy="25%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>';

    var bodyClip = S.body.replace(/ fill="[^"]*"/, ' fill="url(#' + gid + ')"').replace(/ stroke="[^"]*" stroke-width="[^"]*"( stroke-linejoin="round")?/, "");
    // Only the first shape of the body gets the gloss overlay.
    var glossShape = bodyClip.match(/^<(path|rect)[^>]*\/>/);

    return '<svg viewBox="0 -4 120 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
      "<defs>" + shine + "</defs>" +
      '<ellipse class="kka-shadow" cx="60" cy="121" rx="30" ry="5" fill="#000" opacity=".22"/>' +
      '<g class="kka-root">' +
        '<g class="kka-bod" style="transform-origin:60px 118px">' +
          S.back + feet(S.feet, C) + S.body + (glossShape ? glossShape[0] : "") + belly(S.belly, C) + S.front +
          arms(S.arms, C) +
          '<g class="kka-face">' + face(p.face, mood, S, C) + "</g>" +
          accessory(p.acc, S, C) +
        "</g>" +
      "</g>" +
      sparkles(mood) +
    "</svg>";
  }

  function sparkles(mood) {
    if (mood !== "win" && mood !== "cheer") return "";
    var s = "";
    var spots = [[14, 30, "#ffd32a"], [106, 26, "#48dbfb"], [10, 82, "#ff6fae"], [110, 76, "#1dd1a1"]];
    spots.forEach(function (p, i) {
      s += '<path class="kka-spark kka-spark' + i + '" style="transform-origin:' + p[0] + "px " + p[1] + 'px" d="M' + p[0] + " " + (p[1] - 6) + " L" + (p[0] + 1.6) + " " + (p[1] - 1.6) + " L" + (p[0] + 6) + " " + p[1] + " L" + (p[0] + 1.6) + " " + (p[1] + 1.6) + " L" + p[0] + " " + (p[1] + 6) + " L" + (p[0] - 1.6) + " " + (p[1] + 1.6) + " L" + (p[0] - 6) + " " + p[1] + " L" + (p[0] - 1.6) + " " + (p[1] - 1.6) + 'Z" fill="' + p[2] + '"/>';
    });
    return s;
  }

  function legacyMeta(id) {
    var cat = window.__kkAvatarBase || {};
    return cat[id] || { id: id, emoji: "👤", color: "#7c3aed", label: id };
  }

  function legacySvg(id, mood) {
    var m = legacyMeta(id);
    var gid = uid();
    var col = m.color || "#7c3aed";
    var sad = mood === "sad" ? '<path class="kka-tear" d="M84 70 q-3 5 0 7 q3 -2 0 -7Z" fill="#7fd3ff"/>' : "";
    return '<svg viewBox="0 -4 120 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="' + gid + '" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="' + shade(col, 0.55) + '"/><stop offset=".7" stop-color="' + col + '"/><stop offset="1" stop-color="' + shade(col, -0.35) + '"/></radialGradient></defs>' +
      '<ellipse class="kka-shadow" cx="60" cy="121" rx="30" ry="5" fill="#000" opacity=".22"/>' +
      '<g class="kka-root"><g class="kka-bod" style="transform-origin:60px 118px">' +
        '<circle cx="60" cy="74" r="44" fill="url(#' + gid + ')" stroke="' + shade(col, -0.5) + '" stroke-width="2.4"/>' +
        '<ellipse cx="44" cy="52" rx="12" ry="7" fill="#fff" opacity=".35" transform="rotate(-25 44 52)"/>' +
        '<text x="60" y="76" text-anchor="middle" dominant-baseline="central" font-size="50" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">' + escapeXml(m.emoji || "👤") + "</text>" +
        sad +
      "</g></g>" + sparkles(mood) + "</svg>";
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function svgFor(id, mood) {
    var p = parse(id);
    mood = MOODS.indexOf(mood) >= 0 ? mood : "idle";
    return p.kind === "kk" ? builtSvg(p, mood) : legacySvg(p.id, mood);
  }

  function html(id, opts) {
    opts = opts || {};
    var mood = MOODS.indexOf(opts.mood) >= 0 ? opts.mood : "idle";
    var size = opts.size || 96;
    var delay = (-Math.random() * 3).toFixed(2) + "s";
    return '<span class="kka-av kka-m-' + mood + (opts.cls ? " " + opts.cls : "") + '" data-av="' + escapeXml(id) +
      '" data-mood="' + mood + '" style="--kka-s:' + (typeof size === "number" ? size + "px" : size) + ";--kka-d:" + delay + '">' +
      svgFor(id, mood) + "</span>";
  }

  function mount(el, id, opts) {
    if (!el) return null;
    el.innerHTML = html(id, opts);
    return el.firstChild;
  }

  function setMood(avEl, mood) {
    if (!avEl) return;
    if (!avEl.classList.contains("kka-av")) avEl = avEl.querySelector(".kka-av");
    if (!avEl || avEl.dataset.mood === mood) return;
    MOODS.forEach(function (m) { avEl.classList.remove("kka-m-" + m); });
    avEl.classList.add("kka-m-" + mood);
    avEl.dataset.mood = mood;
    avEl.innerHTML = svgFor(avEl.dataset.av, mood);
  }

  // Play a one-shot mood then fall back.
  function flash(avEl, mood, ms, back) {
    setMood(avEl, mood);
    clearTimeout(avEl && avEl._kkaT);
    if (avEl) avEl._kkaT = setTimeout(function () { setMood(avEl, back || "idle"); }, ms || 1600);
  }

  function emojiFor(id) {
    var p = parse(id);
    if (p.kind === "kk") return SPECIES_BY[p.species].emoji;
    return legacyMeta(p.id).emoji || "👤";
  }

  function labelFor(id) {
    var p = parse(id);
    if (p.kind !== "kk") return legacyMeta(p.id).label || "Player";
    var a = ACC_BY[p.acc];
    return SPECIES_BY[p.species].label + (p.acc !== "none" ? " with " + a.label.toLowerCase() : "");
  }

  function metaFor(id) {
    var p = parse(id);
    if (p.kind !== "kk") return null;
    return {
      id: String(id),
      label: labelFor(id),
      emoji: SPECIES_BY[p.species].emoji,
      color: COLORS[p.color],
      category: "arena",
      anim: "kk-bounce",
    };
  }

  // ───────────────────────── catalogue proxy ─────────────────────────
  // Keep the original object reachable for legacy lookups, and make
  // built ids resolvable through the same window.kkAvatarsById[...] reads
  // the older scripts already do.
  (function installProxy() {
    var base = window.kkAvatarsById || {};
    window.__kkAvatarBase = base;
    if (typeof Proxy !== "function") return;
    try {
      window.kkAvatarsById = new Proxy(base, {
        get: function (t, k) {
          if (k in t) return t[k];
          if (typeof k === "string" && k.indexOf("kk-") === 0) return metaFor(k) || undefined;
          return undefined;
        },
        has: function (t, k) {
          return (k in t) || (typeof k === "string" && isBuilt(k));
        },
      });
    } catch (e) { /* very old browser: built ids fall back to emoji only */ }
  })();

  window.KKAvatar = {
    SPECIES: SPECIES, COLORS: COLORS, ACCESSORIES: ACCESSORIES, FACES: FACES, MOODS: MOODS,
    parse: parse, encode: encode, random: random, isBuilt: isBuilt,
    html: html, mount: mount, setMood: setMood, flash: flash, svg: svgFor,
    emojiFor: emojiFor, labelFor: labelFor,
  };
})();
