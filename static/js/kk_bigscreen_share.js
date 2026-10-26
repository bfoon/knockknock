/* kk_bigscreen_share.js — "Big screen" on a Menti / game presenter screen.
 * Type the big screen's six-digit share code (shown in the screen's lobby);
 * the live session lands in that screen's lobby, and the big screen host puts
 * it on air and runs it (next / back / reveal / +30 s / end). */
(function () {
  "use strict";
  var btn = document.getElementById("kk-bigscreen-btn");
  var stage = document.getElementById("stage");
  if (!btn || !stage) return;
  var session = stage.dataset.code;
  var kind = stage.dataset.kind === "game" ? "game" : "poll";
  var KEY = "kk-bigscreen-last";

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    var i = document.querySelector("[name=csrfmiddlewaretoken]");
    return i ? i.value : "";
  }
  function post(url, body) {
    return fetch(url, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return [r.ok && d.ok, d]; }); });
  }

  var css = document.createElement("style");
  css.textContent =
    ".kkbs-back{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;background:rgba(5,6,14,.6);backdrop-filter:blur(4px)}" +
    ".kkbs{width:min(420px,calc(100vw - 24px));padding:1.2rem;border-radius:20px;color:#f4f1ff;font:14px/1.45 system-ui,sans-serif;" +
    "background:radial-gradient(120% 80% at 0% 0%,rgba(34,211,238,.18),transparent 55%),#12101f;border:1px solid rgba(255,255,255,.14);" +
    "box-shadow:0 30px 80px rgba(0,0,0,.6)}" +   /* no entrance animation: the presenter page can pause animations */
    ".kkbs h3{margin:0 0 .3rem;font-size:1.15rem}.kkbs p{margin:0 0 .9rem;color:#a9a6c2;font-size:.85rem}" +
    ".kkbs-code{display:block;width:100%;box-sizing:border-box;text-align:center;letter-spacing:.35em;font:800 2rem/1 ui-monospace,monospace;" +
    "padding:.7rem;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff}" +
    ".kkbs-code:focus{outline:2px solid #22d3ee}" +
    ".kkbs-row{display:flex;gap:.5rem;margin-top:.9rem}" +
    ".kkbs-row button{flex:1;border-radius:12px;padding:.65rem;cursor:pointer;font-weight:700;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#e2e8f0}" +
    ".kkbs-row .go{border:0;color:#04121a;background:linear-gradient(135deg,#22d3ee,#a78bfa)}" +
    ".kkbs-msg{margin-top:.7rem;font-size:.85rem}.kkbs-msg.bad{color:#fca5a5}.kkbs-msg.ok{color:#86efac}" +
    ".kkbs-off{all:unset;cursor:pointer;margin-top:.7rem;font-size:.78rem;color:#a9a6c2;text-decoration:underline}" +
    "#kk-bigscreen-btn.is-sent{border-color:#22d3ee;box-shadow:0 0 0 2px rgba(34,211,238,.25)}";
  document.head.appendChild(css);

  function open() {
    var back = document.createElement("div");
    back.className = "kkbs-back";
    var last = ""; try { last = localStorage.getItem(KEY) || ""; } catch (e) { /* ignore */ }
    back.innerHTML = '<div class="kkbs" role="dialog" aria-label="Show on a big screen">' +
      '<h3>📺 Show this ' + kind + ' on a big screen</h3>' +
      "<p>Type the <b>share code</b> shown on the big screen's lobby. Your " + kind + " will wait there until the screen's host puts it on air — they can then run it, question by question.</p>" +
      '<input class="kkbs-code" inputmode="numeric" maxlength="7" placeholder="000 000" value="' + last + '" aria-label="Big screen share code">' +
      '<div class="kkbs-row"><button type="button" class="no">Cancel</button><button type="button" class="go">Send to big screen</button></div>' +
      '<div class="kkbs-msg" hidden></div>' +
      '<button type="button" class="kkbs-off">Take it off all big screens</button></div>';
    document.body.appendChild(back);
    var input = back.querySelector(".kkbs-code"), msg = back.querySelector(".kkbs-msg");
    function say(t, ok) { msg.hidden = false; msg.textContent = t; msg.className = "kkbs-msg " + (ok ? "ok" : "bad"); }
    function close() { back.remove(); }
    function send() {
      var code = input.value.replace(/\D/g, "");
      if (code.length !== 6) { say("The share code has six digits."); input.focus(); return; }
      say("Sending…", true);
      post(btn.dataset.shareUrl, { session: session, screen_code: code }).then(function (res) {
        if (!res[0]) { say(res[1].error || "Couldn't send it."); return; }
        try { localStorage.setItem(KEY, code); } catch (e) { /* ignore */ }
        btn.classList.add("is-sent");
        say("✓ Sent to “" + res[1].screen + "”. It's waiting in the lobby — the host puts it on air.", true);
        setTimeout(close, 2600);
      });
    }
    back.querySelector(".go").addEventListener("click", send);
    back.querySelector(".no").addEventListener("click", close);
    back.querySelector(".kkbs-off").addEventListener("click", function () {
      post(btn.dataset.unshareUrl, { session: session }).then(function () { btn.classList.remove("is-sent"); say("Taken off the big screens.", true); setTimeout(close, 1400); });
    });
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); if (e.key === "Escape") close(); });
    setTimeout(function () { input.focus(); input.select(); }, 20);
  }
  btn.addEventListener("click", open);
})();
