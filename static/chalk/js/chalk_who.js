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

  var people = Object.create(null);   // id -> card
  var me = null;
  var host = null;                    // .chalk-board
  var root = null;                    // our overlay
  var strip = null;                   // the row of who is here
  var linkBox = null, linkLine = null, linkFace = null;
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

  /* `hidden` is a property of HTMLElement. An <svg> is not one, so
   * `svg.hidden = true` quietly sets a meaningless property, no attribute
   * appears, the [hidden] rule never matches, and the dashed leader line
   * stayed on the board after the pointer had left — pointing at nothing. */
  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

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
    show(linkBox, false);
    root.appendChild(linkBox);

    linkLine = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    linkLine.setAttribute("class", "who-line");
    linkLine.setAttribute("viewBox", "0 0 100 100");
    linkLine.setAttribute("preserveAspectRatio", "none");
    show(linkLine, false);
    var path = document.createElementNS(linkLine.namespaceURI, "line");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    linkLine.appendChild(path);
    linkLine._line = path;
    root.appendChild(linkLine);

    linkFace = document.createElement("div");
    linkFace.className = "who-tag";
    show(linkFace, false);
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
      clearMarks();
      seedMarks(msg);
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
    /* Something arriving. The mark is pinned to it and stays. */
    if (t === "stroke_end" && msg.stroke) {
      noteMark("ink", msg.stroke.id, msg.stroke.by || msg.by);
      return;
    }
    if (t === "el_add" && msg.el) {
      noteMark("el", msg.el.id, msg.el.by || msg.by);
      return;
    }
    if (t === "ink" && msg.add) {
      msg.add.forEach(function (item) {
        if (item && item.s) noteMark("ink", item.s.id, item.s.by || msg.by);
      });
      /* A move by somebody else: whose hands are on it. */
      (msg.xform || []).forEach(function (op) {
        (op.ids || []).forEach(function (id) { noteMover("ink", id, msg.by); });
      });
      return;
    }
    if (t === "els" && msg.add) {
      msg.add.forEach(function (item) {
        if (item && item.s) noteMark("el", item.s.id, item.s.by || msg.by);
      });
      return;
    }

    /* Mid-gesture. Nothing is stored for these, and neither is anything
     * here beyond "this person has hold of this thing right now". */
    if (t === "ink_live") {
      (msg.ids || []).forEach(function (id) { noteMover("ink", id, msg.by); });
      return;
    }
    if (t === "el_live" && msg.id) {
      noteMover("el", msg.id, msg.by);
      return;
    }
    if (t === "el_live_many") {
      (msg.items || []).forEach(function (item) {
        if (item && item.id) noteMover("el", item.id, msg.by);
      });
      return;
    }
    if (t === "el_update" && msg.id) {
      noteMover("el", msg.id, msg.by);
      return;
    }
  }

  /* Everything already on the page when you arrive. Without this a board
   * only labelled what happened while you were watching. */
  function seedMarks(msg) {
    (msg.strokes || []).forEach(function (st) { noteMark("ink", st.id, st.by); });
    (msg.els || []).forEach(function (el) { noteMark("el", el.id, el.by); });
  }

  /* ---- marks ----------------------------------------------------------
   *
   * A mark is a face pinned to a thing on the board, and it stays there.
   * It used to be a face dropped at a coordinate that faded after twenty
   * seconds, which meant it drifted off whatever it was labelling the
   * moment that thing moved, and then vanished — so a board you came back
   * to could not tell you who had written any of it.
   *
   * Now each one holds the id of what it belongs to and is re-read from
   * that thing's own geometry a few times a second. It follows a move,
   * survives a page being scrolled or zoomed, and goes when the thing goes.
   * The name beside it is what fades: after a few seconds all that is left
   * is the small circle, which is enough once you know who is in the room.
   */

  var marks = Object.create(null);    // key -> { by, kind, id, node, at }
  var movers = Object.create(null);   // id  -> { by, kind, at }
  var NAME_MS = 6000;
  var MOVER_TAIL_MS = 2200;
  var MAX_MARKS = 40;

  function markKey(kind, id) { return kind + ":" + id; }

  function noteMark(kind, id, by) {
    if (!by || !id) return;
    if (me && String(by) === me.id) return;   // not your own
    var key = markKey(kind, id);
    if (marks[key]) { marks[key].by = by; return; }
    var p = card(by);
    var node = document.createElement("div");
    node.className = "who-mark";
    node.appendChild(faceNode(p, 22));
    var tag = document.createElement("span");
    tag.className = "who-name";
    tag.textContent = p ? p.name.split(" ")[0] : "Someone";
    node.appendChild(tag);
    root.appendChild(node);
    marks[key] = { by: by, kind: kind, id: id, node: node, at: Date.now() };
    trimMarks();
  }

  /* A board can hold a great many marks, and a face on every one of them is
   * a board you cannot read. Oldest go first. */
  function trimMarks() {
    var keys = Object.keys(marks);
    if (keys.length <= MAX_MARKS) return;
    keys.sort(function (a, b) { return marks[a].at - marks[b].at; });
    keys.slice(0, keys.length - MAX_MARKS).forEach(dropMark);
  }

  function dropMark(key) {
    if (!marks[key]) return;
    marks[key].node.remove();
    delete marks[key];
  }

  function clearMarks() {
    Object.keys(marks).forEach(dropMark);
    movers = Object.create(null);
  }

  /* Where is the thing now? Returns its top-right corner, or null if it has
   * been rubbed out — which is how a mark learns to remove itself. */
  function anchorOf(kind, id) {
    var els = global.ChalkEls, ink = global.ChalkInk;
    if (kind === "el") {
      var layers = (els && els.layers) || [];
      for (var i = 0; i < layers.length; i++) {
        var el = layers[i].get(id);
        if (el) return { x: el.x + el.w, y: el.y };
      }
      return null;
    }
    var surfaces = (ink && ink.surfaces) || [];
    for (var j = 0; j < surfaces.length; j++) {
      if (!surfaces[j].byId(id)) continue;
      var box = surfaces[j].bboxOf([id]);
      if (box) return { x: box.x + box.w, y: box.y };
    }
    return null;
  }

  function noteMover(kind, id, by) {
    if (!by || !id) return;
    if (me && String(by) === me.id) return;
    movers[markKey(kind, id)] = { by: by, kind: kind, id: id, at: Date.now() };
    /* Somebody moving a thing is worth a face even when the thing is yours
     * — that is the question being asked: who is doing that. */
    var key = markKey(kind, id);
    if (!marks[key]) {
      var p = card(by);
      var node = document.createElement("div");
      node.className = "who-mark is-moving";
      node.appendChild(faceNode(p, 22));
      var tag = document.createElement("span");
      tag.className = "who-name";
      tag.textContent = (p ? p.name.split(" ")[0] : "Someone") + " is moving this";
      node.appendChild(tag);
      root.appendChild(node);
      marks[key] = {
        by: by, kind: kind, id: id, node: node, at: Date.now(), borrowed: true
      };
      trimMarks();
    } else {
      marks[key].at = Date.now();
      marks[key].node.classList.add("is-moving");
    }
  }

  var lastPlace = 0;

  function tick(now) {
    /* Six times a second is plenty for a face following a finger, and it
     * keeps a page of forty marks off the compositor's back. */
    if (!lastPlace || now - lastPlace > 160) {
      lastPlace = now;
      var stamp = Date.now();
      Object.keys(marks).forEach(function (key) {
        var m = marks[key];
        var at = anchorOf(m.kind, m.id);
        if (!at) { dropMark(key); return; }
        m.node.style.left = (at.x * 100) + "%";
        m.node.style.top = (at.y * 100) + "%";
        var moving = movers[key] && stamp - movers[key].at < MOVER_TAIL_MS;
        if (!moving && m.node.classList.contains("is-moving")) {
          m.node.classList.remove("is-moving");
          if (m.borrowed) { dropMark(key); return; }
        }
        /* The name goes quiet; the circle stays. */
        m.node.classList.toggle("is-quiet", !moving && stamp - m.at > NAME_MS);
      });
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
      show(linkBox, false);
      show(linkLine, false);
      show(linkFace, false);
      return;
    }
    hovered = found;
    var p = card(found.by);
    var b = found.box;

    show(linkBox, true);
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

    show(linkFace, true);
    linkFace.textContent = "";
    linkFace.appendChild(faceNode(p, 34));
    var name = document.createElement("span");
    name.className = "who-name";
    name.textContent = p ? p.name : "Not signed";
    linkFace.appendChild(name);
    linkFace.style.left = (fx * 100) + "%";
    linkFace.style.top = (fy * 100) + "%";
    linkFace.style.borderColor = colourOf(p);

    show(linkLine, true);
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
      show(strip, false);
      return;
    }
    show(strip, true);
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
