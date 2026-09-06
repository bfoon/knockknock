/* Publication editor. Blocks and authors are kept in memory and serialised into
   two hidden inputs on every save, so a normal form POST carries everything and
   the page still works if this script fails to load. */
(function () {
  "use strict";

  var root = document.querySelector("[data-editor]");
  if (!root) return;

  var form = document.getElementById("pub-form");
  var blocksHost = root.querySelector("[data-blocks]");
  var blocksField = root.querySelector("[data-blocks-json]");
  var authorsHost = root.querySelector("[data-authors]");
  var authorsField = root.querySelector("[data-authors-json]");
  var savedFlag = root.querySelector("[data-saved]");
  var figureUrl = root.getAttribute("data-figure-url");

  var blocks = readJson("[data-initial-blocks]", []);
  var authors = readJson("[data-initial-authors]", []);

  function readJson(selector, fallback) {
    var node = root.querySelector(selector);
    if (!node) return fallback;
    try { return JSON.parse(node.textContent) || fallback; } catch (e) { return fallback; }
  }

  function csrf() {
    var input = form && form.querySelector("[name=csrfmiddlewaretoken]");
    return input ? input.value : "";
  }

  var LABELS = {
    heading: "Heading", text: "Paragraph", figure: "Figure", quote: "Quote",
    list: "List, one item per line", code: "Code", table: "Table, one row per line, cells split by a tab or |",
    embed: "Embed", callout: "Callout", divider: "Divider",
  };

  /* ---- blocks ---- */

  function renderBlocks() {
    blocksHost.innerHTML = "";
    blocks.forEach(function (block, index) {
      blocksHost.appendChild(blockNode(block, index));
    });
    if (!blocks.length) {
      var hint = document.createElement("p");
      hint.className = "pub-note";
      hint.textContent = "Nothing written yet. Add a paragraph to start.";
      blocksHost.appendChild(hint);
    }
    sync();
  }

  function blockNode(block, index) {
    var wrap = document.createElement("div");
    wrap.className = "pub-block";
    wrap.setAttribute("data-type", block.type);

    var head = document.createElement("div");
    head.className = "pub-block-head";
    var label = document.createElement("span");
    label.textContent = LABELS[block.type] || block.type;
    head.appendChild(label);

    var tools = document.createElement("div");
    tools.appendChild(toolButton("↑", "Move up", function () { move(index, -1); }));
    tools.appendChild(toolButton("↓", "Move down", function () { move(index, 1); }));
    tools.appendChild(toolButton("✕", "Remove", function () {
      blocks.splice(index, 1); renderBlocks();
    }));
    head.appendChild(tools);
    wrap.appendChild(head);

    if (block.type === "divider") { return wrap; }

    if (block.type === "figure") {
      if (block.image) {
        var img = document.createElement("img");
        img.src = block.image;
        img.alt = "";
        wrap.appendChild(img);
      } else {
        var file = document.createElement("input");
        file.type = "file";
        file.accept = "image/*";
        file.addEventListener("change", function () {
          if (file.files && file.files[0]) uploadFigure(file.files[0], index);
        });
        wrap.appendChild(file);
      }
      wrap.appendChild(field("text", block.caption || "", "Caption", function (value) {
        blocks[index].caption = value; sync();
      }));
      return wrap;
    }

    if (block.type === "embed") {
      wrap.appendChild(field("url", block.url || "", "https://…", function (value) {
        blocks[index].url = value; sync();
      }));
      wrap.appendChild(field("text", block.caption || "", "Caption", function (value) {
        blocks[index].caption = value; sync();
      }));
      return wrap;
    }

    if (block.type === "heading") {
      wrap.appendChild(field("text", block.text || "", "Section heading", function (value) {
        blocks[index].text = value; sync();
      }));
      return wrap;
    }

    var area = document.createElement("textarea");
    area.rows = block.type === "text" ? 6 : 4;
    area.value = block.text || "";
    area.placeholder = LABELS[block.type] || "";
    area.addEventListener("input", function () { blocks[index].text = area.value; sync(); });
    wrap.appendChild(area);

    if (block.type === "quote" || block.type === "table") {
      wrap.appendChild(field("text", block.caption || "",
        block.type === "quote" ? "Who said it" : "Caption", function (value) {
          blocks[index].caption = value; sync();
        }));
    }
    return wrap;
  }

  function toolButton(glyph, title, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = glyph;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  function field(type, value, placeholder, onInput) {
    var input = document.createElement("input");
    input.type = type === "url" ? "url" : "text";
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", function () { onInput(input.value); });
    return input;
  }

  function move(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    var moved = blocks.splice(index, 1)[0];
    blocks.splice(target, 0, moved);
    renderBlocks();
  }

  function uploadFigure(file, index) {
    var data = new FormData();
    data.append("image", file);
    fetch(figureUrl, {
      method: "POST",
      headers: { "X-CSRFToken": csrf() },
      body: data,
    }).then(function (response) { return response.json(); })
      .then(function (result) {
        if (result.ok) {
          blocks[index].id = result.id;
          blocks[index].image = result.url;
          renderBlocks();
        } else {
          window.alert(result.error || "That image could not be uploaded.");
        }
      }).catch(function () { window.alert("That image could not be uploaded."); });
  }

  root.querySelectorAll("[data-add]").forEach(function (button) {
    button.addEventListener("click", function () {
      blocks.push({ type: button.getAttribute("data-add"), text: "", caption: "", url: "" });
      renderBlocks();
      var last = blocksHost.querySelector(".pub-block:last-of-type textarea, .pub-block:last-of-type input[type=text]");
      if (last) last.focus();
    });
  });

  /* ---- authors ---- */

  function renderAuthors() {
    authorsHost.innerHTML = "";
    authors.forEach(function (author, index) {
      var wrap = document.createElement("div");
      wrap.className = "pub-author-edit";
      wrap.appendChild(authorField(author, index, "name", "Full name"));
      wrap.appendChild(authorField(author, index, "affiliation", "Organisation"));
      wrap.appendChild(authorField(author, index, "role", "Role on this work"));
      wrap.appendChild(authorField(author, index, "email", "Email"));

      var tools = document.createElement("div");
      tools.className = "pub-author-tools";
      var corresponding = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!author.corresponding;
      box.addEventListener("change", function () {
        authors[index].corresponding = box.checked; sync();
      });
      corresponding.appendChild(box);
      corresponding.appendChild(document.createTextNode(" Point of contact"));
      tools.appendChild(corresponding);
      tools.appendChild(toolButton("Remove", "Remove this author", function () {
        authors.splice(index, 1); renderAuthors();
      }));
      wrap.appendChild(tools);
      authorsHost.appendChild(wrap);
    });
    sync();
  }

  function authorField(author, index, key, placeholder) {
    var input = document.createElement("input");
    input.type = key === "email" ? "email" : "text";
    input.value = author[key] || "";
    input.placeholder = placeholder;
    input.addEventListener("input", function () { authors[index][key] = input.value; sync(); });
    return input;
  }

  var addAuthor = root.querySelector("[data-add-author]");
  if (addAuthor) {
    addAuthor.addEventListener("click", function () {
      authors.push({ name: "", affiliation: "", role: "", email: "", corresponding: false });
      renderAuthors();
      var last = authorsHost.querySelector(".pub-author-edit:last-of-type input");
      if (last) last.focus();
    });
  }

  /* ---- serialise ---- */

  function sync() {
    blocksField.value = JSON.stringify(blocks);
    authorsField.value = JSON.stringify(authors.filter(function (a) { return (a.name || "").trim(); }));
    if (savedFlag) savedFlag.hidden = true;
  }

  form.addEventListener("submit", sync);

  /* ---- autosave the draft, never the publish action ---- */

  var timer = null;
  form.addEventListener("input", function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(autosave, 4000);
  });

  function autosave() {
    sync();
    var data = new FormData(form);
    fetch(form.getAttribute("data-save-url"), {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      body: data,
    }).then(function (response) {
      if (response.ok && savedFlag) {
        savedFlag.hidden = false;
        savedFlag.textContent = "Saved";
      }
    }).catch(function () { /* the manual Save button is still there */ });
  }

  window.addEventListener("beforeunload", function (event) {
    if (savedFlag && savedFlag.hidden && (blocks.length || authors.length)) {
      // Only warn if something was typed since the last save.
      if (timer) { event.preventDefault(); event.returnValue = ""; }
    }
  });

  renderBlocks();
  renderAuthors();
})();
