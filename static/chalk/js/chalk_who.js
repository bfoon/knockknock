/* Chalk — who wrote what.
 *
 * A board with a class on it needs to answer one question at a glance: who
 * put that there. This draws the answer over the top of everything else —
 * a small round face beside each fresh mark, and, when you point at
 * something, a box round it with a line running to the face of whoever made
 * it.
 *
 * It mounts itself. There is no call to make from the page: the layer finds
 * .chalk-board, reads the same config block the page reads, takes its frames
 * from chalk_net.js, and hit-tests against the surfaces and layers that
 * chalk_ink.js and chalk_els.js already register. So the projector shows all
 * of this without a line of chalk_stage.js.
 *
 * window.ChalkWho = { frame, mount }
 */
(function (global) {
  "use strict";

  /* A new mark is worth pointing out for a while and then not: a board that
   * keeps every bubble is a board covered in faces. */
  var FRESH_MS = 22000;
  var LIVE_TAIL_MS = 2600;
  var MAX_BUBBLES = 14;

  var people = Object.create(null);   // id -> card
  var me = null;
  var host = null;                    // .chalk-board
  var root = null;                    // our overlay
  var strip = null;                   // the row of who is here
  var linkBox = null, linkLine = null, linkFace = null;
  var bubbles = [];                   // { id, by, x, y, at, node }
  var hovered = null;
  var mounted = false;

  /* ---- people -------------------------------------------------------- */

  function card(by) {
    return people[String(by)] || null;
  }

  function colourOf(p) {
    return p ? "hsl(" + p.hue + " 70% 62%)" : "rgba(232,238,244,.5)";
  }

  function faceNode(p, size) {
    var el = document.createElement("span");
    el.className = "who-face";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.borderColor = colourOf(p);
    if (p && p.avatar) {
      var img = document.createElement("img");
      img.src = p.avatar;
      img.alt = "";
      /* A picture that will not load falls back to the initials rather than
       * to a broken-image icon with somebody's name under it. */
      img.addEventListener("error", function () {
        img.remove();
        el.textContent = p.initials;
      });
      el.appendChild(img);
    } else {
      el.textContent = p ? p.initials : "?";
      el.style.background = p
        ? "hsl(" + p.hue + " 45% 26%)"
        : "rgba(22,32,42,.9)";
      el.style.color = colourOf(p);
    }
    el.style.fontSize = Math.max(9, Math.round(size * 0.42)) + "px";
    return el;
  }

  /* ---- mounting ------------------------------------------------------ */

  function mount() {
    if (mounted) return true;
    host = document.querySelector(".chalk-board");
    if (!host) return false;
    mounted = true;

    root = document.createElement("div");
    root.className = "who-layer";
    root.setAttribute("aria-hidden", "true");
    host.appendChild(root);

    linkBox = document.createElement("div");
    linkBox.className = "who-ring";
    linkBox.hidden = true;
    root.appendChild(linkBox);

    linkLine = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    linkLine.setAttribute("class", "who-line");
    linkLine.setAttribute("viewBox", "0 0 100 100");
    linkLine.setAttribute("preserveAspectRatio", "none");
    linkLine.hidden = true;
    var path = document.createElementNS(linkLine.namespaceURI, "line");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    linkLine.appendChild(path);
    linkLine._line = path;
    root.appendChild(linkLine);

    linkFace = document.createElement("div");
    linkFace.className = "who-tag";
    linkFace.hidden = true;
    root.appendChild(linkFace);

    strip = document.createElement("div");
    strip.className = "who-strip";
    host.appendChild(strip);

    var cfg = document.getElementById("chalk-config");
    if (cfg) {
      try {
        var conf = JSON.parse(cfg.textContent);
        me = conf.me || null;
        /* Marked present from the start: the strip counts who is here, and
         * you are always one of them. */
        if (me) { me.on = true; people[me.id] = me; }
        (conf.people || []).forEach(function (p) { people[p.id] = p; });
      } catch (err) { /* the page will have complained already */ }
    }

    host.addEventListener("pointermove", onPoint);
    host.addEventListener("pointerleave", function () { setHover(null); });
    /* Touch has no hover, so a press does the same job and then lets go. */
    host.addEventListener("pointerdown", onPoint);
    host.addEventListener("pointerup", function () {
      setTimeout(function () { setHover(null); }, 1800);
    });
    requestAnimationFrame(tick);
    drawStrip();
    return true;
  }

  /* ---- frames -------------------------------------------------------- */

  function frame(msg) {
    if (!msg || !mount()) return;
    var t = msg.t;

    if (t === "ready" || t === "snapshot") {
      if (msg.me) { me = msg.me; me.on = true; people[me.id] = me; }
      (msg.people || []).forEach(function (p) { people[p.id] = p; });
      clearBubbles();
      drawStrip();
      return;
    }
    if (t === "person") {
      if (!msg.person) return;
      people[msg.person.id] = msg.person;
      msg.person.on = msg.on !== false;
      drawStrip();
      return;
    }
    /* Somebody else's stroke, live. The bubble rides the leading point, so
     * the room can see who is writing while they write. */
    if (t === "stroke_start" || t === "stroke_pts") {
      var pt = lastPoint(msg);
      if (pt) live(msg.id || msg.stroke && msg.stroke.id, pt, msg.by);
      return;
    }
    if (t === "stroke_end" && msg.stroke) {
      var s = msg.stroke;
      var end = tailOf(s.pts);
      if (end) bubble("s:" + s.id, s.by, end[0], end[1]);
      return;
    }
    if (t === "el_add" && msg.el) {
      bubble("e:" + msg.el.id, msg.el.by,
        msg.el.x + msg.el.w, msg.el.y);
      return;
    }
    if (t === "ink" && msg.add) {
      msg.add.forEach(function (item) {
        var end = item && item.s && tailOf(item.s.pts);
        if (end) bubble("s:" + item.s.id, item.s.by, end[0], end[1]);
      });
    }
  }

  function tailOf(pts) {
    if (!pts || pts.length < 2) return null;
    return [pts[pts.length - 2], pts[pts.length - 1]];
  }

  function lastPoint(msg) {
    if (msg.pts && msg.pts.length >= 2) return tailOf(msg.pts);
    if (msg.stroke && msg.stroke.pts) return tailOf(msg.stroke.pts);
    return null;
  }

  /* ---- bubbles ------------------------------------------------------- */

  function bubble(key, by, x, y) {
    if (!by || (me && String(by) === me.id)) return;   // not your own
    var p = card(by);
    var found = bubbles.filter(function (b) { return b.key === key; })[0];
    if (found) {
      found.x = x;
      found.y = y;
      found.at = Date.now();
      place(found);
      return;
    }
    var node = document.createElement("div");
    node.className = "who-bubble";
    node.appendChild(faceNode(p, 26));
    var tag = document.createElement("span");
    tag.className = "who-name";
    tag.textContent = p ? p.name.split(" ")[0] : "Someone";
    node.appendChild(tag);
    root.appendChild(node);
    var b = { key: key, by: by, x: x, y: y, at: Date.now(), node: node };
    bubbles.push(b);
    place(b);
    /* Oldest goes first when the board gets busy. */
    while (bubbles.length > MAX_BUBBLES) {
      var old = bubbles.shift();
      old.node.remove();
    }
  }

  function live(key, pt, by) {
    if (!key) return;
    bubble("live:" + key, by, pt[0], pt[1]);
  }

  function place(b) {
    b.node.style.left = (b.x * 100) + "%";
    b.node.style.top = (b.y * 100) + "%";
  }

  function clearBubbles() {
    bubbles.forEach(function (b) { b.node.remove(); });
    bubbles = [];
  }

  function tick() {
    var now = Date.now();
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      var age = now - b.at;
      var life = b.key.indexOf("live:") === 0 ? LIVE_TAIL_MS : FRESH_MS;
      if (age > life) {
        b.node.remove();
        bubbles.splice(i, 1);
      } else if (age > life - 900) {
        b.node.style.opacity = String((life - age) / 900);
      }
    }
    requestAnimationFrame(tick);
  }

  /* ---- pointing at something ----------------------------------------- */

  function boardPoint(e) {
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height
    };
  }

  /* Objects first, then handwriting — the same order the Pick tool uses, so
   * pointing at a thing and picking it up find the same thing. */
  function whatIsAt(p) {
    /* Read through `global`, never as a bare name. These are optional
     * neighbours: if one of them has not loaded, a bare reference is a
     * ReferenceError inside a pointermove handler, which fires constantly. */
    var els = global.ChalkEls;
    var ink = global.ChalkInk;
    var layers = (els && els.layers) || [];
    for (var i = 0; i < layers.length; i++) {
      var id = layers[i].hit(p.x, p.y);
      if (id) {
        var el = layers[i].get(id);
        if (el) {
          return {
            by: el.by, kind: "object",
            box: { x: el.x, y: el.y, w: el.w, h: el.h }
          };
        }
      }
    }
    var surfaces = (ink && ink.surfaces) || [];
    for (var j = 0; j < surfaces.length; j++) {
      var sid = surfaces[j].hit(p.x, p.y, 0.012);
      if (sid) {
        var st = surfaces[j].byId(sid);
        var box = surfaces[j].bboxOf([sid]);
        if (st && box) return { by: st.by, kind: "writing", box: box };
      }
    }
    return null;
  }

  function onPoint(e) {
    if (!mounted) return;
    var p = boardPoint(e);
    if (!p) return;
    setHover(whatIsAt(p));
  }

  function setHover(found) {
    if (!found || !found.by) {
      hovered = null;
      linkBox.hidden = true;
      linkLine.hidden = true;
      linkFace.hidden = true;
      return;
    }
    hovered = found;
    var p = card(found.by);
    var b = found.box;

    linkBox.hidden = false;
    linkBox.dataset.kind = found.kind;
    linkBox.style.left = (b.x * 100) + "%";
    linkBox.style.top = (b.y * 100) + "%";
    linkBox.style.width = (b.w * 100) + "%";
    linkBox.style.height = (b.h * 100) + "%";
    linkBox.style.borderColor = colourOf(p);

    /* The face goes above the box, or below it when the box is already at
     * the top of the board and there is nowhere above to put it. */
    var above = b.y > 0.16;
    var fx = Math.min(0.94, Math.max(0.06, b.x + b.w / 2));
    var fy = above ? b.y - 0.1 : b.y + b.h + 0.1;

    linkFace.hidden = false;
    linkFace.textContent = "";
    linkFace.appendChild(faceNode(p, 34));
    var name = document.createElement("span");
    name.className = "who-name";
    name.textContent = p ? p.name : "Not signed";
    linkFace.appendChild(name);
    linkFace.style.left = (fx * 100) + "%";
    linkFace.style.top = (fy * 100) + "%";
    linkFace.style.borderColor = colourOf(p);

    linkLine.hidden = false;
    linkLine._line.setAttribute("x1", fx * 100);
    linkLine._line.setAttribute("y1", fy * 100);
    linkLine._line.setAttribute("x2", (b.x + b.w / 2) * 100);
    linkLine._line.setAttribute("y2", (above ? b.y : b.y + b.h) * 100);
    linkLine._line.setAttribute("stroke", colourOf(p));
  }

  /* ---- who is here --------------------------------------------------- */

  function drawStrip() {
    if (!strip) return;
    strip.textContent = "";
    var here = Object.keys(people)
      .map(function (k) { return people[k]; })
      .filter(function (p) { return p.on; });
    if (here.length < 2) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    here.slice(0, 12).forEach(function (p) {
      var face = faceNode(p, 26);
      face.title = p.name;
      strip.appendChild(face);
    });
    if (here.length > 12) {
      var more = document.createElement("span");
      more.className = "who-more";
      more.textContent = "+" + (here.length - 12);
      strip.appendChild(more);
    }
  }

  global.ChalkWho = { frame: frame, mount: mount, people: people };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window);
