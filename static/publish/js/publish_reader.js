/* Reading page behaviour. No dependencies. */
(function () {
  "use strict";

  function flash(button, text) {
    var original = button.textContent;
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1600);
  }

  function copy(text, button, label) {
    var done = function () { if (button) flash(button, label || "Copied"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* nothing to do */ }
    document.body.removeChild(box);
  }

  function csrf() {
    var match = document.cookie.match(/(^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[2]) : "";
  }

  function track(slug, channel) {
    fetch("/p/" + slug + "/share/" + channel + "/", {
      method: "POST",
      headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
    }).catch(function () { /* a lost count is not worth an error */ });
  }

  /* ---- citation tabs ---- */

  var tabs = document.querySelector("[data-cite-tabs]");
  if (tabs) {
    tabs.addEventListener("click", function (event) {
      var button = event.target.closest("[data-cite]");
      if (!button) return;
      var wanted = button.getAttribute("data-cite");
      tabs.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("is-on", b === button);
      });
      document.querySelectorAll("[data-cite-body]").forEach(function (pre) {
        pre.hidden = pre.getAttribute("data-cite-body") !== wanted;
      });
    });
  }

  var copyCite = document.querySelector("[data-copy-cite]");
  if (copyCite) {
    copyCite.addEventListener("click", function () {
      var visible = document.querySelector("[data-cite-body]:not([hidden])");
      if (visible) copy(visible.textContent.trim(), copyCite);
    });
  }

  /* ---- share ---- */

  var share = document.querySelector("[data-share-root]");
  if (share) {
    var slug = share.getAttribute("data-slug");
    var url = share.getAttribute("data-url");
    var title = share.getAttribute("data-title");

    var native = share.querySelector("[data-share-native]");
    if (native && navigator.share) {
      native.hidden = false;
      native.addEventListener("click", function () {
        navigator.share({ title: title, url: url }).then(function () {
          track(slug, "native");
        }, function () { /* the sheet was dismissed */ });
      });
    }

    var copyLink = share.querySelector("[data-copy-link]");
    if (copyLink) {
      copyLink.addEventListener("click", function () {
        copy(url, copyLink, "Link copied");
        track(slug, "link");
      });
    }

    var copyEmbed = share.querySelector("[data-copy-embed]");
    if (copyEmbed) {
      copyEmbed.addEventListener("click", function () {
        var box = share.querySelector(".pub-share-embed textarea");
        if (box) { copy(box.value, copyEmbed, "Embed copied"); track(slug, "embed"); }
      });
    }

    var qrButton = share.querySelector("[data-show-qr]");
    if (qrButton) {
      qrButton.addEventListener("click", function () {
        var panel = share.querySelector("[data-qr]");
        var img = share.querySelector("[data-qr-img]");
        if (!panel || !img) return;
        if (!img.getAttribute("src")) img.src = img.getAttribute("data-qr-src");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) track(slug, "qr");
      });
    }

    share.querySelector("#pub-share-url") &&
      share.querySelector("#pub-share-url").addEventListener("focus", function () { this.select(); });
  }

  /* ---- table of contents highlight ---- */

  var links = Array.prototype.slice.call(document.querySelectorAll(".pub-toc a"));
  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = byId[entry.target.id];
        if (link && entry.isIntersecting) {
          links.forEach(function (a) { a.style.color = ""; });
          link.style.color = "var(--pub-seal)";
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    Object.keys(byId).forEach(function (id) {
      var heading = document.getElementById(id);
      if (heading) observer.observe(heading);
    });
  }
})();
