/* Chalk Circuit Lab — Linux for the Raspberry Pi.
 *
 * The Pi on the bench boots a small Linux: a file system with the files a
 * Pi really has (/proc/cpuinfo, /etc/os-release, /sys/class/gpio …), an SD
 * card that keeps the home folder between lessons, processes that run side
 * by side, and bash — pipes, redirection, variables, if / for / while,
 * scripts, background jobs and Ctrl+C. The commands themselves live in
 * lab_pi_cmds.js and Python in lab_pi_py.js; this file is the kernel and
 * the shell they run on.
 *
 *   var m = new ChalkLab.PiOS.Machine({ os, host, gpio, sd, onChange })
 *   m.powerOn(t)  m.advance(t)  m.powerOff()
 *   m.input("ls -l")  m.key("c" | "d" | "l")  m.complete(text)
 *   m.take()                 what has been printed since the last call
 *
 * Three flavours of Linux can be flashed onto the card — Raspberry Pi OS,
 * Ubuntu and Debian. They share a kernel here but not a personality: each
 * has its own boot messages, login banner, prompt, user, and opinions
 * about whether "python" is a command.
 *
 * A process is a generator that yields how many seconds to sleep and
 * returns its exit status. That one rule is the whole scheduler: sleep is
 * a yield, waiting for a key is a short yield in a loop, and Ctrl+C is the
 * kernel throwing SIGINT into whichever process owns the terminal.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var OS = L.PiOS = {};
  var SIGINT = L.PiPy.SIGINT;
  var ESC = "\x1b[";

  OS.c = function (code, s) { return ESC + code + "m" + s + ESC + "0m"; };
  var c = OS.c;
  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
  function lpad(s, n, ch) { s = String(s); while (s.length < n) s = (ch || " ") + s; return s; }
  OS.pad = pad; OS.lpad = lpad;

  /* ============================================================ DISTROS */

  var RASPBERRY = [
    "  `.::///+:/-.        --///+//-:``",
    " `+oooooooooooo:   `+oooooooooooo:",
    "  /oooo++//ooooo:  ooooo+//+ooooo.",
    "  `+ooooooo:-:oo-  +o+::/ooooooo:",
    "   `:oooooooo+``    `.oooooooo+-",
    "     `:++ooo/.        :+ooo+/.`",
    "        ...`  `.----.` ``..",
    "     .::::-``:::::::::.`-:::-`",
    "    -:::-`   .:::::::-`  `-:::-",
    "   `::.  `.--.`  `` `.---.``.::`",
    "       .::::::::`  -::::::::` `",
    " .::` .:::::::::- `::::::::::``::.",
    "-:::` ::::::::::.  ::::::::::.`:::-",
    "::::  -::::::::.   `-::::::::  ::::",
    "-::-   .-:::-.``....``.-::-.   -::-",
    " .. `       .::::::::.     `..`..",
    "   -:::-`   -::::::::::`  .:::::`",
    "   :::::::` -::::::::::` :::::::.",
    "   .:::::::  -::::::::. ::::::::",
    "    `-:::::`   ..--.`   ::::::.",
    "      `...`  `...--..`  `...`",
    "            .::::::::::",
    "             `.-::::-`"
  ];
  var UBUNTU = [
    "            .-/+oossssoo+/-.",
    "        `:+ssssssssssssssssss+:`",
    "      -+ssssssssssssssssssyyssss+-",
    "    .ossssssssssssssssssdMMMNysssso.",
    "   /ssssssssssshdmmNNmmyNMMMMhssssss/",
    "  +ssssssssshmydMMMMMMMNddddyssssssss+",
    " /sssssssshNMMMyhhyyyyhmNMMMNhssssssss/",
    ".ssssssssdMMMNhsssssssssshNMMMdssssssss.",
    "+sssshhhyNMMNyssssssssssssyNMMMysssssss+",
    "ossyNMMMNyMMhsssssssssssssshmmmhssssssso",
    "ossyNMMMNyMMhsssssssssssssshmmmhssssssso",
    "+sssshhhyNMMNyssssssssssssyNMMMysssssss+",
    ".ssssssssdMMMNhsssssssssshNMMMdssssssss.",
    " /sssssssshNMMMyhhyyyyhdNMMMNhssssssss/",
    "  +sssssssssdmydMMMMMMMMddddyssssssss+",
    "   /ssssssssssshdmNNNNmyNMMMMhssssss/",
    "    .ossssssssssssssssssdMMMNysssso.",
    "      -+sssssssssssssssssyyyssss+-",
    "        `:+ssssssssssssssssss+:`",
    "            .-/+oossssoo+/-."
  ];
  var DEBIAN = [
    "       _,met$$$$$gg.",
    "    ,g$$$$$$$$$$$$$$$P.",
    "  ,g$$P\"     \"\"\"Y$$.\".",
    " ,$$P'              `$$$.",
    "',$$P       ,ggs.     `$$b:",
    "`d$$'     ,$P\"'   .    $$$",
    " $$P      d$'     ,    $$P",
    " $$:      $$.   -    ,d$$'",
    " $$;      Y$b._   _,d$P'",
    " Y$$.    `.`\"Y$$$$P\"'",
    " `$$b      \"-.__",
    "  `Y$$",
    "   `Y$$.",
    "     `$$b.",
    "       `Y$$b.",
    "          `\"Y$b._",
    "              `\"\"\""
  ];

  OS.DISTROS = {
    raspios: {
      id: "raspios", name: "Raspberry Pi OS", short: "Pi OS", pretty: "Debian GNU/Linux 12 (bookworm)", like: "debian", codename: "bookworm", version: "12",
      user: "pi", host: "raspberrypi", kernel: "6.6.51+rpt-rpi-v8", build: "#1 SMP PREEMPT Debian 1:6.6.51-1+rpt3 (2024-10-08)",
      accent: "32", logo: RASPBERRY, logoColors: ["32", "31"], logoSplit: 6, python: true, shell: "bash 5.2.15", pkgs: 1563,
      issue: "Debian GNU/Linux 12",
      motd: ["", "The programs included with the Debian GNU/Linux system are free software;", "the exact distribution terms for each program are described in the", "individual files in /usr/share/doc/*/copyright.", "",
             "Debian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent", "permitted by applicable law."],
      mirror: "http://deb.debian.org/debian bookworm", mirror2: "http://archive.raspberrypi.com/debian bookworm"
    },
    ubuntu: {
      id: "ubuntu", name: "Ubuntu", short: "Ubuntu", pretty: "Ubuntu 24.04.1 LTS", like: "debian", codename: "noble", version: "24.04",
      user: "ubuntu", host: "ubuntu", kernel: "6.8.0-1013-raspi", build: "#14-Ubuntu SMP PREEMPT_DYNAMIC Wed Oct  2 15:14:53 UTC 2024",
      accent: "38;5;208", logo: UBUNTU, logoColors: ["38;5;208"], python: false, shell: "bash 5.2.21", pkgs: 1124,
      issue: "Ubuntu 24.04.1 LTS",
      motd: null,
      mirror: "http://ports.ubuntu.com/ubuntu-ports noble", mirror2: "http://ports.ubuntu.com/ubuntu-ports noble-updates"
    },
    debian: {
      id: "debian", name: "Debian", short: "Debian", pretty: "Debian GNU/Linux 12 (bookworm)", like: null, codename: "bookworm", version: "12",
      user: "debian", host: "debian", kernel: "6.1.0-26-arm64", build: "#1 SMP Debian 6.1.112-1 (2024-09-30)",
      accent: "31", logo: DEBIAN, logoColors: ["31"], python: false, shell: "bash 5.2.15", pkgs: 987,
      issue: "Debian GNU/Linux 12",
      motd: ["", "The programs included with the Debian GNU/Linux system are free software;", "the exact distribution terms for each program are described in the", "individual files in /usr/share/doc/*/copyright.", "",
             "Debian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent", "permitted by applicable law."],
      mirror: "http://deb.debian.org/debian bookworm", mirror2: "http://deb.debian.org/debian-security bookworm-security"
    }
  };
  OS.MODEL = "Raspberry Pi 4 Model B Rev 1.5";

  /* ============================================================= SCREEN */

  /* The terminal's glass: text in, lines of styled characters out. Knows
   * just enough escape codes for a shell — colour, clear, carriage return,
   * erase-line, and the alternate screen full-page programs draw on. */
  function Screen(limit) { this.limit = limit || 500; this.reset(); }
  OS.Screen = Screen;
  Screen.prototype.reset = function () {
    this.main = { lines: [[]], row: 0, col: 0 }; this.altBuf = null; this.buf = this.main;
    this.style = ""; this.bold = false; this.dim = false; this.fg = ""; this.rev = false;
    this.version = 0; this.bell = 0; this.pending = "";
    this.dirtyFrom = 0; this.cut = 0; this.cleared = true;
  };
  Screen.prototype.touch = function (b) { if (b === this.main && b.row < this.dirtyFrom) this.dirtyFrom = b.row; };
  Screen.prototype.alt = function () { return this.buf !== this.main; };
  Screen.prototype.sgr = function (codes) {
    for (var i = 0; i < codes.length; i++) {
      var n = codes[i];
      if (n === 0) { this.bold = this.dim = this.rev = false; this.fg = ""; }
      else if (n === 1) this.bold = true;
      else if (n === 2) this.dim = true;
      else if (n === 7) this.rev = true;
      else if (n === 22) this.bold = this.dim = false;
      else if (n === 27) this.rev = false;
      else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) this.fg = "f" + n;
      else if (n === 39) this.fg = "";
      else if (n === 38 && codes[i + 1] === 5) { this.fg = "x" + codes[i + 2]; i += 2; }
    }
    this.style = (this.bold ? "b " : "") + (this.dim ? "d " : "") + (this.rev ? "r " : "") + this.fg;
  };
  Screen.prototype.write = function (text) {
    var s = this.pending + text, b = this.buf, i = 0, n = s.length;
    this.pending = "";
    this.version++;
    while (i < n) {
      var ch = s.charAt(i);
      if (ch === "\x1b") {
        var m = /^\x1b\[(\??)([0-9;]*)([A-Za-z])/.exec(s.substr(i, 24));
        if (!m) { if (n - i < 12 && /^\x1b(\[[?0-9;]*)?$/.test(s.slice(i))) { this.pending = s.slice(i); break; } i++; continue; }
        i += m[0].length;
        var nums = m[2] === "" ? [] : m[2].split(";").map(Number);
        switch (m[3]) {
          case "m": this.sgr(nums.length ? nums : [0]); break;
          case "J": b.lines = [[]]; b.row = 0; b.col = 0; this.cleared = true; this.dirtyFrom = 0; break;
          case "H": b.row = Math.max(0, (nums[0] || 1) - 1); b.col = Math.max(0, (nums[1] || 1) - 1); while (b.lines.length <= b.row) b.lines.push([]); break;
          case "K": b.lines[b.row].length = Math.min(b.lines[b.row].length, b.col); this.touch(b); break;
          case "h": if (m[1] && nums[0] === 1049) { this.altBuf = { lines: [[]], row: 0, col: 0 }; this.buf = b = this.altBuf; this.cleared = true; } break;
          case "l": if (m[1] && nums[0] === 1049) { this.buf = b = this.main; this.altBuf = null; this.cleared = true; } break;
        }
        continue;
      }
      i++;
      if (ch === "\n") { b.row++; b.col = 0; if (b.row >= b.lines.length) b.lines.push([]); this.touch(b); this.trim(b); continue; }
      if (ch === "\r") { b.col = 0; continue; }
      if (ch === "\b") { if (b.col > 0) b.col--; continue; }
      if (ch === "\x07") { this.bell++; continue; }
      if (ch === "\t") { var to = (Math.floor(b.col / 8) + 1) * 8; while (b.col < to) this.put(b, " "); continue; }
      if (ch < " ") continue;
      this.put(b, ch);
    }
  };
  Screen.prototype.put = function (b, ch) {
    var line = b.lines[b.row];
    while (line.length < b.col) line.push([" ", ""]);
    line[b.col++] = [ch, this.style];
    this.touch(b);
  };
  Screen.prototype.trim = function (b) {
    if (b !== this.main) return;
    var over = b.lines.length - this.limit;
    if (over > 0) { b.lines.splice(0, over); b.row -= over; this.cut += over; this.dirtyFrom = Math.max(0, this.dirtyFrom - over); }
  };
  /* Plain text of what is showing — what a test, or a screen reader, wants. */
  Screen.prototype.text = function (tail) {
    var lines = this.buf.lines.map(function (l) { return l.map(function (x) { return x[0]; }).join(""); });
    return (tail ? lines.slice(-tail) : lines).join("\n");
  };

  /* ================================================================ SD */

  /* The SD card, as text: every file in the home folder and the names of
   * the extra packages installed. It rides along inside the saved circuit
   * (as that board's "program"), which is how a Pi keeps its files between
   * lessons without the server having to know what a Pi is. */
  OS.packSD = function (card) {
    var out = ["#!chalk-sd 1"];
    (card.pkgs || []).forEach(function (p) { out.push("#@pkg " + p); });
    Object.keys(card.files || {}).sort().forEach(function (path) {
      var f = card.files[path];
      if (f.dir) { out.push("#>> " + path + "/"); return; }
      out.push("#>> " + path + (f.x ? " +x" : ""));
      var lines = String(f.text).split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      lines.forEach(function (l) { out.push(/^#(>>|@|\\)/.test(l) ? "#\\" + l : l); });
    });
    return out.join("\n") + "\n";
  };
  OS.unpackSD = function (text) {
    var card = { files: {}, pkgs: [] }, cur = null;
    if (!/^#!chalk-sd/.test(text || "")) return card;
    String(text).split("\n").slice(1).forEach(function (l) {
      var m;
      if ((m = /^#@pkg (\S+)/.exec(l))) { card.pkgs.push(m[1]); return; }
      if ((m = /^#>> (.+?)( \+x)?$/.exec(l))) {
        var path = m[1];
        if (/\/$/.test(path)) { card.files[path.replace(/\/$/, "")] = { dir: true }; cur = null; return; }
        cur = card.files[path] = { text: "", x: !!m[2] };
        return;
      }
      if (cur) cur.text += (l.indexOf("#\\") === 0 ? l.slice(2) : l) + "\n";
    });
    Object.keys(card.files).forEach(function (k) { var f = card.files[k]; if (!f.dir && /\n\n$/.test(f.text) && k) f.text = f.text.replace(/\n$/, ""); });
    return card;
  };
  /* A card with these files on it: {"blink.py": "…", "run.sh": {text, x}} */
  OS.makeSD = function (files, pkgs) {
    var card = { files: {}, pkgs: pkgs || [] };
    Object.keys(files || {}).forEach(function (k) { var f = files[k]; card.files[k] = typeof f === "string" ? { text: f } : f; });
    return OS.packSD(card);
  };
  OS.SD_LIMIT = 26000;        /* characters; the saved circuit allows a program 30,000 */

  /* ======================================================== FILE SYSTEM */

  function Dir(kids) { this.kids = kids || {}; this.mt = Date.now(); }
  function File(text, o) { this.text = text || ""; this.mt = Date.now(); if (o) for (var k in o) this[k] = o[k]; }
  OS.Dir = Dir; OS.File = File;

  function FS(m) { this.m = m; this.root = new Dir(); }
  OS.FS = FS;
  FS.prototype.norm = function (path, cwd) {
    var parts = (path.charAt(0) === "/" ? path : (cwd || "/") + "/" + path).split("/"), out = [];
    parts.forEach(function (p) { if (!p || p === ".") return; if (p === "..") out.pop(); else out.push(p); });
    return "/" + out.join("/");
  };
  FS.prototype.node = function (abs) {
    var n = this.root, parts = abs.split("/").filter(Boolean);
    for (var i = 0; i < parts.length; i++) { if (!(n instanceof Dir) || !Object.prototype.hasOwnProperty.call(n.kids, parts[i])) return null; n = n.kids[parts[i]]; }
    return n;
  };
  FS.prototype.parent = function (abs) { var i = abs.lastIndexOf("/"); return { dir: this.node(abs.slice(0, i) || "/"), name: abs.slice(i + 1), path: abs.slice(0, i) || "/" }; };
  FS.prototype.mkdirp = function (abs) {
    var n = this.root;
    abs.split("/").filter(Boolean).forEach(function (p) { if (!n.kids[p]) n.kids[p] = new Dir(); n = n.kids[p]; });
    return n;
  };
  FS.prototype.put = function (abs, text, o) { var p = this.parent(abs); this.mkdirp(p.path).kids[p.name] = new File(text, o); };
  FS.prototype.dyn = function (abs, get, put) { var p = this.parent(abs), f = new File(""); f.get = get; f.set = put || null; this.mkdirp(p.path).kids[p.name] = f; };
  FS.prototype.readNode = function (n) { return n.get ? n.get() : n.text; };
  FS.prototype.home = function () { return "/home/" + this.m.os.user; };
  FS.prototype.inHome = function (abs) { var h = this.home(); return abs === h || abs.indexOf(h + "/") === 0; };
  FS.prototype.mayWrite = function (abs, rootUser) {
    if (rootUser) return !/^\/(proc|sys\/firmware|sys\/class\/thermal)(\/|$)/.test(abs);
    return this.inHome(abs) || /^\/tmp(\/|$)/.test(abs) || /^\/sys\/class\/gpio\//.test(abs) || abs === "/dev/null";
  };
  FS.prototype.used = function () {
    var total = 0;
    (function walk(d) { Object.keys(d.kids).forEach(function (k) { var n = d.kids[k]; if (n instanceof Dir) { total += k.length + 6; walk(n); } else total += n.text.length + k.length + 8; }); })(this.node(this.home()) || new Dir());
    return total;
  };
  /* Write a file. Returns null, or the reason it couldn't, in errno's words. */
  FS.prototype.write = function (abs, text, append, rootUser) {
    if (abs === "/dev/null") return null;
    var p = this.parent(abs), cur = p.dir instanceof Dir ? p.dir.kids[p.name] : null;
    if (!(p.dir instanceof Dir)) return "No such file or directory";
    if (cur instanceof Dir) return "Is a directory";
    if (cur && cur.set) return cur.set(String(text).replace(/\n$/, ""), rootUser);
    if (!this.mayWrite(abs, rootUser) || (cur && cur.get)) return "Permission denied";
    var next = append && cur ? cur.text + text : String(text);
    if (this.inHome(abs) && this.used() - (cur ? cur.text.length : 0) + next.length > OS.SD_LIMIT) return "No space left on device";
    if (cur) { cur.text = next; cur.mt = Date.now(); } else p.dir.kids[p.name] = new File(next);
    p.dir.mt = Date.now();
    if (this.inHome(abs)) this.m.changed();
    return null;
  };
  /* Match a pattern against the tree. The shell marks its wildcards with
   * private characters (so a quoted "*" stays a star): \uE000 is *, \uE001 is ?. */
  FS.prototype.glob = function (pat, cwd) {
    var self = this, abs = pat.charAt(0) === "/", segs = pat.split("/").filter(function (x) { return x !== ""; }), out = [];
    (function walk(dir, i, shown) {
      if (i === segs.length) { out.push(shown); return; }
      var seg = segs[i], n = self.node(dir), join = function (name) { return shown === "/" ? "/" + name : shown ? shown + "/" + name : name; };
      if (!(n instanceof Dir)) return;
      if (!/[\uE000\uE001]/.test(seg)) { var nx = self.norm(seg, dir); if (seg === "." || seg === ".." || self.node(nx)) walk(nx, i + 1, join(seg)); return; }
      var re = new RegExp("^" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\uE000/g, ".*").replace(/\uE001/g, ".") + "$");
      Object.keys(n.kids).sort().forEach(function (k) { if (k.charAt(0) === "." && seg.charAt(0) !== ".") return; if (re.test(k)) walk(self.norm(k, dir), i + 1, join(k)); });
    })(abs ? "/" : cwd, 0, abs ? "/" : "");
    return out;
  };

  /* ============================================================ MACHINE */

  function Machine(opts) {
    opts = opts || {};
    this.os = OS.DISTROS[opts.os] || OS.DISTROS.raspios;
    this.gpio = opts.gpio;
    this.hostName = opts.host || this.os.host;
    this.onChange = opts.onChange || function () {};
    this.onHost = opts.onHost || function () {};
    this.onEdit = null;                      /* nano: set by the terminal window */
    this.clock = opts.clock || function () { return Date.now(); };
    this.epoch = opts.epoch || null;         /* fixed wall clock, for tests */
    this.cols = 80; this.rows = 24;
    this.screen = new Screen();
    this.state = "off"; this.t = 0; this.bootT = 0; this.boots = 0;
    this.outBuf = "";
    this.sdText = opts.sd || "";
    this.reset();
  }
  OS.Machine = Machine;
  var M = Machine.prototype;

  M.reset = function () {
    this.procs = []; this.nextPid = 612; this.fg = null; this.stdin = []; this.keys = [];
    this.wantIn = false; this.raw = false; this.notes = []; this.jobs = [];
    this.buffer = ""; this.sh = null; this.heat = 43.8;
  };
  M.write = function (s) { if (!s) return; this.outBuf += s; this.screen.write(s); };
  M.take = function () { var s = this.outBuf; this.outBuf = ""; return s; };
  M.wall = function () { return (this.epoch != null ? this.epoch : this.bootWall) + (this.t - this.bootT); };
  M.uptime = function () { return Math.max(0, this.t - this.bootT); };
  M.changed = function () {
    if (this.loading) return;
    this.sdText = this.packSD();
    this.onChange(this.sdText);
  };
  /* The CPU warms up with work, the way the real one does. */
  M.temp = function () {
    var busy = this.procs.filter(function (p) { return !p.sys; }).length;
    var want = 43.3 + Math.min(4, busy) * 3.4;
    this.heat += (want - this.heat) * 0.02;
    return Math.round((this.heat + Math.sin(this.t * 1.7) * 0.35) * 10) / 10;
  };

  M.packSD = function () {
    var card = { files: {}, pkgs: Object.keys(this.pkgs).filter(function (p) { return !OS.PREINSTALLED[p]; }) }, home = this.fs.home(), self = this;
    (function walk(d, rel) {
      Object.keys(d.kids).forEach(function (k) {
        var n = d.kids[k], path = rel ? rel + "/" + k : k;
        if (n instanceof Dir) { if (!Object.keys(n.kids).length) card.files[path] = { dir: true }; walk(n, path); }
        else card.files[path] = { text: n.text, x: !!n.x };
      });
    })(self.fs.node(home) || new Dir(), "");
    return OS.packSD(card);
  };

  /* Build the file system for this boot: the read-only system, then the
   * home folder off the SD card. */
  M.mount = function () {
    var self = this, os = this.os, fs = this.fs = new FS(this), home = fs.home();
    this.loading = true;
    this.pkgs = {};
    Object.keys(OS.PREINSTALLED).forEach(function (p) { self.pkgs[p] = 1; });
    ["/bin", "/boot/firmware", "/dev", "/etc", "/home", "/lib", "/media", "/mnt", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys/class/gpio", "/sys/class/thermal/thermal_zone0", "/tmp", "/usr/bin", "/usr/lib", "/usr/share", "/var/log", home].forEach(function (d) { fs.mkdirp(d); });
    fs.put("/etc/os-release", osRelease(os));
    fs.dyn("/etc/hostname", function () { return self.hostName + "\n"; });
    fs.put("/etc/issue", os.issue + " \\n \\l\n\n");
    fs.put("/etc/motd", (os.motd || []).join("\n") + "\n");
    fs.put("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\n" + os.user + ":x:1000:1000:,,,:" + home + ":/bin/bash\n");
    fs.put("/etc/debian_version", os.id === "ubuntu" ? "trixie/sid\n" : "12.7\n");
    fs.put("/boot/firmware/config.txt", "# For more options and information see\n# http://rptl.io/configtxt\n\ndtparam=audio=on\ncamera_auto_detect=1\ndisplay_auto_detect=1\nauto_initramfs=1\ndtoverlay=vc4-kms-v3d\nmax_framebuffers=2\narm_64bit=1\narm_boost=1\n\n[all]\nenable_uart=1\n");
    fs.put("/boot/firmware/cmdline.txt", "console=serial0,115200 console=tty1 root=PARTUUID=4c4e106f-02 rootfstype=ext4 fsck.repair=yes rootwait quiet\n");
    fs.put("/proc/cpuinfo", cpuinfo());
    fs.put("/proc/version", "Linux version " + os.kernel + " (gcc-12 (Debian 12.2.0-14) 12.2.0, GNU ld (GNU Binutils for Debian) 2.40) " + os.build + "\n");
    fs.dyn("/proc/meminfo", function () { var f = self.memFree(); return "MemTotal:        3884404 kB\nMemFree:         " + f + " kB\nMemAvailable:    " + (f + 412800) + " kB\nBuffers:           38124 kB\nCached:           371204 kB\nSwapTotal:        102396 kB\nSwapFree:         102396 kB\n"; });
    fs.dyn("/proc/uptime", function () { return self.uptime().toFixed(2) + " " + (self.uptime() * 3.92).toFixed(2) + "\n"; });
    fs.dyn("/proc/loadavg", function () { var l = self.load(); return l.map(function (x) { return x.toFixed(2); }).join(" ") + " 1/" + (142 + self.procs.length) + " " + self.nextPid + "\n"; });
    fs.put("/proc/device-tree/model", OS.MODEL);
    fs.put("/sys/firmware/devicetree/base/model", OS.MODEL);
    fs.dyn("/sys/class/thermal/thermal_zone0/temp", function () { return Math.round(self.temp() * 1000) + "\n"; });
    fs.put("/dev/null", ""); fs.put("/dev/tty1", ""); fs.put("/dev/gpiochip0", ""); fs.put("/dev/mmcblk0", ""); fs.put("/dev/i2c-1", "");
    fs.put("/var/log/syslog", "");
    this.sysfsGpio();
    Object.keys(OS.CMDS).forEach(function (name) { var d = OS.CMDS[name]; if (!d.builtin && (!d.pkg || self.pkgs[d.pkg]) && (!d.only || d.only.indexOf(os.id) >= 0)) fs.put("/usr/bin/" + name, "", { x: true, bin: true }); });
    var card = OS.unpackSD(this.sdText), fresh = !/^#!chalk-sd/.test(this.sdText || "");
    if (fresh) card = OS.unpackSD(OS.starterSD());
    card.pkgs.forEach(function (p) { if (OS.PACKAGES[p]) self.installPkg(p); });
    Object.keys(card.files).forEach(function (rel) {
      var f = card.files[rel];
      if (f.dir) fs.mkdirp(home + "/" + rel); else fs.put(home + "/" + rel, f.text, f.x ? { x: true } : null);
    });
    this.loading = false;
    if (fresh) { this.sdText = this.packSD(); }
  };
  M.installPkg = function (p) {
    var self = this;
    this.pkgs[p] = 1;
    Object.keys(OS.CMDS).forEach(function (name) { if (OS.CMDS[name].pkg === p && self.fs) self.fs.put("/usr/bin/" + name, "", { x: true, bin: true }); });
  };
  M.removePkg = function (p) {
    var self = this;
    delete this.pkgs[p];
    Object.keys(OS.CMDS).forEach(function (name) { if (OS.CMDS[name].pkg === p) { var d = self.fs.node("/usr/bin"); if (d) delete d.kids[name]; } });
  };
  M.memFree = function () { return 3212000 - this.procs.length * 9400 - Math.round(this.uptime() * 3) % 5000; };
  M.load = function () { var busy = this.procs.filter(function (p) { return !p.sys; }).length; return [0.08 + busy * 0.42, 0.12 + busy * 0.18, 0.09 + busy * 0.07]; };

  function osRelease(os) {
    if (os.id === "ubuntu") return 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\nSUPPORT_URL="https://help.ubuntu.com/"\nUBUNTU_CODENAME=noble\n';
    return 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nVERSION="12 (bookworm)"\nVERSION_CODENAME=bookworm\nID=debian\nHOME_URL="https://www.debian.org/"\nSUPPORT_URL="https://www.debian.org/support"\nBUG_REPORT_URL="https://bugs.debian.org/"\n';
  }
  function cpuinfo() {
    var s = "";
    for (var i = 0; i < 4; i++) s += "processor\t: " + i + "\nBogoMIPS\t: 108.00\nFeatures\t: fp asimd evtstrm crc32 cpuid\nCPU implementer\t: 0x41\nCPU architecture: 8\nCPU variant\t: 0x0\nCPU part\t: 0xd08\nCPU revision\t: 3\n\n";
    return s + "Revision\t: c03115\nSerial\t\t: 10000000c0ffee42\nModel\t\t: " + OS.MODEL + "\n";
  }

  /* /sys/class/gpio: the oldest way to switch a pin — write numbers into
   * files. Deprecated on a real Pi, and still the clearest demonstration
   * that on Linux everything, even a wire, is a file. */
  M.sysfsGpio = function () {
    var self = this, fs = this.fs, base = "/sys/class/gpio", gpio = this.gpio;
    var num = function (s) { return /^\d+$/.test(s.trim()) && gpio.valid(+s) ? +s.trim() : null; };
    fs.dyn(base + "/export", function () { return ""; }, function (text) {
      var n = num(text);
      if (n == null) return "Invalid argument";
      if (fs.node(base + "/gpio" + n)) return "Device or resource busy";
      var dir = base + "/gpio" + n, st = { dir: "in" };
      gpio.setup(n, "in");
      fs.dyn(dir + "/direction", function () { return st.dir + "\n"; }, function (v) {
        v = v.trim();
        if (!/^(in|out|high|low)$/.test(v)) return "Invalid argument";
        st.dir = v === "in" ? "in" : "out";
        gpio.setup(n, st.dir);
        if (st.dir === "out") gpio.write(n, v === "high" ? 1 : 0);
        return null;
      });
      fs.dyn(dir + "/value", function () { return gpio.read(n) + "\n"; }, function (v) {
        if (st.dir !== "out") return "Operation not permitted";
        if (!/^\d+$/.test(v.trim())) return "Invalid argument";
        gpio.write(n, +v.trim() ? 1 : 0);
        return null;
      });
      fs.dyn(dir + "/active_low", function () { return "0\n"; });
      return null;
    });
    fs.dyn(base + "/unexport", function () { return ""; }, function (text) {
      var n = num(text), d = fs.node(base);
      if (n == null || !d.kids["gpio" + n]) return "Invalid argument";
      delete d.kids["gpio" + n];
      gpio.release(n);
      return null;
    });
    fs.mkdirp(base + "/gpiochip0");
    fs.put(base + "/gpiochip0/label", "pinctrl-bcm2711\n"); fs.put(base + "/gpiochip0/ngpio", "58\n"); fs.put(base + "/gpiochip0/base", "0\n");
  };

  /* ----------------------------------------------------------- power */

  M.powerOn = function (t) {
    if (this.state !== "off" && this.state !== "halted") return;
    this.reset();
    this.t = t || 0; this.bootT = this.t; this.bootWall = Date.now() / 1000; this.boots++;
    this.screen.reset(); this.outBuf = "\x1b[2J\x1b[H";
    if (this.gpio.resetAll) this.gpio.resetAll();
    this.mount();
    this.sh = new OS.Shell(this, this.os.user);
    this.state = "booting";
    var p = this.spawn(this.bootSeq(), "systemd", true);
    p.sys = true; p.pid = 1; p.login = true;
  };
  M.powerOff = function () {
    this.killAll();
    this.state = "off"; this.fg = null; this.raw = false; this.wantIn = false;
    if (this.gpio.resetAll) this.gpio.resetAll();
    this.screen.reset(); this.outBuf = "\x1b[2J\x1b[H";
  };
  M.killAll = function () {
    this.procs.forEach(function (p) { if (p.py) try { p.py.cleanup(); } catch (e) {} });
    this.procs = [];
  };

  M.bootSeq = function* () {
    var os = this.os, self = this, t = 0;
    var k = function (dt, msg) { t += dt; return c("2", "[" + lpad(t.toFixed(6), 12) + "] ") + msg + "\n"; };
    var ok = function (msg) { return "[" + c("32", "  OK  ") + "] " + msg + "\n"; };
    this.write(k(0, "Booting Linux on physical CPU 0x0000000000 [0x410fd083]"));
    this.write(k(0, "Linux version " + os.kernel + " (aarch64-linux-gnu-gcc-12) " + os.build));
    this.write(k(0, "Machine model: " + OS.MODEL));
    yield 0.18;
    this.write(k(0.000412, "Memory: 3737208K/4050944K available (12736K kernel code, 2196K rwdata)"));
    this.write(k(0.092, "smp: Brought up 1 node, 4 CPUs"));
    this.write(k(0.31, "raspberrypi-firmware soc:firmware: Attached to firmware from 2024-09-23T13:02:56"));
    yield 0.22;
    this.write(k(0.47, "mmc0: new high speed SDHC card at address aaaa"));
    this.write(k(0.004, "mmcblk0: mmc0:aaaa SC32G 29.7 GiB"));
    this.write(k(0.19, "pinctrl-bcm2835 fe200000.gpio: GPIO chip registered, 58 lines"));
    yield 0.25;
    this.write(k(0.62, "EXT4-fs (mmcblk0p2): mounted filesystem with ordered data mode. Quota mode: none."));
    this.write(k(0.31, "systemd[1]: systemd " + (os.id === "ubuntu" ? "255.4-1ubuntu8.4" : "252.30-1~deb12u2") + " running in system mode"));
    this.write(k(0.02, "systemd[1]: Hostname set to <" + this.hostName + ">."));
    yield 0.3;
    this.write("\nWelcome to " + c("1;" + os.accent, os.pretty) + "!\n\n");
    var units = ["Started systemd-journald.service - Journal Service.", "Finished systemd-remount-fs.service - Remount Root and Kernel File Systems.", "Reached target local-fs.target - Local File Systems.",
      "Started systemd-timesyncd.service - Network Time Synchronization.", "Started dbus.service - D-Bus System Message Bus.", "Started wpa_supplicant.service - WPA supplicant.",
      "Reached target network-online.target - Network is Online.", "Started ssh.service - OpenBSD Secure Shell server.", "Started getty@tty1.service - Getty on tty1.", "Reached target multi-user.target - Multi-User System."];
    if (this.panicked) { units.splice(2, 0, "Finished chalk-restore.service - Restore the SD card from the lab's backup image."); this.panicked = false; }
    for (var i = 0; i < units.length; i++) { this.write(ok(units[i])); yield 0.07 + (i % 3) * 0.05; }
    yield 0.25;
    this.write("\x1b[2J\x1b[H");
    this.write(os.issue + " " + this.hostName + " tty1\n\n" + this.hostName + " login: " + os.user + " (automatic login)\n\n");
    yield 0.12;
    this.banner();
    this.state = "on";
    return 0;
  };
  /* "exit" at the login shell: getty puts the login screen back and signs in again */
  M.getty = function* () {
    yield 0.5;
    this.write("\x1b[2J\x1b[H" + this.os.issue + " " + this.hostName + " tty1\n\n" + this.hostName + " login: " + this.os.user + " (automatic login)\n\n");
    yield 0.3;
    this.sh = new OS.Shell(this, this.os.user);
    this.banner();
    return 0;
  };
  M.banner = function () {
    var os = this.os, d = new Date(this.wall() * 1000 - 3600e3 * 21);
    if (os.id === "ubuntu") {
      this.write("Welcome to Ubuntu 24.04.1 LTS (GNU/Linux " + os.kernel + " aarch64)\n\n * Documentation:  https://help.ubuntu.com\n * Management:     https://landscape.canonical.com\n * Support:        https://ubuntu.com/pro\n\n" +
        " System information as of " + OS.dateStr(new Date(this.wall() * 1000)) + "\n\n" +
        "  System load:  " + pad(this.load()[0].toFixed(2), 18) + "Temperature:           " + this.temp().toFixed(1) + " C\n" +
        "  Usage of /:   " + pad("11.4% of 28.76GB", 18) + "Processes:             " + (142 + this.procs.length) + "\n" +
        "  Memory usage: " + pad("9%", 18) + "Users logged in:       0\n" +
        "  Swap usage:   " + pad("0%", 18) + "IPv4 address for wlan0: 192.168.4.27\n\n0 updates can be applied immediately.\n\n");
    } else {
      this.write("Linux " + this.hostName + " " + os.kernel + " " + os.build + " aarch64\n" + (os.motd || []).join("\n") + "\n");
    }
    this.write("Last login: " + OS.dateStr(d).replace(/ \d{4}$/, "") + " " + d.getFullYear() + " on tty1\n");
    this.write(c("2", "Type ") + c("1", "help") + c("2", " for the commands this Pi knows, or try ") + c("1", "pinout") + c("2", " and ") + c("1", "neofetch") + c("2", ".") + "\n");
  };
  OS.dateStr = function (d) {
    var D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], Mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], p2 = function (n) { return lpad(n, 2, "0"); };
    return D[d.getDay()] + " " + Mo[d.getMonth()] + " " + lpad(d.getDate(), 2) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + " " + d.getFullYear();
  };

  M.halt = function* (reboot) {
    var self = this;
    this.state = "halting";
    this.procs.forEach(function (p) { if (p !== self.fg && p.py) try { p.py.cleanup(); } catch (e) {} });
    this.procs = this.procs.filter(function (p) { return p === self.fg; });
    this.write("\n");
    var ok = function (msg) { return "[" + c("32", "  OK  ") + "] " + msg + "\n"; };
    var lines = ["Stopped target multi-user.target - Multi-User System.", "Stopped ssh.service - OpenBSD Secure Shell server.", "Stopped getty@tty1.service - Getty on tty1.", "Stopped target network-online.target - Network is Online.",
      "Unmounted boot-firmware.mount - /boot/firmware.", "Reached target shutdown.target - System Shutdown.", "Reached target final.target - Late Shutdown Services."];
    for (var i = 0; i < lines.length; i++) { this.write(ok(lines[i])); yield 0.09; }
    this.write(c("2", "[" + lpad(this.uptime().toFixed(6), 12) + "] ") + (reboot ? "reboot: Restarting system\n" : "reboot: Power down\n"));
    yield 0.35;
    if (this.gpio.resetAll) this.gpio.resetAll();
    this.state = reboot ? "off" : "halted"; this.haltT = this.t;
    this.fg = null; this.procs = [];
    if (reboot) this.powerOn(this.t);
    else this.write("\n" + c("2", "The Pi has shut down. It is safe to unplug: switch the bench power off and on again to start it.") + "\n");
    return 0;
  };

  /* --------------------------------------------------------- processes */

  M.spawn = function (gen, name, fg, extra) {
    var p = { pid: this.nextPid++, gen: gen, name: name, wake: this.t, fg: !!fg, t0: this.t, cpu: 0, user: this.sh ? this.sh.user : "root" };
    if (extra) for (var k in extra) p[k] = extra[k];
    this.procs.push(p);
    if (fg) this.fg = p;
    return p;
  };
  M.finish = function (p, code) {
    var i = this.procs.indexOf(p);
    if (i >= 0) this.procs.splice(i, 1);
    if (p.py) try { p.py.cleanup(); } catch (e) {}
    if (p.job) { var j = this.jobs.indexOf(p.job); if (j >= 0) { this.jobs.splice(j, 1); this.notes.push("[" + p.job.n + "]+  " + (code === 0 ? "Done" : code === 143 ? "Terminated" : code === 130 ? "Interrupt" : "Exit " + code) + "                    " + p.job.cmd); } }
    if (p === this.fg) {
      this.fg = null; this.wantIn = false; this.raw = false; this.stdin = []; this.keys = [];
      if (this.state !== "on" || !this.sh) return;
      var sh = this.sh;
      sh.vars["?"] = String(code == null ? 0 : code);
      if (p.login) {
        /* ~/.bashrc runs as an ordinary job, so a loop in it can still be stopped with Ctrl+C */
        var rc = this.fs.node(this.fs.home() + "/.bashrc"), tree = null;
        if (rc && rc.text.trim()) try { tree = OS.parse(rc.text); } catch (e) { this.write("-bash: .bashrc: " + (e.syntax || "unexpected end of file") + "\n"); }
        if (tree && tree.items.length) { this.spawn(sh.execList(tree, sh.tty()), "source ~/.bashrc", true); return; }
      }
      if (sh.exiting != null) {
        sh.exiting = null;
        if (sh.prev) { this.sh = sh.prev; }
        else { this.write("logout\n"); var g = this.spawn(this.getty(), "agetty", true); g.sys = true; g.login = true; return; }
      }
      this.prompt();
    }
  };
  M.step = function (p, sig) {
    var r;
    try { r = sig ? p.gen.throw(sig) : p.gen.next(); }
    catch (e) {
      if (e === SIGINT) { this.finish(p, 130); return false; }
      if (e && e.exit != null) { this.finish(p, e.exit); return false; }
      if (root.console) console.error(e);
      this.write(p.name.split(" ")[0] + ": " + c("31", "Segmentation fault") + c("2", "  (the simulator tripped: " + (e && e.message || e) + ")") + "\n");
      this.finish(p, 139);
      return false;
    }
    if (r.done) { this.finish(p, typeof r.value === "number" ? r.value : 0); return false; }
    var s = r.value > 0 ? r.value : 0;
    p.wake = (s > 0 && p.wake > this.t - 0.05 ? p.wake : this.t) + s;
    return true;
  };
  /* Run everything that is due, for at most a few milliseconds of real time. */
  M.advance = function (t) {
    if (this.state === "off" || this.state === "halted") { this.t = t; return; }
    this.t = t;
    var start = this.clock(), list = this.procs.slice(), budget = this.budget || 7;
    for (var round = 0; round < 400; round++) {
      var ran = false;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (this.procs.indexOf(p) < 0 || p.wake > t) continue;
        ran = true;
        var before = this.clock();
        this.step(p);
        p.cpu += this.clock() - before;
        if (this.state === "off") return;
      }
      if (!ran || this.clock() - start > budget) break;
    }
  };
  M.interrupt = function () {
    var p = this.fg;
    if (!p) return false;
    if (p.sys) return true;
    this.step(p, SIGINT);
    return true;
  };
  M.kill = function (p, code) {
    if (p.sys) return false;
    if (p.py) try { p.py.cleanup(); } catch (e) {}
    this.finish(p, code == null ? 143 : code);
    return true;
  };

  /* ---------------------------------------------------------- terminal */

  M.prompt = function () {
    if (this.notes.length) { this.write(this.notes.join("\n") + "\n"); this.notes = []; }
    this.write(this.sh.ps1());
  };
  /* A whole line typed at the keyboard. */
  M.input = function (line) {
    if (this.state !== "on") return;
    this.write(line + "\n");
    if (this.fg) { this.stdin.push(line); return; }
    var sh = this.sh;
    if (this.buffer === "" && line.trim() === "") { this.prompt(); return; }
    var src = this.buffer + line, tree;
    try { tree = OS.parse(src); }
    catch (e) {
      if (e.incomplete) { this.buffer = src + "\n"; this.write("> "); return; }
      this.buffer = "";
      sh.remember(src);
      this.write("-bash: " + e.syntax + "\n");
      sh.vars["?"] = "2";
      this.prompt();
      return;
    }
    this.buffer = "";
    sh.remember(src);
    if (!tree.items.length) { this.prompt(); return; }
    this.spawn(sh.execList(tree, sh.tty()), src.split("\n")[0].trim().slice(0, 60), true);
    this.advance(this.t);
  };
  /* Run a command line as if it had been typed (used by ~/.bashrc and the Run button). */
  M.runLine = function (line, quiet) {
    if (this.state !== "on" || this.fg) return false;
    if (!quiet) this.write(line + "\n"); else this.write("\r\x1b[K");
    var tree;
    try { tree = OS.parse(line); } catch (e) { this.write("-bash: " + (e.syntax || "unexpected end of file") + "\n"); this.prompt(); return false; }
    this.spawn(this.sh.execList(tree, this.sh.tty()), line.slice(0, 60), true);
    this.advance(this.t);
    return true;
  };
  M.key = function (k) {
    if (this.state === "booting" || this.state === "halting" || this.state === "off" || this.state === "halted") return;
    if (k === "c") {
      if (this.fg) { if (!this.raw) this.write("^C\n"); this.interrupt(); }
      else { this.buffer = ""; this.write("^C\n"); this.prompt(); }
    } else if (k === "d") {
      if (this.fg) this.stdin.push(false);
      else if (this.buffer === "") this.input("exit");
    } else if (k === "l") {
      if (!this.fg) { this.write("\x1b[2J\x1b[H"); this.prompt(); }
    }
  };
  M.keypress = function (ch) { if (this.raw && this.fg) this.keys.push(ch); };

  /* Tab: finish the word under the cursor, or list what it could be. */
  M.complete = function (text) {
    if (this.state !== "on" || this.fg) return { text: text, list: [] };
    var m = /(^|[\s;|&])([^\s;|&]*)$/.exec(text), word = m ? m[2] : "", head = text.slice(0, text.length - word.length);
    var first = /(^|[;|&])\s*(sudo\s+)?$/.test(head), sh = this.sh, fs = this.fs, list = [];
    if (first && word.indexOf("/") < 0) {
      list = Object.keys(OS.CMDS).filter(function (n) { return sh.has(n); }).filter(function (n) { return n.indexOf(word) === 0; }).sort();
    } else {
      var slash = word.lastIndexOf("/"), dirPart = slash >= 0 ? word.slice(0, slash + 1) : "", base = word.slice(slash + 1);
      var dir = fs.node(fs.norm(sh.tilde(dirPart) || ".", sh.cwd));
      if (dir instanceof Dir) list = Object.keys(dir.kids).filter(function (k) { return k.indexOf(base) === 0 && (base.charAt(0) === "." || k.charAt(0) !== "."); }).sort().map(function (k) { return dirPart + k + (dir.kids[k] instanceof Dir ? "/" : ""); });
    }
    if (!list.length) return { text: text, list: [] };
    var common = list[0];
    list.forEach(function (x) { while (x.indexOf(common) !== 0) common = common.slice(0, -1); });
    if (list.length === 1) return { text: head + list[0] + (/\/$/.test(list[0]) ? "" : " "), list: [] };
    return { text: head + common, list: common === word ? list.map(function (x) { return x.replace(/^.*\/(?=.)/, ""); }) : [] };
  };

  /* ======================================================= SHELL: PARSE */

  var RESERVED = /^(if|then|elif|else|fi|for|in|do|done|while|until)$/;

  function lex(src) {
    var toks = [], i = 0, n = src.length;
    var incomplete = function () { throw { incomplete: true }; };
    function matching(open, close, from) {         /* index just past the matching close */
      var depth = 1, j = from, q = null;
      for (; j < n; j++) {
        var ch = src.charAt(j);
        if (q) { if (ch === q) q = null; else if (ch === "\\" && q === '"') j++; continue; }
        if (ch === "'" || ch === '"') { q = ch; continue; }
        if (src.substr(j, open.length) === open && open !== close) { depth++; j += open.length - 1; continue; }
        if (src.substr(j, close.length) === close) { depth--; if (!depth) return j; j += close.length - 1; }
      }
      incomplete();
    }
    function dollar(parts, q) {                    /* at src[i] === "$" followed by "(" */
      if (src.substr(i, 3) === "$((") { var e = matching("((", "))", i + 3); parts.push({ arith: src.slice(i + 3, e), q: q }); i = e + 2; }
      else { var e2 = matching("(", ")", i + 2); parts.push({ sub: src.slice(i + 2, e2), q: q }); i = e2 + 1; }
    }
    while (i < n) {
      var ch = src.charAt(i);
      if (ch === " " || ch === "\t") { i++; continue; }
      if (ch === "\\" && src.charAt(i + 1) === "\n") { i += 2; continue; }
      if (ch === "\n") { toks.push({ op: "\n" }); i++; continue; }
      if (ch === "#") { while (i < n && src.charAt(i) !== "\n") i++; continue; }
      var m = /^(&&|\|\||;;|2>&1|2>>|2>|&>|>>|>|<|\||&|;)/.exec(src.substr(i, 4));
      if (m && !(m[1].charAt(0) === "2" && i > 0 && !/[\s;|&]/.test(src.charAt(i - 1)))) { toks.push({ op: m[1] }); i += m[1].length; continue; }
      if (src.substr(i, 2) === "((") { var e = matching("((", "))", i + 2); toks.push({ word: [{ arithCmd: src.slice(i + 2, e) }] }); i = e + 2; continue; }
      var parts = [], add = function (s, q) { var last = parts[parts.length - 1]; if (last && last.s != null && last.q === q) last.s += s; else parts.push({ s: s, q: q }); };
      while (i < n) {
        ch = src.charAt(i);
        if (/[\s;|&<>]/.test(ch)) break;
        if (ch === "'") { var j = src.indexOf("'", i + 1); if (j < 0) incomplete(); add(src.slice(i + 1, j), 1); i = j + 1; continue; }
        if (ch === '"') {
          i++; add("", 2);
          for (;;) {
            if (i >= n) incomplete();
            ch = src.charAt(i);
            if (ch === '"') { i++; break; }
            if (ch === "\\" && /["\\$`\n]/.test(src.charAt(i + 1))) { if (src.charAt(i + 1) !== "\n") add(src.charAt(i + 1), 1); i += 2; continue; }
            if (ch === "$" && src.charAt(i + 1) === "(") { dollar(parts, 2); continue; }
            if (ch === "`") { var b = src.indexOf("`", i + 1); if (b < 0) incomplete(); parts.push({ sub: src.slice(i + 1, b), q: 2 }); i = b + 1; continue; }
            add(ch, 2); i++;
          }
          continue;
        }
        if (ch === "\\") { if (i + 1 >= n) incomplete(); add(src.charAt(i + 1), 1); i += 2; continue; }
        if (ch === "$" && src.charAt(i + 1) === "(") { dollar(parts, 0); continue; }
        if (ch === "`") { var b2 = src.indexOf("`", i + 1); if (b2 < 0) incomplete(); parts.push({ sub: src.slice(i + 1, b2), q: 0 }); i = b2 + 1; continue; }
        add(ch, 0); i++;
      }
      toks.push({ word: parts });
    }
    return toks;
  }
  function plainWord(t) { return t && t.word && t.word.length === 1 && t.word[0].q === 0 && t.word[0].s != null ? t.word[0].s : null; }

  /* text -> {t:"list", items:[{node, bg}]}. Throws {incomplete} when more
   * lines are needed, {syntax} when no amount of typing will fix it. */
  OS.parse = function (src) {
    var toks = lex(src), i = 0;
    var peek = function () { return toks[i]; };
    var isOp = function (v) { return toks[i] && toks[i].op === v; };
    var kw = function () { var w = plainWord(toks[i]); return w && RESERVED.test(w) ? w : null; };
    var fail = function () { var t = toks[i]; if (!t) throw { incomplete: true }; throw { syntax: "syntax error near unexpected token `" + (t.op ? (t.op === "\n" ? "newline" : t.op) : plainWord(t) || "word") + "'" }; };
    var want = function (word) { skipNl(); if (kw() !== word) fail(); i++; };
    function skipNl() { while (isOp("\n")) i++; }
    function list(stops) {
      var items = [];
      for (;;) {
        while (isOp("\n") || isOp(";")) i++;
        if (!peek()) break;
        var k = kw();
        if (k && stops && stops.indexOf(k) >= 0) break;
        if (k && /^(then|elif|else|fi|do|done|in)$/.test(k)) fail();
        var node = andor(), bg = false;
        if (isOp("&")) { bg = true; i++; }
        else if (isOp(";") || isOp("\n")) i++;
        else if (peek() && !(kw() && stops && stops.indexOf(kw()) >= 0)) fail();
        items.push({ node: node, bg: bg });
      }
      return { t: "list", items: items };
    }
    function andor() {
      var first = pipeline(), rest = [];
      while (isOp("&&") || isOp("||")) { var op = toks[i++].op; skipNl(); if (!peek()) throw { incomplete: true }; rest.push([op, pipeline()]); }
      return rest.length ? { t: "andor", first: first, rest: rest } : first;
    }
    function pipeline() {
      var neg = false;
      if (plainWord(peek()) === "!") { neg = true; i++; }
      var cmds = [command()];
      while (isOp("|")) { i++; skipNl(); if (!peek()) throw { incomplete: true }; cmds.push(command()); }
      return cmds.length > 1 || neg ? { t: "pipe", cmds: cmds, neg: neg } : cmds[0];
    }
    function command() {
      var k = kw();
      if (k === "if") {
        i++; var node = { t: "if", clauses: [], orelse: null };
        for (;;) {
          var cond = list(["then"]); want("then");
          var body = list(["elif", "else", "fi"]);
          node.clauses.push([cond, body]);
          skipNl();
          var nx = kw();
          if (!peek()) throw { incomplete: true };
          if (nx === "elif") { i++; continue; }
          if (nx === "else") { i++; node.orelse = list(["fi"]); }
          want("fi");
          break;
        }
        return redirs(node);
      }
      if (k === "while" || k === "until") {
        i++; var w = { t: "while", until: k === "until", cond: list(["do"]) };
        want("do"); w.body = list(["done"]); want("done");
        return redirs(w);
      }
      if (k === "for") {
        i++; var name = plainWord(peek());
        if (!peek()) throw { incomplete: true };
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) fail();
        i++;
        var f = { t: "for", name: name, words: null };
        if (kw() === "in") { i++; f.words = []; while (peek() && peek().word) f.words.push(toks[i++].word); }
        if (isOp(";")) i++;
        want("do"); f.body = list(["done"]); want("done");
        return redirs(f);
      }
      if (k) fail();
      var cmd = { t: "cmd", assigns: [], words: [], redirs: [] };
      for (;;) {
        var t = peek();
        if (!t) break;
        if (t.op) {
          if (/^(>|>>|<|2>|2>>|&>)$/.test(t.op)) { i++; if (!peek()) throw { syntax: "syntax error near unexpected token `newline'" }; if (!peek().word) fail(); cmd.redirs.push({ op: t.op, word: toks[i++].word }); continue; }
          if (t.op === "2>&1") { i++; cmd.redirs.push({ op: "2>&1" }); continue; }
          break;
        }
        var p0 = t.word[0], am = !cmd.words.length && p0 && p0.q === 0 && p0.s != null ? /^([A-Za-z_]\w*)=/.exec(p0.s) : null;
        if (am) { cmd.assigns.push([am[1], [{ s: p0.s.slice(am[0].length), q: 0 }].concat(t.word.slice(1))]); i++; continue; }
        cmd.words.push(t.word); i++;
      }
      if (!cmd.words.length && !cmd.assigns.length && !cmd.redirs.length) fail();
      return cmd;
    }
    function redirs(node) {
      node.redirs = [];
      while (peek() && peek().op && /^(>|>>|<|2>|2>>|&>)$/.test(peek().op)) { var op = toks[i++].op; if (!peek() || !peek().word) fail(); node.redirs.push({ op: op, word: toks[i++].word }); }
      return node;
    }
    var tree = list(null);
    if (i < toks.length) fail();
    return tree;
  };

  /* $(( … )): whole-number arithmetic, as in bash. */
  OS.arith = function (expr, vars) {
    var toks = expr.match(/\d+|[A-Za-z_]\w*|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||\+\+|--|[-+*\/%()<>!~&|^=?:,]|\$\w+|\S/g) || [], i = 0;
    var bad = function (t) { throw { arith: "syntax error in expression (error token is \"" + (t || "") + "\")" }; };
    var val = function (name) { var v = vars[name.replace(/^\$/, "")]; return /^-?\d+$/.test(v || "") ? +v : 0; };
    var LV = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", "<=", ">", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
    function bin(lv) {
      if (lv === LV.length) return unary();
      var a = bin(lv + 1);
      while (LV[lv].indexOf(toks[i]) >= 0) {
        var op = toks[i++], b = bin(lv + 1);
        if ((op === "/" || op === "%") && b === 0) throw { arith: "division by 0 (error token is \"" + b + "\")" };
        switch (op) {
          case "||": a = a || b ? 1 : 0; break; case "&&": a = a && b ? 1 : 0; break;
          case "|": a = a | b; break; case "^": a = a ^ b; break; case "&": a = a & b; break;
          case "==": a = a === b ? 1 : 0; break; case "!=": a = a !== b ? 1 : 0; break;
          case "<": a = a < b ? 1 : 0; break; case "<=": a = a <= b ? 1 : 0; break; case ">": a = a > b ? 1 : 0; break; case ">=": a = a >= b ? 1 : 0; break;
          case "<<": a = a << b; break; case ">>": a = a >> b; break;
          case "+": a = a + b; break; case "-": a = a - b; break; case "*": a = a * b; break;
          case "/": a = Math.trunc(a / b); break; case "%": a = a % b; break;
        }
      }
      return a;
    }
    function unary() {
      var t = toks[i++];
      if (t === "-") return -unary();
      if (t === "+") return unary();
      if (t === "!") return unary() ? 0 : 1;
      if (t === "~") return ~unary();
      if (t === "(") { var v = assign(); if (toks[i++] !== ")") bad(toks[i - 1]); return v; }
      if (/^\d+$/.test(t || "")) { if (toks[i] === "**") { i++; return Math.pow(+t, unary()); } return +t; }
      if (/^\$?[A-Za-z_]\w*$/.test(t || "")) {
        var name = t.replace(/^\$/, ""), v2 = val(name);
        if (toks[i] === "++" || toks[i] === "--") { vars[name] = String(v2 + (toks[i++] === "++" ? 1 : -1)); return v2; }
        if (toks[i] === "**") { i++; return Math.pow(v2, unary()); }
        return v2;
      }
      bad(t);
    }
    function assign() {
      if (/^[A-Za-z_]\w*$/.test(toks[i] || "") && (toks[i + 1] === "=" || (/^[-+*\/%]$/.test(toks[i + 1] || "") && toks[i + 2] === "="))) {
        var name = toks[i], op = toks[i + 1] === "=" ? null : toks[i + 1];
        i += op ? 3 : 2;
        var v = assign(), cur = val(name);
        if (op) v = op === "+" ? cur + v : op === "-" ? cur - v : op === "*" ? cur * v : op === "/" ? Math.trunc(cur / v) : cur % v;
        vars[name] = String(v);
        return v;
      }
      var a = bin(0);
      if (toks[i] === "?") { i++; var x = assign(); if (toks[i++] !== ":") bad(":"); var y = assign(); return a ? x : y; }
      return a;
    }
    if (!toks.length) return 0;
    var r = assign();
    while (toks[i] === ",") { i++; r = assign(); }
    if (i < toks.length) bad(toks[i]);
    return r;
  };

  /* ========================================================= SHELL: RUN */

  function Shell(m, user, parent) {
    this.m = m; this.user = user; this.args = []; this.name = "bash";
    this.cwd = parent ? parent.cwd : (user === "root" ? "/root" : m.fs.home());
    this.vars = {};
    if (parent) for (var k in parent.vars) this.vars[k] = parent.vars[k];
    else this.vars = { "?": "0", HOME: this.cwd, USER: user, LOGNAME: user, SHELL: "/bin/bash", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LANG: "en_GB.UTF-8", TERM: "linux", HOSTNAME: m.hostName, PWD: this.cwd };
    this.history = parent ? parent.history : [];
    this.depth = parent ? parent.depth + 1 : 0;
    if (!parent) { var h = m.fs.node(m.fs.home() + "/.bash_history"); if (h) this.history = h.text.split("\n").filter(Boolean); }
  }
  OS.Shell = Shell;
  var S = Shell.prototype;

  S.root = function () { return this.user === "root"; };
  S.home = function () { return this.user === "root" ? "/root" : this.m.fs.home(); };
  S.tilde = function (s) { return s === "~" ? this.home() : s.indexOf("~/") === 0 ? this.home() + s.slice(1) : s; };
  S.abs = function (p) { return this.m.fs.norm(this.tilde(p), this.cwd); };
  S.shown = function (abs) { var h = this.home(); return abs === h ? "~" : abs.indexOf(h + "/") === 0 ? "~" + abs.slice(h.length) : abs; };
  S.ps1 = function () {
    var os = this.m.os, at = this.user + "@" + this.m.hostName, where = this.shown(this.cwd), end = this.root() ? "#" : "$";
    if (os.id === "raspios") return c("1;32", at) + ":" + c("1;34", where) + " " + end + " ";
    if (os.id === "ubuntu") return c("1;32", at) + ":" + c("1;34", where) + end + " ";
    return at + ":" + where + end + " ";
  };
  S.tty = function () { var m = this.m; return { tty: true, stdin: null, out: function (s) { m.write(s); }, err: function (s) { m.write(s); } }; };
  S.remember = function (line) {
    line = line.trim();
    if (!line || this.history[this.history.length - 1] === line) return;
    this.history.push(line.replace(/\n/g, "; "));
    if (this.history.length > 200) this.history.shift();
    this.m.fs.write(this.m.fs.home() + "/.bash_history", this.history.slice(-40).join("\n") + "\n", false, true);
  };
  S.has = function (name) { var d = OS.CMDS[name]; if (name === "python" && !this.m.os.python) return false; return !!d && (!d.pkg || !!this.m.pkgs[d.pkg]) && (!d.only || d.only.indexOf(this.m.os.id) >= 0); };

  S.getVar = function (name) {
    if (name === "RANDOM") return String(Math.floor(Math.random() * 32768));
    if (name === "SECONDS") return String(Math.floor(this.m.uptime()));
    if (name === "PWD") return this.cwd;
    if (name === "HOSTNAME") return this.m.hostName;
    if (name === "$") return "612";
    if (name === "#") return String(this.args.length);
    if (name === "@" || name === "*") return this.args.join(" ");
    if (name === "0") return this.name;
    if (/^\d+$/.test(name)) return this.args[+name - 1] || "";
    return Object.prototype.hasOwnProperty.call(this.vars, name) ? this.vars[name] : "";
  };
  S.subst = function (s) {
    var self = this;
    return s.replace(/\$(\{[^}]*\}|[A-Za-z_]\w*|[?$#@*0-9!])/g, function (all, n) {
      if (n.charAt(0) !== "{") return self.getVar(n);
      n = n.slice(1, -1);
      var m = /^(\w+|[?#@*])(:-|:=|:\+)(.*)$/.exec(n);
      if (m) { var v = self.getVar(m[1]); if (m[2] === ":+") return v ? m[3] : ""; if (!v && m[2] === ":=") self.vars[m[1]] = m[3]; return v || m[3]; }
      if (n.charAt(0) === "#") return String(self.getVar(n.slice(1)).length);
      return self.getVar(n);
    });
  };
  /* One word of the command line -> the strings it stands for. */
  S.expand = function* (word, io, noGlob) {
    var s = "", g = "", wild = false, quoted = false;
    for (var i = 0; i < word.length; i++) {
      var p = word[i], t;
      if (p.arithCmd != null) return [p];
      if (p.q) quoted = true;
      if (p.sub != null) {
        t = (yield* this.capture(p.sub, io)).replace(/\n+$/, "");
        if (p.q === 0) t = t.replace(/\s*\n\s*/g, " ");
      } else if (p.arith != null) {
        try { t = String(OS.arith(this.subst(p.arith), this.vars)); } catch (e) { if (e.arith) throw { fatal: "bash: " + p.arith.trim() + ": " + e.arith }; throw e; }
      } else if (p.q === 1) t = p.s;
      else {
        if (word.length === 1 && (p.s === "$@" || (p.q === 0 && p.s === "$*"))) return this.args.slice();
        t = this.subst(p.s);
        if (p.q === 0 && i === 0) t = this.tilde(t);
      }
      s += t;
      if (p.q === 0 && p.s != null && /[*?]/.test(t)) { wild = true; g += t.replace(/\*/g, "\uE000").replace(/\?/g, "\uE001"); }
      else g += t;
    }
    if (s === "" && !quoted) return [];            /* an unset $VAR on its own is no argument at all */
    if (wild && !noGlob) { var hits = this.m.fs.glob(g, this.cwd); if (hits.length) return hits; }
    return [s];
  };
  S.expand1 = function* (word, io) { return (yield* this.expand(word, io, true)).join(" "); };
  /* $(command): run it, keep what it printed */
  S.capture = function* (src, io) {
    var buf = "", tree;
    try { tree = OS.parse(src); } catch (e) { throw { fatal: "bash: command substitution: " + (e.syntax || "unexpected EOF") }; }
    yield* this.execList(tree, { stdin: io.stdin, out: function (s) { buf += s; if (buf.length > 200000) throw { exit: 141 }; }, err: io.err, proc: io.proc });
    return buf;
  };

  S.execList = function* (list, io) {
    var code = 0, m = this.m;
    for (var i = 0; i < list.items.length; i++) {
      var it = list.items[i];
      if (it.bg) {
        var sub = new Shell(m, this.user, this), text = OS.unparse(it.node), job = { n: (m.jobs.length ? m.jobs[m.jobs.length - 1].n : 0) + 1, cmd: text };
        sub.args = this.args; sub.depth = this.depth;
        var bio = { stdin: "", out: io.out, err: io.err };
        var p = m.spawn(sub.execNode(it.node, bio), text.slice(0, 60), false, { job: job });
        bio.proc = p; job.proc = p; m.jobs.push(job);
        io.out("[" + job.n + "] " + p.pid + "\n");
        this.vars["!"] = String(p.pid);
        code = 0;
        continue;
      }
      try { code = yield* this.execNode(it.node, io); }
      catch (e) { if (e && e.fatal) { io.err(e.fatal + "\n"); code = 1; } else throw e; }
      this.vars["?"] = String(code);
      if (this.exiting != null) return this.exiting;
      if (this.breaking || this.contin) break;        /* break / continue: stop this list, the loop decides the rest */
    }
    return code;
  };

  S.execNode = function* (node, io) {
    var code, i, m = this.m;
    switch (node.t) {
      case "list": return yield* this.execList(node, io);
      case "andor":
        code = yield* this.execNode(node.first, io);
        for (i = 0; i < node.rest.length; i++) {
          this.vars["?"] = String(code);
          if ((node.rest[i][0] === "&&") === (code === 0)) code = yield* this.execNode(node.rest[i][1], io);
        }
        return code;
      case "pipe": {
        var input = io.stdin;
        for (i = 0; i < node.cmds.length; i++) {
          var last = i === node.cmds.length - 1, buf = { s: "" };
          var pio = last ? { tty: io.tty && node.cmds.length === 1, stdin: input, out: io.out, err: io.err, proc: io.proc }
                         : { stdin: input, out: (function (b) { return function (s) { b.s += s; if (b.s.length > 300000) throw { exit: 141 }; }; })(buf), err: io.err, proc: io.proc };
          try { code = yield* this.execNode(node.cmds[i], pio); }
          catch (e) { if (e && e.exit === 141 && !last) code = 141; else throw e; }
          input = buf.s;
        }
        return node.neg ? (code === 0 ? 1 : 0) : code;
      }
      case "if":
        io = yield* this.redirect(node, io); if (!io) return 1;
        for (i = 0; i < node.clauses.length; i++) if ((yield* this.execList(node.clauses[i][0], io)) === 0) return yield* this.execList(node.clauses[i][1], io);
        return node.orelse ? yield* this.execList(node.orelse, io) : 0;
      case "while": {
        io = yield* this.redirect(node, io); if (!io) return 1;
        code = 0;
        for (var guard = 0; ; guard++) {
          var cnd = yield* this.execList(node.cond, io);
          if ((cnd === 0) === node.until) break;
          code = yield* this.execList(node.body, io);
          if (this.exiting != null) return this.exiting;
          this.contin = false;
          if (this.breaking) { this.breaking--; break; }
          yield 0;                 /* a loop with no sleep in it still lets the rest of the Pi run */
        }
        return code;
      }
      case "for": {
        io = yield* this.redirect(node, io); if (!io) return 1;
        var vals = [];
        if (node.words) for (i = 0; i < node.words.length; i++) vals = vals.concat(yield* this.expand(node.words[i], io));
        else vals = this.args.slice();
        code = 0;
        for (i = 0; i < vals.length; i++) {
          this.vars[node.name] = vals[i];
          code = yield* this.execList(node.body, io);
          if (this.exiting != null) return this.exiting;
          this.contin = false;
          if (this.breaking) { this.breaking--; break; }
          yield 0;
        }
        return code;
      }
      case "cmd": return yield* this.execCmd(node, io);
    }
    return 0;
  };

  /* Apply > >> < 2> to an io. Returns the new io, or null if a file couldn't be opened. */
  S.redirect = function* (node, io) {
    if (!node.redirs || !node.redirs.length) return io;
    var out = { tty: io.tty, stdin: io.stdin, out: io.out, err: io.err, proc: io.proc }, fs = this.m.fs, self = this;
    for (var i = 0; i < node.redirs.length; i++) {
      var r = node.redirs[i];
      if (r.op === "2>&1") { out.err = out.out; continue; }
      var name = yield* this.expand1(r.word, io), abs = this.abs(name);
      if (r.op === "<") {
        var n = fs.node(abs);
        if (!n) { io.err("bash: " + name + ": No such file or directory\n"); return null; }
        if (n instanceof Dir) { io.err("bash: " + name + ": Is a directory\n"); return null; }
        out.stdin = fs.readNode(n); out.tty = false;
        continue;
      }
      var append = r.op === ">>" || r.op === "2>>", at = fs.node(abs), isFile = at && !(at instanceof Dir), err = null;
      if (isFile && at.set) err = null;                                   /* a live file such as /sys/class/gpio/…/value */
      else if (append && isFile) err = fs.mayWrite(abs, this.root()) && !at.get ? null : "Permission denied";
      else err = fs.write(abs, "", false, this.root());
      if (err) { io.err("bash: " + name + ": " + err + "\n"); return null; }
      var sink = (function (path, nm, rootUser) {
        var failed = false, dyn = fs.node(path) && fs.node(path).set;
        return function (s) {
          if (failed) return;
          var e = fs.write(path, s, !dyn, rootUser);
          if (e) { failed = true; io.err("bash: " + (dyn ? "echo: write error" : nm) + ": " + e + "\n"); out.failed = true; }
        };
      })(abs, name, this.root());
      if (r.op === "2>" || r.op === "2>>") out.err = sink;
      else { out.out = sink; out.tty = false; if (r.op === "&>") out.err = sink; }
    }
    return out;
  };

  S.execCmd = function* (node, io) {
    var i, m = this.m, argv = [];
    for (i = 0; i < node.words.length; i++) argv = argv.concat(yield* this.expand(node.words[i], io));
    if (argv.length === 1 && argv[0] && argv[0].arithCmd != null) {
      try { return OS.arith(this.subst(argv[0].arithCmd), this.vars) !== 0 ? 0 : 1; }
      catch (e) { if (e.arith) { io.err("bash: ((: " + argv[0].arithCmd.trim() + ": " + e.arith + "\n"); return 1; } throw e; }
    }
    var saved = null;
    for (i = 0; i < node.assigns.length; i++) {
      var v = yield* this.expand1(node.assigns[i][1], io);
      if (argv.length) { saved = saved || {}; saved[node.assigns[i][0]] = this.vars[node.assigns[i][0]]; }
      this.vars[node.assigns[i][0]] = v;
    }
    var rio = yield* this.redirect(node, io);
    if (!rio) return 1;
    if (!argv.length) return 0;
    var code;
    try { code = yield* this.run(argv, rio); }
    finally { if (saved) for (var k in saved) { if (saved[k] === undefined) delete this.vars[k]; else this.vars[k] = saved[k]; } }
    return rio.failed ? 1 : code;
  };

  /* Find the program a command names and run it. */
  S.run = function* (argv, io, asRoot) {
    var name = argv[0], m = this.m, fs = m.fs, def = OS.CMDS[name];
    var ctx = { sh: this, m: m, fs: fs, name: name, args: argv.slice(1), io: io, out: io.out, err: io.err, stdin: io.stdin, tty: !!io.tty, root: !!asRoot || this.root(), os: m.os, proc: io.proc || m.fg };
    ctx.fail = function (msg, code) { io.err(name + ": " + msg + "\n"); return code == null ? 1 : code; };
    /* a line from the keyboard, or false at end of input */
    ctx.readLine = function* () {
      if (ctx.stdin != null) {
        if (ctx.stdin === "") return false;
        var j = ctx.stdin.indexOf("\n"), line = j < 0 ? ctx.stdin : ctx.stdin.slice(0, j);
        ctx.stdin = j < 0 ? "" : ctx.stdin.slice(j + 1);
        return line;
      }
      if (!ctx.proc || ctx.proc !== m.fg) return false;
      m.wantIn = true;
      try { while (!m.stdin.length) yield 0.02; } finally { m.wantIn = false; }
      return m.stdin.shift();
    };
    ctx.readAll = function* () {
      if (ctx.stdin != null) { var s = ctx.stdin; ctx.stdin = ""; return s; }
      var all = "", line;
      while ((line = yield* ctx.readLine()) !== false) all += line + "\n";
      return all;
    };
    if (name.indexOf("/") >= 0) return yield* this.runFile(argv, io, ctx);
    if (!def || !this.has(name)) {
      var pk = def && def.pkg ? def.pkg : OS.SUGGEST[name];
      if (name === "python" && !m.os.python) io.err("Command 'python' not found, did you mean:\n  command 'python3' from deb python3\n  command 'python' from deb python-is-python3\n");
      else if (pk) io.err("Command '" + name + "' not found, but can be installed with:\n" + c("1", "sudo apt install " + pk) + "\n");
      else io.err((m.os.id === "ubuntu" ? "" : "-bash: ") + name + ": command not found\n");
      return 127;
    }
    var r = def.run(ctx);
    if (r && typeof r.next === "function") r = yield* r;
    return typeof r === "number" ? r : 0;
  };

  /* ./script — needs the x bit, and a #! line decides who reads it */
  S.runFile = function* (argv, io, ctx) {
    var fs = this.m.fs, abs = this.abs(argv[0]), n = fs.node(abs);
    if (!n) { io.err("-bash: " + argv[0] + ": No such file or directory\n"); return 127; }
    if (n instanceof Dir) { io.err("-bash: " + argv[0] + ": Is a directory\n"); return 126; }
    if (n.bin) { var nm = abs.split("/").pop(); return yield* this.run([nm].concat(argv.slice(1)), io); }
    if (!n.x) { io.err("-bash: " + argv[0] + ": Permission denied\n"); return 126; }
    var text = fs.readNode(n), bang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(text), interp = bang ? (/env$/.test(bang[1]) ? bang[2] : bang[1].split("/").pop()) : "bash";
    if (/^python/.test(interp || "")) return yield* this.run(["python3", abs].concat(argv.slice(1)), io);
    return yield* this.script(text, argv[0], argv.slice(1), io);
  };
  S.script = function* (text, name, args, io) {
    if (this.depth > 12) { io.err("bash: " + name + ": too many scripts calling each other\n"); return 1; }
    var sub = new Shell(this.m, this.user, this), tree;
    sub.args = args; sub.name = name;
    try { tree = OS.parse(text); } catch (e) { io.err(name + ": " + (e.syntax || "line " + text.split("\n").length + ": syntax error: unexpected end of file") + "\n"); return 2; }
    return yield* sub.execList(tree, io);
  };

  /* A command line back as text, for the jobs table. */
  OS.unparse = function (node) {
    var w = function (word) { return word.map(function (p) { return p.sub != null ? "$(" + p.sub + ")" : p.arith != null ? "$((" + p.arith + "))" : p.arithCmd != null ? "((" + p.arithCmd + "))" : p.q === 1 && /[\s$*?]/.test(p.s) ? "'" + p.s + "'" : p.q === 2 ? '"' + p.s + '"' : p.s; }).join(""); };
    var l = function (list) { return list.items.map(function (it) { return OS.unparse(it.node) + (it.bg ? " &" : ";"); }).join(" ").replace(/;$/, ""); };
    switch (node.t) {
      case "cmd": return node.assigns.map(function (a) { return a[0] + "=" + w(a[1]); }).concat(node.words.map(w)).concat(node.redirs.map(function (r) { return r.op + (r.word ? " " + w(r.word) : ""); })).join(" ");
      case "pipe": return (node.neg ? "! " : "") + node.cmds.map(OS.unparse).join(" | ");
      case "andor": return OS.unparse(node.first) + node.rest.map(function (r) { return " " + r[0] + " " + OS.unparse(r[1]); }).join("");
      case "list": return l(node);
      case "while": return (node.until ? "until " : "while ") + l(node.cond) + "; do " + l(node.body) + "; done";
      case "for": return "for " + node.name + (node.words ? " in " + node.words.map(w).join(" ") : "") + "; do " + l(node.body) + "; done";
      case "if": return node.clauses.map(function (cl, i) { return (i ? "elif " : "if ") + l(cl[0]) + "; then " + l(cl[1]) + "; "; }).join("") + (node.orelse ? "else " + l(node.orelse) + "; " : "") + "fi";
    }
    return "";
  };

  OS.CMDS = {};            /* filled in by lab_pi_cmds.js */
  OS.PACKAGES = {};
  OS.PREINSTALLED = {};
  OS.SUGGEST = {};
  OS.starterSD = function () { return OS.makeSD({}); };
})(typeof window !== "undefined" ? window : globalThis);
