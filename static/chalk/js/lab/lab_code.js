/* Chalk Circuit Lab — the code editor.
 *
 * A textarea laid exactly over a highlighted copy of its own text. No
 * editor library: what a sketch needs is colour, line numbers, a marker on
 * the running line and a gutter to click for breakpoints, and all four fit
 * here. The textarea stays a textarea, so typing, undo, IME and screen
 * readers behave the way the browser already knows how to make them behave.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;

  var KW = /^(if|else|for|while|do|switch|case|default|break|continue|return|const|static|volatile|unsigned|signed|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN)$/;
  var TY = /^(void|int|long|short|float|double|bool|boolean|char|byte|word|String|size_t|u?int(8|16|32|64)_t|Servo|LiquidCrystal_I2C|LiquidCrystal|SoftwareSerial|SmartCamera|Speaker)$/;
  var FN = /^(setup|loop|pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|delayMicroseconds|millis|micros|tone|noTone|pulseIn|map|constrain|min|max|abs|sqrt|pow|random|randomSeed|Serial|sin|cos|round|floor|ceil)$/;

  function highlight(src) {
    var out = "", re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(#\w+[^\n]*)|(\b0[xXbB][0-9a-fA-F]+\b|\b\d+\.?\d*(?:[eE][-+]?\d+)?[uUlLfF]*\b)|([A-Za-z_]\w*)|([\s\S])/g, m;
    while ((m = re.exec(src))) {
      if (m[1]) out += '<i class="c-com">' + L.esc(m[1]) + '</i>';
      else if (m[2]) out += '<i class="c-str">' + L.esc(m[2]) + '</i>';
      else if (m[3]) out += '<i class="c-pre">' + L.esc(m[3]) + '</i>';
      else if (m[4]) out += '<i class="c-num">' + L.esc(m[4]) + '</i>';
      else if (m[5]) {
        var w = m[5];
        out += KW.test(w) ? '<i class="c-kw">' + w + '</i>' : TY.test(w) ? '<i class="c-ty">' + w + '</i>' : FN.test(w) ? '<i class="c-fn">' + w + '</i>' : w;
      } else out += L.esc(m[6]);
    }
    return out + "\n";
  }
  L.highlightC = highlight;

  function CodeEditor(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.breaks = {};
    host.classList.add("code-ed");
    host.innerHTML =
      '<div class="code-gutter" aria-hidden="true"></div>' +
      '<div class="code-scroll">' +
        '<div class="code-mark" hidden></div>' +
        '<pre class="code-hl" aria-hidden="true"></pre>' +
        '<textarea class="code-ta" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Arduino program"></textarea>' +
      '</div>';
    this.gut = host.querySelector(".code-gutter");
    this.scroll = host.querySelector(".code-scroll");
    this.pre = host.querySelector(".code-hl");
    this.ta = host.querySelector(".code-ta");
    this.mark = host.querySelector(".code-mark");
    var self = this;
    this.ta.addEventListener("input", function () { self.paint(); if (self.opts.onChange) self.opts.onChange(self.ta.value); });
    this.ta.addEventListener("scroll", function () { self.sync(); });
    this.ta.addEventListener("keydown", function (e) { self.keys(e); });
    this.gut.addEventListener("click", function (e) {
      var n = e.target.closest("[data-ln]");
      if (!n) return;
      var ln = +n.getAttribute("data-ln");
      if (self.breaks[ln]) delete self.breaks[ln]; else self.breaks[ln] = true;
      self.gutter();
      if (self.opts.onBreaks) self.opts.onBreaks(self.breaks);
    });
  }
  L.CodeEditor = CodeEditor;

  CodeEditor.prototype.set = function (code) { if (this.ta.value !== code) { this.ta.value = code; this.paint(); } };
  CodeEditor.prototype.get = function () { return this.ta.value; };
  CodeEditor.prototype.readOnly = function (on) { this.ta.readOnly = !!on; this.host.classList.toggle("ro", !!on); };

  CodeEditor.prototype.paint = function () {
    this.pre.innerHTML = highlight(this.ta.value);
    this.gutter();
    this.sync();
  };
  CodeEditor.prototype.gutter = function () {
    var n = this.ta.value.split("\n").length, s = "", errs = this.errors || {};
    for (var i = 1; i <= n; i++) {
      s += '<span data-ln="' + i + '" class="' + (this.breaks[i] ? "bp " : "") + (errs[i] ? "err " : "") + (i === this.cur ? "cur" : "") + '"' +
           (errs[i] ? ' title="' + L.esc(errs[i]) + '"' : "") + '>' + i + '</span>';
    }
    this.gut.innerHTML = s;
    this.gut.scrollTop = this.ta.scrollTop;
  };
  CodeEditor.prototype.sync = function () {
    this.pre.style.transform = "translate(" + (-this.ta.scrollLeft) + "px," + (-this.ta.scrollTop) + "px)";
    this.gut.scrollTop = this.ta.scrollTop;
    this.placeMark();
  };
  CodeEditor.prototype.lineHeight = function () {
    if (!this._lh) this._lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    return this._lh;
  };
  CodeEditor.prototype.placeMark = function () {
    if (!this.cur) { this.mark.hidden = true; return; }
    var lh = this.lineHeight(), pad = parseFloat(getComputedStyle(this.ta).paddingTop) || 0;
    this.mark.style.transform = "translateY(" + ((this.cur - 1) * lh + pad - this.ta.scrollTop) + "px)";
    this.mark.style.height = lh + "px";
    this.mark.hidden = false;
  };
  /* The line about to run. Scrolls it into view only if it has left it. */
  CodeEditor.prototype.running = function (line, kind) {
    if (this.cur === line && this.curKind === kind) return;
    this.cur = line; this.curKind = kind;
    this.mark.className = "code-mark" + (kind ? " " + kind : "");
    this.gutter();
    if (line) {
      var lh = this.lineHeight(), top = (line - 1) * lh, h = this.ta.clientHeight;
      if (top < this.ta.scrollTop + lh || top > this.ta.scrollTop + h - 2 * lh) this.ta.scrollTop = Math.max(0, top - h / 3);
    }
    this.placeMark();
  };
  CodeEditor.prototype.setErrors = function (list) {
    var e = {};
    (list || []).forEach(function (x) { e[x.line] = (e[x.line] ? e[x.line] + " " : "") + x.msg; });
    this.errors = e;
    this.gutter();
  };

  /* Tab indents; Enter keeps the indent and adds one after a {. */
  CodeEditor.prototype.keys = function (e) {
    var ta = this.ta;
    if (ta.readOnly) return;
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.execCommand ? document.execCommand("insertText", false, "  ") : null;
      return;
    }
    if (e.key === "Enter") {
      var v = ta.value, pos = ta.selectionStart, start = v.lastIndexOf("\n", pos - 1) + 1;
      var indent = /^\s*/.exec(v.slice(start, pos))[0];
      if (/\{\s*$/.test(v.slice(start, pos))) indent += "  ";
      if (indent) {
        e.preventDefault();
        document.execCommand("insertText", false, "\n" + indent);
      }
    }
    if (e.key === "}" ) {
      var v2 = ta.value, p2 = ta.selectionStart, s2 = v2.lastIndexOf("\n", p2 - 1) + 1;
      if (/^\s+$/.test(v2.slice(s2, p2)) && p2 - s2 >= 2) {
        e.preventDefault();
        ta.setSelectionRange(p2 - 2, p2);
        document.execCommand("insertText", false, "}");
      }
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
