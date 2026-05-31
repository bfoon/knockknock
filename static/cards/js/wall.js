(function () {
  var wall = document.getElementById("wall");
  var grid = document.getElementById("wallGrid");
  var empty = document.getElementById("wallEmpty");
  if (!wall) return;

  var feedUrl = wall.dataset.feed;
  var reactUrl = wall.dataset.react;
  var seen = {};              // message ids already on the wall
  var seenRx = {};            // reaction ids already in the pile
  var lastTs = null;
  var pile = document.getElementById("emojiPile");
  var bar = document.getElementById("emojiBar");
  var isOwner = wall.dataset.owner === "1";
  var closed = wall.dataset.closed === "1";

  // Owner-only running totals shown beside each emoji on the bar. The counts
  // are recomputed from the deduped reaction stream (the feed returns the full
  // list every poll), so the badges stay exact without double-counting; the
  // server-rendered numbers are just the initial values, reconciled on poll 1.
  var counts = {};
  var countEls = {};
  if (bar) {
    var badges = bar.querySelectorAll("[data-count-for]");
    for (var bi = 0; bi < badges.length; bi++) {
      countEls[badges[bi].getAttribute("data-count-for")] = badges[bi];
    }
  }
  function bumpCount(emoji) {
    counts[emoji] = (counts[emoji] || 0) + 1;
    var el = countEls[emoji];
    if (el) el.textContent = counts[emoji];
  }

  // --- CSRF (no form on this page, so read the cookie) ------------------- #
  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  // --- Messages ---------------------------------------------------------- #
  function noteEl(m) {
    var d = document.createElement("div");
    d.className = "eo-msg eo-note--" + m.color;
    d.style.transform = "rotate(" + (m.tilt || 0) + "deg)";
    var body = document.createElement("div");
    body.className = "eo-msg-body";
    body.textContent = m.body;
    var author = document.createElement("div");
    author.className = "eo-msg-author";
    author.textContent = "— " + m.author;
    d.appendChild(body);
    d.appendChild(author);
    return d;
  }

  // --- Emoji pile -------------------------------------------------------- #
  // Each reaction is a small absolutely-positioned emoji clustered in a band
  // under the photo. Deterministic placement by index so it looks like a heap
  // that grows, not a random reshuffle on every poll.
  function placeEmoji(emoji, idx, animate) {
    if (!pile) return;
    var el = document.createElement("span");
    el.className = "eo-emoji-bit" + (animate ? " is-new" : "");
    el.textContent = emoji;
    // Pseudo-random but stable spread from the index.
    var seed = (idx * 2654435761) % 1000 / 1000;
    var seed2 = (idx * 40503) % 1000 / 1000;
    var spread = 150;                      // horizontal spread in px
    var x = (seed - 0.5) * spread;
    var y = seed2 * 22;                    // shallow vertical jitter, stays a base
    var rot = (seed - 0.5) * 36;
    var scale = 0.8 + seed2 * 0.4;
    el.style.setProperty("--x", x.toFixed(1) + "px");
    el.style.setProperty("--y", y.toFixed(1) + "px");
    el.style.setProperty("--r", rot.toFixed(1) + "deg");
    el.style.setProperty("--s", scale.toFixed(2));
    el.style.zIndex = String(100 + idx);
    pile.appendChild(el);
  }

  var rxCount = 0;
  function applyReactions(list) {
    for (var i = 0; i < list.length; i++) {
      var rx = list[i];
      if (seenRx[rx.id]) continue;
      seenRx[rx.id] = true;
      placeEmoji(rx.emoji, rxCount, true);
      bumpCount(rx.emoji);
      rxCount++;
    }
  }

  // Send a reaction; optimistic — the next poll will reconcile via id.
  function sendReaction(emoji) {
    if (!reactUrl) return;
    var fd = new FormData();
    fd.append("emoji", emoji);
    fetch(reactUrl, {
      method: "POST",
      headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
      body: fd
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && data.ok && !seenRx[data.id]) {
        seenRx[data.id] = true;
        placeEmoji(data.emoji, rxCount, true);
        bumpCount(data.emoji);
        rxCount++;
      }
    }).catch(function () { /* ignore; poll will catch up */ });
  }

  if (bar) {
    bar.addEventListener("click", function (e) {
      var btn = e.target.closest(".eo-emoji-btn");
      if (!btn) return;
      if (closed) return;                       // read-only bar for the owner
      var emoji = btn.getAttribute("data-emoji");
      // Little press feedback.
      btn.classList.remove("pop");
      void btn.offsetWidth;
      btn.classList.add("pop");
      sendReaction(emoji);
    });
  }

  // --- Polling ----------------------------------------------------------- #
  function poll() {
    var url = lastTs ? feedUrl + "?since=" + encodeURIComponent(lastTs) : feedUrl;
    fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        (data.messages || []).forEach(function (m) {
          if (seen[m.id]) return;
          seen[m.id] = true;
          grid.prepend(noteEl(m));
          lastTs = m.created_at;
        });
        if (data.count > 0 && empty) empty.style.display = "none";
        if (data.reactions) applyReactions(data.reactions);
        if (data.is_closed) {
          closed = true;
          if (timer) clearInterval(timer);
          if (bar) {
            if (isOwner) {
              // Keep the tally visible to the organiser, but make it read-only.
              bar.classList.add("eo-emoji-bar--readonly");
              var btns = bar.querySelectorAll(".eo-emoji-btn");
              for (var k = 0; k < btns.length; k++) btns[k].disabled = true;
            } else {
              bar.style.display = "none";
            }
          }
        }
      })
      .catch(function () { /* keep polling */ });
  }

  poll();
  var timer = setInterval(poll, 3000);
})();