/* Chalk Circuit Lab — the Pi's commands.
 *
 * Everything you can type at the Pi's prompt: the everyday file and text
 * tools, the ones that describe the machine, the GPIO tools a real Pi
 * ships with (pinout, pinctrl, raspi-gpio, gpioset/gpioget, WiringPi's
 * gpio readall), python3, nano, apt — and a few that exist only because a
 * terminal should be fun to explore.
 *
 * A command is {group, help, usage, run(ctx)}. run returns an exit status,
 * or is a generator that yields seconds to sleep (see lab_pi_os.js). ctx
 * carries the arguments, the three streams and the machine:
 *   ctx.args  ctx.out(s)  ctx.err(s)  ctx.stdin  ctx.readLine()  ctx.readAll()
 *   ctx.sh (the shell)  ctx.m (the machine)  ctx.fs  ctx.root  ctx.tty
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab, OS = L.PiOS, Py = L.PiPy, Calc = L.PiCalc;
  var c = OS.c, pad = OS.pad, lpad = OS.lpad, Dir = OS.Dir;
  var CMDS = OS.CMDS;

  function def(names, group, usage, help, run, extra) {
    names.split(" ").forEach(function (n) {
      var d = { name: n, group: group, usage: usage, help: help, run: run };
      if (extra) for (var k in extra) d[k] = extra[k];
      CMDS[n] = d;
    });
  }
  /* -la style flags. bools and vals are strings of letters; --word flags come back whole. */
  function opts(args, bools, vals) {
    var o = {}, rest = [], i = 0;
    for (; i < args.length; i++) {
      var a = args[i];
      if (a === "--") { rest = rest.concat(args.slice(i + 1)); break; }
      if (/^--\w/.test(a)) { var kv = a.slice(2).split("="); o[kv[0]] = kv.length > 1 ? kv.slice(1).join("=") : true; continue; }
      if (/^-[A-Za-z]/.test(a) && !/^-\d/.test(a)) {
        var ok = true, tmp = {};
        for (var j = 1; j < a.length; j++) {
          var ch = a.charAt(j);
          if ((vals || "").indexOf(ch) >= 0) { tmp[ch] = j + 1 < a.length ? a.slice(j + 1) : args[++i]; break; }
          if ((bools || "").indexOf(ch) < 0) { ok = false; break; }
          tmp[ch] = true;
        }
        if (!ok) { o.bad = a; continue; }
        for (var k in tmp) o[k] = tmp[k];
        continue;
      }
      rest.push(a);
    }
    return { o: o, rest: rest };
  }
  function lines(s) { var l = s.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; }
  function human(n) { return n < 1024 ? String(n) : n < 1048576 ? (n / 1024).toFixed(1).replace(/\.0$/, "") + "K" : (n / 1048576).toFixed(1) + "M"; }
  function size(n) { return n instanceof Dir ? 4096 : (n.get ? n.get().length : n.bin ? 35224 + n.mt % 9000 : n.text.length); }
  function owner(ctx, abs) { return ctx.fs.inHome(abs) ? ctx.os.user : "root"; }
  function mtime(n) { var d = new Date(n.mt), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return M[d.getMonth()] + " " + lpad(d.getDate(), 2) + " " + lpad(d.getHours(), 2, "0") + ":" + lpad(d.getMinutes(), 2, "0"); }
  function perms(n, abs, ctx) {
    if (n instanceof Dir) return "drwxr-xr-x";
    if (/^\/sys\/class\/gpio\//.test(abs)) return n.set ? "-rw-rw----" : "-r--r--r--";
    return n.x ? "-rwxr-xr-x" : n.get ? "-r--r--r--" : "-rw-r--r--";
  }
  function paint(name, n, tty) { return !tty ? name : n instanceof Dir ? c("1;34", name) : n.x ? c("1;32", name) : name; }
  /* Read the files named on the command line, or standard input when there are none. */
  function* inputs(ctx, files) {
    var out = [];
    if (!files.length || (files.length === 1 && files[0] === "-")) { out.push({ name: "", text: yield* ctx.readAll() }); return out; }
    for (var i = 0; i < files.length; i++) {
      var n = ctx.fs.node(ctx.sh.abs(files[i]));
      if (!n) { ctx.fail(files[i] + ": No such file or directory"); out.bad = true; continue; }
      if (n instanceof Dir) { ctx.fail(files[i] + ": Is a directory"); out.bad = true; continue; }
      out.push({ name: files[i], text: ctx.fs.readNode(n) });
    }
    return out;
  }
  function date(m) { return new Date(m.wall() * 1000); }

  /* =============================================================== FILES */

  def("ls", "Files", "ls [-l] [-a] [-h] [folder…]", "List what is in a folder. -l shows sizes and dates, -a shows hidden files too.", function (ctx) {
    var p = opts(ctx.args, "lah1RdtrF"), o = p.o, fs = ctx.fs, sh = ctx.sh, targets = p.rest.length ? p.rest : ["."], code = 0, blocks = [];
    if (o.bad) return ctx.fail("invalid option -- '" + o.bad.slice(1) + "'", 2);
    var row = function (name, n, abs) {
      if (!o.l) return paint(name, n, ctx.tty);
      return perms(n, abs, ctx) + " " + (n instanceof Dir ? lpad(2 + Object.keys(n.kids).filter(function (k) { return n.kids[k] instanceof Dir; }).length, 2) : " 1") + " " + pad(owner(ctx, abs), 6) + " " + pad(owner(ctx, abs), 6) + " " + lpad(o.h ? human(size(n)) : size(n), 6) + " " + mtime(n) + " " + paint(name, n, ctx.tty);
    };
    var files = [], dirs = [];
    targets.forEach(function (t) {
      var abs = sh.abs(t), n = fs.node(abs);
      if (!n) { ctx.fail("cannot access '" + t + "': No such file or directory"); code = 2; return; }
      if (n instanceof Dir && !o.d) dirs.push([t, n, abs]); else files.push(row(t, n, abs));
    });
    var show = function (list, plainLens) {
      if (o.l || o["1"] || !ctx.tty) return list.join("\n") + (list.length ? "\n" : "");
      var w = Math.max.apply(null, plainLens.concat([1])) + 2, per = Math.max(1, Math.floor(ctx.m.cols / w)), rows = Math.ceil(list.length / per), s = "";
      for (var r = 0; r < rows; r++) { for (var k = r; k < list.length; k += rows) s += list[k] + new Array(Math.max(1, w - plainLens[k]) + 1).join(" "); s = s.replace(/ +$/, "") + "\n"; }
      return s;
    };
    if (files.length) blocks.push(show(files, files.map(function (f) { return f.replace(/\x1b\[[0-9;]*m/g, "").length; })));
    dirs.forEach(function (d) {
      var names = Object.keys(d[1].kids).filter(function (k) { return o.a || k.charAt(0) !== "."; }).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
      if (o.t) names.sort(function (a, b) { return d[1].kids[b].mt - d[1].kids[a].mt; });
      if (o.r) names.reverse();
      var head = dirs.length + files.length > 1 ? d[0] + ":\n" : "";
      if (o.l) head += "total " + Math.max(4, names.length * 4) + "\n";
      blocks.push(head + show(names.map(function (k) { return row(k, d[1].kids[k], fs.norm(k, d[2])); }), names.map(function (k) { return k.length; })));
    });
    ctx.out(blocks.join("\n"));
    return code;
  });

  def("cd", "Files", "cd [folder]", "Move into a folder. cd on its own goes home, cd .. goes up one, cd - goes back.", function (ctx) {
    var sh = ctx.sh, to = ctx.args[0] == null ? sh.home() : ctx.args[0] === "-" ? (sh.vars.OLDPWD || sh.cwd) : ctx.args[0], abs = sh.abs(to), n = ctx.fs.node(abs);
    if (!n) { ctx.err("-bash: cd: " + to + ": No such file or directory\n"); return 1; }
    if (!(n instanceof Dir)) { ctx.err("-bash: cd: " + to + ": Not a directory\n"); return 1; }
    sh.vars.OLDPWD = sh.cwd; sh.cwd = abs; sh.vars.PWD = abs;
    if (ctx.args[0] === "-") ctx.out(abs + "\n");
    return 0;
  }, { builtin: true });
  def("pwd", "Files", "pwd", "Print the folder you are in.", function (ctx) { ctx.out(ctx.sh.cwd + "\n"); return 0; }, { builtin: true });

  def("cat", "Files", "cat [-n] [file…]", "Print a file. With no file it repeats what you type until Ctrl+D.", function* (ctx) {
    var p = opts(ctx.args, "n"), ins = yield* inputs(ctx, p.rest), n = 0;
    ins.forEach(function (f) { ctx.out(p.o.n ? lines(f.text).map(function (l) { return lpad(++n, 6) + "\t" + l; }).join("\n") + (f.text ? "\n" : "") : f.text); });
    return ins.bad ? 1 : 0;
  });
  def("less more", "Files", "less file", "Show a file (here it simply prints it, like cat).", function* (ctx) { var ins = yield* inputs(ctx, ctx.args); ins.forEach(function (f) { ctx.out(f.text); }); return ins.bad ? 1 : 0; });

  def("mkdir", "Files", "mkdir [-p] folder…", "Make a new folder.", function (ctx) {
    var p = opts(ctx.args, "pv"), code = 0;
    if (!p.rest.length) return ctx.fail("missing operand");
    p.rest.forEach(function (name) {
      var abs = ctx.sh.abs(name), par = ctx.fs.parent(abs);
      if (ctx.fs.node(abs)) { if (!p.o.p) { ctx.fail("cannot create directory ‘" + name + "’: File exists"); code = 1; } return; }
      if (!(par.dir instanceof Dir) && !p.o.p) { ctx.fail("cannot create directory ‘" + name + "’: No such file or directory"); code = 1; return; }
      if (!ctx.fs.mayWrite(abs, ctx.root)) { ctx.fail("cannot create directory ‘" + name + "’: Permission denied"); code = 1; return; }
      ctx.fs.mkdirp(abs);
      if (ctx.fs.inHome(abs)) ctx.m.changed();
    });
    return code;
  });
  def("touch", "Files", "touch file…", "Make an empty file, or freshen a file's date.", function (ctx) {
    var code = 0;
    if (!ctx.args.length) return ctx.fail("missing file operand");
    ctx.args.forEach(function (name) {
      var abs = ctx.sh.abs(name), n = ctx.fs.node(abs);
      if (n) { n.mt = Date.now(); return; }
      var e = ctx.fs.write(abs, "", false, ctx.root);
      if (e) { ctx.fail("cannot touch '" + name + "': " + e); code = 1; }
    });
    return code;
  });

  function precious(ctx, abs) { var h = ctx.fs.home(); return abs === "/" || h === abs || h.indexOf(abs + "/") === 0; }
  def("rm", "Files", "rm [-r] [-f] file…", "Delete files. -r deletes a folder and everything in it. There is no bin to get them back from.", function* (ctx) {
    var p = opts(ctx.args, "rRfvi"), o = p.o, code = 0, fs = ctx.fs, rec = o.r || o.R;
    if (!p.rest.length) { if (o.f) return 0; return ctx.fail("missing operand"); }
    for (var i = 0; i < p.rest.length; i++) {
      var name = p.rest[i], abs = ctx.sh.abs(name), n = fs.node(abs), par = fs.parent(abs);
      if (!n) { if (!o.f) { ctx.fail("cannot remove '" + name + "': No such file or directory"); code = 1; } continue; }
      if (n instanceof Dir && !rec) { ctx.fail("cannot remove '" + name + "': Is a directory"); code = 1; continue; }
      if (rec && abs === "/" && !o["no-preserve-root"]) { ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); code = 1; continue; }
      if (rec && precious(ctx, abs)) {
        if (ctx.root) return yield* panic(ctx);
        ctx.fail("cannot remove '" + name + "': Permission denied"); code = 1; continue;
      }
      if (!fs.mayWrite(abs, ctx.root) || n.get || (n.bin && !ctx.root)) { ctx.fail("cannot remove '" + name + "': " + (/^\/(proc|sys)/.test(abs) ? "Operation not permitted" : "Permission denied")); code = 1; continue; }
      if (ctx.root && /^\/(usr|bin|sbin|lib|etc|boot|dev|var)(\/|$)/.test(abs) && (n instanceof Dir || n.bin)) return yield* panic(ctx);
      delete par.dir.kids[par.name];
      if (o.v) ctx.out("removed '" + name + "'\n");
      if (fs.inHome(abs)) ctx.m.changed();
    }
    return code;
  });
  /* What happens after "sudo rm -rf /". Nothing is really lost: the lab keeps an image of the card. */
  function* panic(ctx) {
    var m = ctx.m, k = function (s) { return c("2", "[" + lpad(m.uptime().toFixed(6), 12) + "] ") + s + "\n"; };
    var gone = ["/usr/bin/ls", "/usr/bin/python3", "/usr/lib/aarch64-linux-gnu/libc.so.6", "/etc/passwd", "/boot/firmware/kernel8.img", "/usr/bin/bash", "/sbin/init"];
    for (var i = 0; i < gone.length; i++) { ctx.out("removed '" + gone[i] + "'\n"); yield 0.12; }
    ctx.out("-bash: /usr/bin/rm: No such file or directory\n");
    yield 0.5;
    ctx.out(k("systemd[1]: Caught <SEGV>, core dump failed (child 1021, code=killed, status=11/SEGV)."));
    ctx.out(k(c("1;31", "Kernel panic - not syncing: Attempted to kill init! exitcode=0x0000000b")));
    ctx.out(k("CPU: 2 PID: 1 Comm: systemd Not tainted " + m.os.kernel + " #1"));
    ctx.out(k("Hardware name: " + OS.MODEL + " (DT)"));
    ctx.out(k("---[ end Kernel panic - not syncing: Attempted to kill init! ]---"));
    yield 0.6;
    ctx.out("\n" + c("1;33", "You deleted the operating system.") + " On a real Pi you would now be re-flashing the SD card.\n" + c("2", "The lab keeps a backup image of this card: switch the power off and on and it will be restored, your files included.") + "\n");
    m.panicked = true;
    m.killAll(); m.fg = null; m.raw = false; m.wantIn = false;
    if (m.gpio.resetAll) m.gpio.resetAll();
    m.state = "halted"; m.haltT = m.t; m.crashed = true;
    return 137;
  }
  def("rmdir", "Files", "rmdir folder…", "Delete an empty folder.", function (ctx) {
    var code = 0;
    ctx.args.forEach(function (name) {
      var abs = ctx.sh.abs(name), n = ctx.fs.node(abs), par = ctx.fs.parent(abs);
      if (!n) { ctx.fail("failed to remove '" + name + "': No such file or directory"); code = 1; }
      else if (!(n instanceof Dir)) { ctx.fail("failed to remove '" + name + "': Not a directory"); code = 1; }
      else if (Object.keys(n.kids).length) { ctx.fail("failed to remove '" + name + "': Directory not empty"); code = 1; }
      else if (!ctx.fs.mayWrite(abs, ctx.root) || precious(ctx, abs)) { ctx.fail("failed to remove '" + name + "': Permission denied"); code = 1; }
      else { delete par.dir.kids[par.name]; if (ctx.fs.inHome(abs)) ctx.m.changed(); }
    });
    return code;
  });

  function clone(n) {
    if (n instanceof Dir) { var d = new Dir(); Object.keys(n.kids).forEach(function (k) { d.kids[k] = clone(n.kids[k]); }); return d; }
    return new OS.File(n.get ? n.get() : n.text, n.x ? { x: true } : null);
  }
  function weigh(n) { if (!(n instanceof Dir)) return (n.get ? n.get() : n.text).length; return Object.keys(n.kids).reduce(function (t, k) { return t + weigh(n.kids[k]) + 8; }, 0); }
  function copyMove(move) {
    return function (ctx) {
      var p = opts(ctx.args, "rRfvai"), fs = ctx.fs, nm = move ? "mv" : "cp", code = 0;
      if (p.rest.length < 2) return ctx.fail(p.rest.length ? "missing destination file operand after '" + p.rest[0] + "'" : "missing file operand");
      var dest = p.rest[p.rest.length - 1], dabs = ctx.sh.abs(dest), dn = fs.node(dabs), srcs = p.rest.slice(0, -1);
      if (srcs.length > 1 && !(dn instanceof Dir)) return ctx.fail("target '" + dest + "' is not a directory");
      srcs.forEach(function (name) {
        var abs = ctx.sh.abs(name), n = fs.node(abs);
        if (!n) { ctx.fail("cannot stat '" + name + "': No such file or directory"); code = 1; return; }
        if (n instanceof Dir && !move && !(p.o.r || p.o.R || p.o.a)) { ctx.err("cp: -r not specified; omitting directory '" + name + "'\n"); code = 1; return; }
        var to = dn instanceof Dir ? fs.norm(abs.split("/").pop(), dabs) : dabs, tp = fs.parent(to);
        if (!(tp.dir instanceof Dir)) { ctx.fail("cannot " + (move ? "move" : "create regular file") + " '" + dest + "': No such file or directory"); code = 1; return; }
        if (to === abs) { ctx.fail("'" + name + "' and '" + dest + "' are the same file"); code = 1; return; }
        if (to.indexOf(abs + "/") === 0) { ctx.fail("cannot " + (move ? "move" : "copy") + " a directory, '" + name + "', into itself, '" + dest + "'"); code = 1; return; }
        if (!fs.mayWrite(to, ctx.root) || (move && (!fs.mayWrite(abs, ctx.root) || n.get || n.bin || precious(ctx, abs)))) { ctx.fail("cannot " + (move ? "move '" + name + "' to '" + dest + "'" : "create regular file '" + dest + "'") + ": Permission denied"); code = 1; return; }
        if (!move && fs.inHome(to) && fs.used() + weigh(n) > OS.SD_LIMIT) { ctx.fail("error writing '" + dest + "': No space left on device"); code = 1; return; }
        tp.dir.kids[tp.name] = move ? n : clone(n);
        if (move) { var sp = fs.parent(abs); delete sp.dir.kids[sp.name]; }
        if (fs.inHome(to) || fs.inHome(abs)) ctx.m.changed();
      });
      return code;
    };
  }
  def("cp", "Files", "cp [-r] from… to", "Copy a file. -r copies a whole folder.", copyMove(false));
  def("mv", "Files", "mv from… to", "Move a file, or give it a new name.", copyMove(true));

  def("chmod", "Files", "chmod +x file", "Change who may run or change a file. chmod +x makes a script runnable as ./script.", function (ctx) {
    var mode = ctx.args[0], code = 0;
    if (ctx.args.length < 2) return ctx.fail(mode ? "missing operand after ‘" + mode + "’" : "missing operand");
    var m = /^([ugoa]*)([-+=])([rwx]+)$/.exec(mode), oct = /^[0-7]{3,4}$/.test(mode);
    if (!m && !oct) return ctx.fail("invalid mode: ‘" + mode + "’");
    ctx.args.slice(1).forEach(function (name) {
      var abs = ctx.sh.abs(name), n = ctx.fs.node(abs);
      if (!n) { ctx.fail("cannot access '" + name + "': No such file or directory"); code = 1; return; }
      if (!ctx.fs.mayWrite(abs, ctx.root) || n.get) { ctx.fail("changing permissions of '" + name + "': Operation not permitted"); code = 1; return; }
      if (n instanceof Dir) return;
      if (oct) n.x = !!(parseInt(mode.slice(-3, -2), 8) & 1);
      else if (m[3].indexOf("x") >= 0) n.x = m[2] !== "-";
      if (ctx.fs.inHome(abs)) ctx.m.changed();
    });
    return code;
  });

  def("tree", "Files", "tree [folder]", "Draw a folder and everything inside it as a tree.", function (ctx) {
    var p = opts(ctx.args, "a"), start = p.rest[0] || ".", n = ctx.fs.node(ctx.sh.abs(start)), dirs = 0, files = 0, out = "";
    if (!(n instanceof Dir)) { ctx.out(start + "  [error opening dir]\n\n0 directories, 0 files\n"); return 2; }
    out += paint(start, n, ctx.tty) + "\n";
    (function walk(d, prefix) {
      var names = Object.keys(d.kids).filter(function (k) { return p.o.a || k.charAt(0) !== "."; }).sort();
      names.forEach(function (k, i) {
        var kid = d.kids[k], last = i === names.length - 1;
        out += prefix + (last ? "└── " : "├── ") + paint(k, kid, ctx.tty) + "\n";
        if (kid instanceof Dir) { dirs++; if (dirs < 400) walk(kid, prefix + (last ? "    " : "│   ")); } else files++;
      });
    })(n, "");
    ctx.out(out + "\n" + dirs + " director" + (dirs === 1 ? "y" : "ies") + ", " + files + " file" + (files === 1 ? "" : "s") + "\n");
    return 0;
  });
  def("find", "Files", "find [folder] [-name pattern] [-type f|d]", "Look for files by name, in a folder and every folder below it.", function (ctx) {
    var a = ctx.args.slice(), start = a.length && a[0].charAt(0) !== "-" ? a.shift() : ".", name = null, type = null;
    for (var i = 0; i < a.length; i++) { if (a[i] === "-name" || a[i] === "-iname") name = new RegExp("^" + a[++i].replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", a[i - 1] === "-iname" ? "i" : ""); else if (a[i] === "-type") type = a[++i]; else return ctx.fail("unknown predicate `" + a[i] + "'"); }
    var n = ctx.fs.node(ctx.sh.abs(start));
    if (!n) return ctx.fail("‘" + start + "’: No such file or directory");
    (function walk(node, shown, depth) {
      var isDir = node instanceof Dir, base = shown.split("/").pop();
      if ((!name || name.test(base)) && (!type || (type === "d") === isDir)) ctx.out(shown + "\n");
      if (isDir && depth < 12) Object.keys(node.kids).sort().forEach(function (k) { walk(node.kids[k], shown.replace(/\/$/, "") + "/" + k, depth + 1); });
    })(n, start, 0);
    return 0;
  });
  def("file", "Files", "file name…", "Say what kind of thing a file is.", function (ctx) {
    ctx.args.forEach(function (name) {
      var n = ctx.fs.node(ctx.sh.abs(name)), t;
      if (!n) t = "cannot open `" + name + "' (No such file or directory)";
      else if (n instanceof Dir) t = "directory";
      else if (n.bin) t = "ELF 64-bit LSB pie executable, ARM aarch64, version 1 (SYSV), dynamically linked, for GNU/Linux 3.7.0, stripped";
      else { var s = ctx.fs.readNode(n); t = !s ? "empty" : /^#!.*python/.test(s) || /\.py$/.test(name) ? "Python script, ASCII text executable" : /^#!.*sh/.test(s) ? "Bourne-Again shell script, ASCII text executable" : /[^\x00-\x7f]/.test(s) ? "Unicode text, UTF-8 text" : "ASCII text"; }
      ctx.out(name + ": " + t + "\n");
    });
    return 0;
  });
  def("du", "Files", "du [-h] [folder]", "How much space a folder takes.", function (ctx) {
    var p = opts(ctx.args, "hsa"), start = p.rest[0] || ".", n = ctx.fs.node(ctx.sh.abs(start));
    if (!n) return ctx.fail("cannot access '" + start + "': No such file or directory");
    var kb = Math.max(4, Math.ceil(weigh(n) / 1024) * 4);
    ctx.out((p.o.h ? kb + "K" : kb) + "\t" + start + "\n");
    return 0;
  });
  def("df", "System", "df [-h]", "How full the SD card is.", function (ctx) {
    var h = opts(ctx.args, "hT").o.h, used = ctx.fs.used(), pct = Math.round(used / OS.SD_LIMIT * 100);
    ctx.out("Filesystem      " + (h ? " Size  Used Avail Use%" : "1K-blocks    Used Available Use%") + " Mounted on\n" +
      (h ? "/dev/root        29G  3.3G   25G  12% /\ntmpfs           1.9G     0  1.9G   0% /dev/shm\n/dev/mmcblk0p1  510M   76M  435M  15% /boot/firmware\n"
         : "/dev/root       30298048 3418204  25610432  12% /\ntmpfs            1942200       0   1942200   0% /dev/shm\n/dev/mmcblk0p1    522230   77406    444824  15% /boot/firmware\n") +
      pad("chalk-sd", 15) + (h ? lpad(human(OS.SD_LIMIT), 5) + lpad(human(used), 6) + lpad(human(OS.SD_LIMIT - used), 6) : lpad(Math.round(OS.SD_LIMIT / 1024), 10) + lpad(Math.round(used / 1024), 8) + lpad(Math.round((OS.SD_LIMIT - used) / 1024), 10)) + lpad(pct + "%", 5) + " " + ctx.fs.home() + "\n");
    if (ctx.tty) ctx.out(c("2", "The last line is the part of the card the lab saves with your circuit: your home folder.") + "\n");
    return 0;
  });

  /* ================================================================ TEXT */

  def("echo", "Text", "echo [-n] [-e] words…", "Print its arguments. echo hi > file writes them into a file; >> adds to the end.", function (ctx) {
    var a = ctx.args.slice(), nl = true, esc = false;
    while (a.length && /^-[neE]+$/.test(a[0])) { var f = a.shift(); if (f.indexOf("n") >= 0) nl = false; if (f.indexOf("e") >= 0) esc = true; }
    var s = a.join(" ");
    if (esc) s = unescape(s);
    ctx.out(s + (nl ? "\n" : ""));
    return 0;
  }, { builtin: true });
  function unescape(s) { return s.replace(/\\(n|t|r|e|a|\\|0[0-7]{0,3}|x[0-9a-fA-F]{1,2}|033)/g, function (all, k) { return k === "n" ? "\n" : k === "t" ? "\t" : k === "r" ? "\r" : k === "e" || k === "033" ? "\x1b" : k === "a" ? "\x07" : k === "\\" ? "\\" : k.charAt(0) === "x" ? String.fromCharCode(parseInt(k.slice(1), 16)) : String.fromCharCode(parseInt(k, 8) || 0); }); }
  def("printf", "Text", "printf format [values…]", "Print with a format: printf \"%s is %d\\n\" Ada 12", function (ctx) {
    if (!ctx.args.length) return ctx.fail("usage: printf [-v var] format [arguments]", 2);
    var fmt = unescape(ctx.args[0]), vals = ctx.args.slice(1), i = 0, out = "";
    do {
      out += fmt.replace(/%(-?)(0?)(\d*)(?:\.(\d+))?([sdifxXc%])/g, function (all, left, zero, w, prec, ty) {
        if (ty === "%") return "%";
        var v = i < vals.length ? vals[i++] : (ty === "s" || ty === "c" ? "" : "0"), s;
        if (ty === "s") s = prec ? v.slice(0, +prec) : v; else if (ty === "c") s = v.charAt(0);
        else if (ty === "f") s = (parseFloat(v) || 0).toFixed(prec ? +prec : 6); else if (ty === "x" || ty === "X") { s = (parseInt(v, 10) || 0).toString(16); if (ty === "X") s = s.toUpperCase(); }
        else s = String(parseInt(v, 10) || 0);
        while (s.length < +w) s = left ? s + " " : (zero && ty !== "s" ? "0" : " ") + s;
        return s;
      });
    } while (i < vals.length && /%[^%]/.test(fmt));
    ctx.out(out);
    return 0;
  }, { builtin: true });

  function headTail(tail) {
    return function* (ctx) {
      var a = ctx.args.slice(), n = 10, files = [];
      for (var i = 0; i < a.length; i++) { var m; if (a[i] === "-n") n = parseInt(a[++i], 10); else if ((m = /^-n?(\d+)$/.exec(a[i]))) n = +m[1]; else if (a[i] === "-f") { /* follow: not here */ } else files.push(a[i]); }
      if (!(n >= 0)) return ctx.fail("invalid number of lines");
      var ins = yield* inputs(ctx, files);
      ins.forEach(function (f, k) {
        var l = lines(f.text);
        if (ins.length > 1) ctx.out((k ? "\n" : "") + "==> " + f.name + " <==\n");
        l = tail ? l.slice(Math.max(0, l.length - n)) : l.slice(0, n);
        ctx.out(l.join("\n") + (l.length ? "\n" : ""));
      });
      return ins.bad ? 1 : 0;
    };
  }
  def("head", "Text", "head [-n N] [file]", "The first lines of a file (10 unless you say).", headTail(false));
  def("tail", "Text", "tail [-n N] [file]", "The last lines of a file.", headTail(true));
  def("wc", "Text", "wc [-l] [-w] [-c] [file…]", "Count lines, words and characters.", function* (ctx) {
    var p = opts(ctx.args, "lwcm"), o = p.o, ins = yield* inputs(ctx, p.rest), all = !o.l && !o.w && !o.c && !o.m, tot = [0, 0, 0];
    var fmt = function (v, name) { var cols = []; if (all || o.l) cols.push(v[0]); if (all || o.w) cols.push(v[1]); if (all || o.c || o.m) cols.push(v[2]); return (cols.length === 1 && !name ? String(cols[0]) : cols.map(function (x) { return lpad(x, cols.length > 1 || name ? (ins.length > 1 ? 7 : String(x).length + 1) : 0); }).join("").replace(/^ /, ins.length > 1 ? " " : "")) + (name ? " " + name : "") + "\n"; };
    ins.forEach(function (f) { var v = [(f.text.match(/\n/g) || []).length, (f.text.match(/\S+/g) || []).length, f.text.length]; tot = tot.map(function (t, i) { return t + v[i]; }); ctx.out(fmt(v, f.name)); });
    if (ins.length > 1) ctx.out(fmt(tot, "total"));
    return ins.bad ? 1 : 0;
  });
  def("grep", "Text", "grep [-i] [-v] [-n] [-c] pattern [file…]", "Show only the lines that contain a pattern.", function* (ctx) {
    var p = opts(ctx.args, "ivncrqEFow"), o = p.o;
    if (!p.rest.length) { ctx.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n"); return 2; }
    var pat = p.rest[0], re;
    try { re = new RegExp(o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : o.E ? pat : pat.replace(/\\([|()+?{}])/g, "\u0000$1").replace(/[|()+?{}]/g, "\\$&").replace(/\u0000/g, ""), o.i ? "i" : ""); }
    catch (e) { return ctx.fail("Unmatched [, [^, [:, [., or [=", 2); }
    if (o.w) re = new RegExp("\\b(?:" + re.source + ")\\b", re.flags);
    var ins = yield* inputs(ctx, p.rest.slice(1)), hit = false;
    ins.forEach(function (f) {
      var count = 0;
      lines(f.text).forEach(function (l, i) {
        if (re.test(l) === !!o.v) return;
        count++; hit = true;
        if (o.c || o.q) return;
        var shown = ctx.tty && !o.v ? l.replace(new RegExp(re.source, re.flags + "g"), function (x) { return x ? c("1;31", x) : x; }) : l;
        ctx.out((ins.length > 1 ? (ctx.tty ? c("35", f.name) + c("36", ":") : f.name + ":") : "") + (o.n ? (ctx.tty ? c("32", i + 1) + c("36", ":") : (i + 1) + ":") : "") + shown + "\n");
      });
      if (o.c) ctx.out((ins.length > 1 ? f.name + ":" : "") + count + "\n");
    });
    return ins.bad ? 2 : hit ? 0 : 1;
  });
  def("sort", "Text", "sort [-n] [-r] [-u] [file]", "Put lines in order. -n by number, -r backwards.", function* (ctx) {
    var p = opts(ctx.args, "nruf"), ins = yield* inputs(ctx, p.rest), l = [];
    ins.forEach(function (f) { l = l.concat(lines(f.text)); });
    l.sort(p.o.n ? function (a, b) { return (parseFloat(a) || 0) - (parseFloat(b) || 0); } : function (a, b) { var x = p.o.f ? a.toLowerCase() : a, y = p.o.f ? b.toLowerCase() : b; return x < y ? -1 : x > y ? 1 : 0; });
    if (p.o.r) l.reverse();
    if (p.o.u) l = l.filter(function (x, i) { return !i || x !== l[i - 1]; });
    ctx.out(l.join("\n") + (l.length ? "\n" : ""));
    return ins.bad ? 2 : 0;
  });
  def("uniq", "Text", "uniq [-c] [file]", "Drop lines that repeat the line before. -c counts them.", function* (ctx) {
    var p = opts(ctx.args, "cdu"), ins = yield* inputs(ctx, p.rest.slice(0, 1)), out = [];
    lines(ins.length ? ins[0].text : "").forEach(function (l) { var last = out[out.length - 1]; if (last && last[0] === l) last[1]++; else out.push([l, 1]); });
    ctx.out(out.map(function (x) { return (p.o.c ? lpad(x[1], 7) + " " : "") + x[0] + "\n"; }).join(""));
    return 0;
  });
  def("cut", "Text", "cut -d, -f2 [file]", "Pick columns out of each line: -d is the separator, -f which fields.", function* (ctx) {
    var p = opts(ctx.args, "", "dfc"), d = p.o.d == null ? "\t" : p.o.d, spec = p.o.f || p.o.c;
    if (!spec) return ctx.fail("you must specify a list of bytes, characters, or fields");
    var want = [];
    spec.split(",").forEach(function (r) { var m = /^(\d*)-?(\d*)$/.exec(r), a = +(m[1] || 1), b = r.indexOf("-") < 0 ? a : +(m[2] || 999); for (var i = a; i <= Math.min(b, 999); i++) want.push(i); });
    var ins = yield* inputs(ctx, p.rest);
    ins.forEach(function (f) { lines(f.text).forEach(function (l) { var parts = p.o.c ? l.split("") : l.split(d); ctx.out((p.o.c || parts.length > 1 ? want.filter(function (i) { return i <= parts.length; }).map(function (i) { return parts[i - 1]; }).join(p.o.c ? "" : d) : l) + "\n"); }); });
    return 0;
  });
  def("tr", "Text", "tr a-z A-Z", "Swap characters: reads what is piped in, writes it changed. -d deletes.", function* (ctx) {
    var p = opts(ctx.args, "ds"), set = function (s) { return unescape(s || "").replace(/(.)-(.)/g, function (all, a, b) { var o = ""; for (var i = a.charCodeAt(0); i <= b.charCodeAt(0); i++) o += String.fromCharCode(i); return o; }).replace("[:upper:]", "ABCDEFGHIJKLMNOPQRSTUVWXYZ").replace("[:lower:]", "abcdefghijklmnopqrstuvwxyz").replace("[:digit:]", "0123456789").replace("[:space:]", " \t\n"); };
    var a = set(p.rest[0]), b = set(p.rest[1]), text = yield* ctx.readAll();
    if (!p.rest.length) return ctx.fail("missing operand");
    ctx.out(text.split("").map(function (ch) { var i = a.indexOf(ch); return i < 0 ? ch : p.o.d ? "" : b.charAt(Math.min(i, b.length - 1)); }).join(""));
    return 0;
  });
  def("rev", "Text", "rev [file]", "Write each line backwards.", function* (ctx) { var ins = yield* inputs(ctx, ctx.args); ins.forEach(function (f) { ctx.out(lines(f.text).map(function (l) { return l.split("").reverse().join(""); }).join("\n") + (f.text ? "\n" : "")); }); return 0; });
  def("tac", "Text", "tac [file]", "cat, backwards: the last line first.", function* (ctx) { var ins = yield* inputs(ctx, ctx.args); ins.forEach(function (f) { ctx.out(lines(f.text).reverse().join("\n") + (f.text ? "\n" : "")); }); return 0; });
  def("tee", "Text", "tee [-a] file", "Copy what is piped in to a file and to the screen.", function* (ctx) {
    var p = opts(ctx.args, "a"), text = yield* ctx.readAll(), code = 0;
    p.rest.forEach(function (name) { var e = ctx.fs.write(ctx.sh.abs(name), text, !!p.o.a, ctx.root); if (e) { ctx.fail(name + ": " + e); code = 1; } });
    ctx.out(text);
    return code;
  });
  def("seq", "Text", "seq [first] [step] last", "Count: seq 5 prints 1 to 5.", function (ctx) {
    var n = ctx.args.map(Number), a = n.length > 1 ? n[0] : 1, st = n.length > 2 ? n[1] : 1, b = n[n.length - 1], out = "";
    if (!n.length || n.some(isNaN)) return ctx.fail(n.length ? "invalid floating point argument: ‘" + ctx.args[n.findIndex(isNaN)] + "’" : "missing operand");
    if (!st) return ctx.fail("invalid Zero increment value: ‘0’");
    for (var i = a, k = 0; (st > 0 ? i <= b : i >= b) && k < 20000; i += st, k++) out += Math.round(i * 1e6) / 1e6 + "\n";
    ctx.out(out);
    return 0;
  });
  def("yes", "Text", "yes [word]", "Say y for ever (or until Ctrl+C).", function* (ctx) { var w = (ctx.args.join(" ") || "y") + "\n", chunk = new Array(41).join(w); for (;;) { ctx.out(chunk); yield 0.05; } });

  /* =============================================================== SHELL */

  def("sleep", "Shell", "sleep seconds", "Wait. sleep 0.5 waits half a second.", function* (ctx) {
    if (!ctx.args.length) return ctx.fail("missing operand");
    var total = 0;
    for (var i = 0; i < ctx.args.length; i++) { var m = /^(\d*\.?\d+)([smh]?)$/.exec(ctx.args[i]); if (!m) return ctx.fail("invalid time interval ‘" + ctx.args[i] + "’"); total += parseFloat(m[1]) * (m[2] === "m" ? 60 : m[2] === "h" ? 3600 : 1); }
    yield total;
    return 0;
  });
  def("true :", "Shell", "true", "Do nothing, successfully.", function () { return 0; }, { builtin: true });
  def("false", "Shell", "false", "Do nothing, unsuccessfully.", function () { return 1; }, { builtin: true });
  function test(ctx, a) {
    var fs = ctx.fs, sh = ctx.sh, node = function (p) { return fs.node(sh.abs(p)); };
    if (a[0] === "!") return !test(ctx, a.slice(1));
    if (a.length === 0) return false;
    if (a.length === 1) return a[0] !== "";
    if (a.length === 2) {
      var n = a[0] === "-z" || a[0] === "-n" ? null : node(a[1]);
      switch (a[0]) {
        case "-z": return a[1] === ""; case "-n": return a[1] !== "";
        case "-e": return !!n; case "-f": return !!n && !(n instanceof Dir); case "-d": return n instanceof Dir;
        case "-s": return !!n && !(n instanceof Dir) && fs.readNode(n).length > 0; case "-x": return !!n && (n instanceof Dir || !!n.x); case "-r": return !!n; case "-w": return !!n && fs.mayWrite(sh.abs(a[1]), ctx.root);
      }
      throw "unary operator expected";
    }
    if (a.length === 3) {
      var x = a[0], y = a[2], num = function (v) { if (!/^\s*-?\d+\s*$/.test(v)) throw v + ": integer expression expected"; return +v; };
      switch (a[1]) {
        case "=": case "==": return x === y; case "!=": return x !== y; case "<": return x < y; case ">": return x > y;
        case "-eq": return num(x) === num(y); case "-ne": return num(x) !== num(y); case "-lt": return num(x) < num(y); case "-le": return num(x) <= num(y); case "-gt": return num(x) > num(y); case "-ge": return num(x) >= num(y);
      }
      throw "binary operator expected";
    }
    var i = a.indexOf("-a") > 0 ? a.indexOf("-a") : a.indexOf("&&");
    if (i > 0) return test(ctx, a.slice(0, i)) && test(ctx, a.slice(i + 1));
    i = a.indexOf("-o") > 0 ? a.indexOf("-o") : a.indexOf("||");
    if (i > 0) return test(ctx, a.slice(0, i)) || test(ctx, a.slice(i + 1));
    throw "too many arguments";
  }
  def("test [ [[", "Shell", "[ a -eq b ]   [ -f file ]   [ \"$x\" = yes ]", "Ask a yes/no question for if and while: numbers (-eq -ne -lt -gt), words (= !=), files (-f -d -e).", function (ctx) {
    var a = ctx.args.slice(), close = ctx.name === "[" ? "]" : ctx.name === "[[" ? "]]" : null;
    if (close) { if (a[a.length - 1] !== close) { ctx.err("-bash: " + ctx.name + ": missing `" + close + "'\n"); return 2; } a.pop(); }
    try { return test(ctx, a) ? 0 : 1; } catch (e) { if (typeof e === "string") { ctx.err("-bash: " + ctx.name + ": " + e + "\n"); return 2; } throw e; }
  }, { builtin: true });
  def("export", "Shell", "export NAME=value", "Set a variable for this shell and everything it starts.", function (ctx) {
    var sh = ctx.sh;
    if (!ctx.args.length) { Object.keys(sh.vars).sort().forEach(function (k) { if (/^[A-Za-z_]/.test(k)) ctx.out('declare -x ' + k + '="' + sh.vars[k] + '"\n'); }); return 0; }
    ctx.args.forEach(function (a) { var i = a.indexOf("="); if (i > 0) sh.vars[a.slice(0, i)] = a.slice(i + 1); });
    return 0;
  }, { builtin: true });
  def("unset", "Shell", "unset NAME", "Forget a variable.", function (ctx) { ctx.args.forEach(function (a) { delete ctx.sh.vars[a]; }); return 0; }, { builtin: true });
  def("env printenv", "Shell", "env", "Show the shell's variables.", function (ctx) {
    var sh = ctx.sh;
    if (ctx.name === "printenv" && ctx.args.length) { var v = sh.vars[ctx.args[0]]; if (v == null) return 1; ctx.out(v + "\n"); return 0; }
    Object.keys(sh.vars).sort().forEach(function (k) { if (/^[A-Z_][A-Z0-9_]*$/.test(k)) ctx.out(k + "=" + sh.vars[k] + "\n"); });
    return 0;
  });
  def("read", "Shell", "read [-p prompt] NAME", "Wait for a line to be typed and keep it in a variable.", function* (ctx) {
    var p = opts(ctx.args, "rs", "pnt"), names = p.rest.length ? p.rest : ["REPLY"];
    if (p.o.p) ctx.out(p.o.p);
    var line = yield* ctx.readLine();
    if (line === false) return 1;
    var words = names.length > 1 ? line.trim().split(/\s+/) : [line];
    names.forEach(function (n, i) { ctx.sh.vars[n] = i === names.length - 1 ? words.slice(i).join(" ") : (words[i] || ""); });
    return 0;
  }, { builtin: true });
  def("source .", "Shell", "source file", "Run a script's lines in this shell, so its variables stay.", function* (ctx) {
    if (!ctx.args.length) { ctx.err("-bash: " + ctx.name + ": filename argument required\n"); return 2; }
    var n = ctx.fs.node(ctx.sh.abs(ctx.args[0])), tree;
    if (!n || n instanceof Dir) { ctx.err("-bash: " + ctx.args[0] + ": No such file or directory\n"); return 1; }
    try { tree = OS.parse(ctx.fs.readNode(n)); } catch (e) { ctx.err("-bash: " + ctx.args[0] + ": " + (e.syntax || "syntax error: unexpected end of file") + "\n"); return 2; }
    return yield* ctx.sh.execList(tree, ctx.io);
  }, { builtin: true });
  def("bash sh", "Shell", "bash script.sh", "Run a shell script: a file of commands, one per line.", function* (ctx) {
    var a = ctx.args.slice();
    if (a[0] === "--version") { ctx.out("GNU bash, version " + ctx.os.shell.split(" ")[1] + "(1)-release (aarch64-unknown-linux-gnu)\n"); return 0; }
    if (a[0] === "-c") { if (a[1] == null) { ctx.err("bash: -c: option requires an argument\n"); return 2; } return yield* ctx.sh.script(a[1], "bash", a.slice(2), ctx.io); }
    if (!a.length) {
      if (ctx.stdin != null) return yield* ctx.sh.script(yield* ctx.readAll(), "bash", [], ctx.io);
      ctx.err(c("2", "(You are already in bash. To run a script: bash name.sh — or chmod +x name.sh and then ./name.sh)") + "\n"); return 0;
    }
    var n = ctx.fs.node(ctx.sh.abs(a[0]));
    if (!n) { ctx.err(ctx.name + ": " + a[0] + ": No such file or directory\n"); return 127; }
    if (n instanceof Dir) { ctx.err(ctx.name + ": " + a[0] + ": Is a directory\n"); return 126; }
    return yield* ctx.sh.script(ctx.fs.readNode(n), a[0], a.slice(1), ctx.io);
  });
  def("exit logout", "Shell", "exit", "Leave this shell. From a root shell it takes you back to your own.", function (ctx) {
    var n = ctx.args.length ? parseInt(ctx.args[0], 10) || 0 : +ctx.sh.vars["?"] || 0;
    ctx.sh.exiting = n;
    return n;
  }, { builtin: true });
  def("break", "Shell", "break", "Leave the loop you are in.", function (ctx) { ctx.sh.breaking = Math.max(1, parseInt(ctx.args[0], 10) || 1); return 0; }, { builtin: true });
  def("continue", "Shell", "continue", "Skip to the next turn of the loop.", function (ctx) { ctx.sh.contin = true; return 0; }, { builtin: true });
  def("history", "Shell", "history", "The commands you have typed. The up arrow walks back through them.", function (ctx) {
    var h = ctx.sh.history;
    if (ctx.args[0] === "-c") { h.length = 0; ctx.fs.write(ctx.fs.home() + "/.bash_history", "", false, true); return 0; }
    var n = /^\d+$/.test(ctx.args[0] || "") ? +ctx.args[0] : h.length;
    h.slice(-n).forEach(function (l, i) { ctx.out(lpad(h.length - Math.min(n, h.length) + i + 1, 5) + "  " + l + "\n"); });
    return 0;
  }, { builtin: true });
  def("clear reset", "Shell", "clear", "Wipe the screen. Ctrl+L does the same.", function (ctx) { ctx.out("\x1b[2J\x1b[H"); return 0; });
  def("which type command", "Shell", "which name", "Say where a command lives.", function (ctx) {
    var code = 0, a = ctx.args.filter(function (x) { return x.charAt(0) !== "-"; });
    a.forEach(function (n) {
      var d = CMDS[n];
      if (!d || !ctx.sh.has(n)) { if (ctx.name !== "which") ctx.err("-bash: " + ctx.name + ": " + n + ": not found\n"); code = 1; return; }
      ctx.out(ctx.name === "type" ? (d.builtin ? n + " is a shell builtin\n" : n + " is /usr/bin/" + n + "\n") : d.builtin && ctx.name === "which" ? "" : "/usr/bin/" + n + "\n");
      if (d.builtin && ctx.name === "which") code = 1;
    });
    return code;
  }, { builtin: true });
  def("basename", "Shell", "basename path", "The last part of a path.", function (ctx) { var b = (ctx.args[0] || "").replace(/\/+$/, "").split("/").pop(); if (ctx.args[1] && b.slice(-ctx.args[1].length) === ctx.args[1] && b !== ctx.args[1]) b = b.slice(0, -ctx.args[1].length); ctx.out(b + "\n"); return 0; });
  def("dirname", "Shell", "dirname path", "A path without its last part.", function (ctx) { var p = (ctx.args[0] || "").replace(/\/+$/, ""), i = p.lastIndexOf("/"); ctx.out((i < 0 ? "." : i === 0 ? "/" : p.slice(0, i)) + "\n"); return 0; });
  def("alias", "Shell", "alias", "Short names for long commands (this small bash has none set).", function (ctx) { if (ctx.args.length) ctx.err(c("2", "(alias isn't available in this small bash — write a little script in ~ instead)") + "\n"); return ctx.args.length ? 1 : 0; }, { builtin: true });

  def("jobs", "Programs", "jobs", "Programs you started with & and left running.", function (ctx) {
    ctx.m.jobs.forEach(function (j, i, all) { ctx.out("[" + j.n + "]" + (i === all.length - 1 ? "+" : i === all.length - 2 ? "-" : " ") + "  Running                 " + j.cmd + " &\n"); });
    return 0;
  }, { builtin: true });
  def("fg", "Programs", "fg [%n]", "Bring a background program back to the front, where Ctrl+C can reach it.", function* (ctx) {
    var m = ctx.m, want = ctx.args[0] ? parseInt(ctx.args[0].replace("%", ""), 10) : null, job = want == null ? m.jobs[m.jobs.length - 1] : m.jobs.filter(function (j) { return j.n === want; })[0];
    if (!job) { ctx.err("-bash: fg: " + (ctx.args[0] || "current") + ": no such job\n"); return 1; }
    ctx.out(job.cmd + "\n");
    var p = job.proc;
    m.jobs.splice(m.jobs.indexOf(job), 1); p.job = null;
    /* wait for it; Ctrl+C lands here and is passed on */
    for (;;) {
      if (m.procs.indexOf(p) < 0) return 0;
      try { yield 0.03; } catch (e) { if (e !== Py.SIGINT) throw e; m.step(p, Py.SIGINT); if (m.procs.indexOf(p) < 0) return 130; }
    }
  }, { builtin: true });
  function findProcs(ctx, spec) {
    var m = ctx.m;
    if (/^%\d+$/.test(spec)) return m.jobs.filter(function (j) { return j.n === +spec.slice(1); }).map(function (j) { return j.proc; });
    if (/^\d+$/.test(spec)) return m.procs.filter(function (p) { return p.pid === +spec; });
    return null;
  }
  def("kill", "Programs", "kill %1   or   kill PID", "Stop a running program. jobs and ps tell you its number.", function (ctx) {
    var a = ctx.args.filter(function (x) { return !/^-(\d+|[A-Z]+|s)$/.test(x); }), code = 0;
    if (!a.length) { ctx.err("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...\n"); return 2; }
    a.forEach(function (spec) {
      var list = findProcs(ctx, spec);
      if (!list) { ctx.err("-bash: kill: " + spec + ": arguments must be process or job IDs\n"); code = 1; return; }
      if (!list.length) { ctx.err("-bash: kill: (" + spec + ") - No such process\n"); code = 1; return; }
      list.forEach(function (p) { if (p === ctx.proc) return; if (!ctx.m.kill(p)) { ctx.err("-bash: kill: (" + p.pid + ") - Operation not permitted\n"); code = 1; } });
    });
    return code;
  }, { builtin: true });
  def("killall pkill", "Programs", "killall python3", "Stop every running program with that name.", function (ctx) {
    var name = ctx.args.filter(function (x) { return x.charAt(0) !== "-"; })[0], m = ctx.m;
    if (!name) return ctx.fail("no process name specified");
    var list = m.procs.filter(function (p) { return p !== ctx.proc && !p.sys && (ctx.name === "pkill" ? p.name.indexOf(name) >= 0 : p.name.split(" ")[0] === name || (p.py && /^python/.test(name))); });
    if (!list.length) { if (ctx.name === "killall") ctx.err(name + ": no process found\n"); return 1; }
    list.forEach(function (p) { m.kill(p); });
    return 0;
  });

  /* A believable process table: the daemons a Pi always has, then what is really running here. */
  function table(m) {
    var sys = [[1, "root", "/sbin/init", 0.0, 0.3], [2, "root", "[kthreadd]", 0, 0], [89, "root", "[kworker/0:1H-mmc_complete]", 0.1, 0], [231, "root", "/lib/systemd/systemd-journald", 0, 0.4], [402, "root", "/usr/sbin/wpa_supplicant -u -s", 0, 0.2], [455, "root", "sshd: /usr/sbin/sshd -D [listener]", 0, 0.2], [588, m.os.user, "-bash", 0, 0.1]];
    var mine = m.procs.filter(function (p) { return !p.sys && !(p === m.fg && !p.py); }).map(function (p) { var life = Math.max(0.2, (m.t - p.t0) * 1000); return [p.pid, p.user || m.os.user, p.name, Math.min(99, p.cpu / life * 100 * 6 + (p.py ? 2.1 : 0.3)), p.py ? 0.9 : 0.1, m.t - p.t0]; });
    return sys.concat(mine);
  }
  def("ps", "Programs", "ps [aux]", "List running programs and their numbers (PIDs).", function (ctx) {
    var m = ctx.m, full = /a|e|x|f/.test(ctx.args.join("")), rows = table(m), tm = function (s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + lpad(s % 60, 2, "0"); };
    if (!full) {
      ctx.out("    PID TTY          TIME CMD\n");
      rows.filter(function (r) { return r[0] >= 588; }).forEach(function (r) { ctx.out(lpad(r[0], 7) + " tty1     00:00:" + lpad(Math.floor((r[5] || 0) / 10) % 60, 2, "0") + " " + r[2].replace(/^-/, "").split(" ")[0] + "\n"); });
      ctx.out(lpad(m.nextPid, 7) + " tty1     00:00:00 ps\n");
      return 0;
    }
    ctx.out("USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n");
    rows.forEach(function (r) { ctx.out(pad(r[1], 8) + lpad(r[0], 8) + lpad(r[3].toFixed(1), 5) + lpad(r[4].toFixed(1), 5) + lpad(r[0] === 1 ? 168820 : 9000 + r[0] * 13 % 30000, 7) + lpad(r[0] === 1 ? 11764 : 2100 + r[0] * 7 % 9000, 6) + (r[0] >= 588 ? " tty1     " : " ?        ") + (r[3] > 1 ? "R" : "S") + "    " + lpad(new Date(m.bootWall * 1000).getHours(), 2, "0") + ":" + lpad(new Date(m.bootWall * 1000).getMinutes(), 2, "0") + lpad(tm(r[5]), 7) + " " + r[2].slice(0, 60) + "\n"); });
    return 0;
  });

  /* ============================================================== SYSTEM */

  def("whoami", "System", "whoami", "Your user name.", function (ctx) { ctx.out((ctx.root ? "root" : ctx.sh.user) + "\n"); return 0; });
  def("id", "System", "id", "Your user and the groups you are in (gpio is what lets you use the pins).", function (ctx) {
    ctx.out(ctx.root ? "uid=0(root) gid=0(root) groups=0(root)\n" : "uid=1000(" + ctx.sh.user + ") gid=1000(" + ctx.sh.user + ") groups=1000(" + ctx.sh.user + "),4(adm),20(dialout),27(sudo),44(video),993(gpio),994(i2c),995(spi)\n");
    return 0;
  });
  def("groups", "System", "groups", "The groups you are in.", function (ctx) { ctx.out(ctx.root ? "root\n" : ctx.sh.user + " adm dialout sudo video gpio i2c spi\n"); return 0; });
  def("hostname", "System", "hostname [-I]   sudo hostname NAME", "This Pi's name on the network. sudo hostname NAME changes it.", function (ctx) {
    var a = ctx.args;
    if (a[0] === "-I" || a[0] === "-i") { ctx.out("192.168.4.27 \n"); return 0; }
    if (!a.length) { ctx.out(ctx.m.hostName + "\n"); return 0; }
    if (!ctx.root) return ctx.fail("you must be root to change the host name");
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/.test(a[0])) return ctx.fail("the specified hostname is invalid");
    ctx.m.hostName = a[0]; ctx.m.onHost(a[0]);
    return 0;
  });
  def("uname", "System", "uname [-a]", "The kernel this Pi is running.", function (ctx) {
    var o = opts(ctx.args, "asnrvmo").o, os = ctx.os, parts = [];
    if (o.a) { ctx.out("Linux " + ctx.m.hostName + " " + os.kernel + " " + os.build + " aarch64 GNU/Linux\n"); return 0; }
    if (o.s || (!o.n && !o.r && !o.v && !o.m && !o.o)) parts.push("Linux");
    if (o.n) parts.push(ctx.m.hostName); if (o.r) parts.push(os.kernel); if (o.v) parts.push(os.build); if (o.m) parts.push("aarch64"); if (o.o) parts.push("GNU/Linux");
    ctx.out(parts.join(" ") + "\n");
    return 0;
  });
  def("lsb_release", "System", "lsb_release -a", "Which Linux is on the card.", function (ctx) {
    var os = ctx.os, o = opts(ctx.args, "aidrcs").o, ub = os.id === "ubuntu";
    if (ub && (o.a || !Object.keys(o).length)) ctx.out("No LSB modules are available.\n");
    var rows = [["i", "Distributor ID", ub ? "Ubuntu" : "Debian"], ["d", "Description", os.pretty], ["r", "Release", os.version], ["c", "Codename", os.codename]];
    rows.forEach(function (r) { if (o.a || o[r[0]]) ctx.out(o.s ? r[2] + "\n" : r[1] + ":\t" + r[2] + "\n"); });
    return 0;
  });
  def("date", "System", "date [+format]", "The date and time. date +%H:%M prints just the time.", function (ctx) {
    var d = date(ctx.m), f = ctx.args[0];
    ctx.out((f && f.charAt(0) === "+" ? strf(f.slice(1), d) : strf("%a %e %b %H:%M:%S GMT %Y", d)) + "\n");
    return 0;
  });
  function strf(fmt, d) {
    var D = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], Mo = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], z = function (n) { return lpad(n, 2, "0"); };
    return fmt.replace(/%([a-zA-Z%])/g, function (all, k) {
      switch (k) {
        case "H": return z(d.getHours()); case "M": return z(d.getMinutes()); case "S": return z(d.getSeconds()); case "Y": return d.getFullYear(); case "y": return z(d.getFullYear() % 100);
        case "m": return z(d.getMonth() + 1); case "d": return z(d.getDate()); case "e": return lpad(d.getDate(), 2); case "a": return D[d.getDay()].slice(0, 3); case "A": return D[d.getDay()];
        case "b": return Mo[d.getMonth()].slice(0, 3); case "B": return Mo[d.getMonth()]; case "s": return Math.floor(d.getTime() / 1000); case "T": return z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds());
        case "F": return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); case "D": return z(d.getMonth() + 1) + "/" + z(d.getDate()) + "/" + z(d.getFullYear() % 100); case "R": return z(d.getHours()) + ":" + z(d.getMinutes());
        case "N": return lpad(d.getMilliseconds() * 1e6, 9, "0"); case "j": return lpad(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), 3, "0"); case "u": return d.getDay() || 7; case "n": return "\n"; case "%": return "%";
      }
      return all;
    });
  }
  def("cal", "System", "cal", "This month's calendar.", function (ctx) {
    var d = date(ctx.m), y = d.getFullYear(), mo = d.getMonth(), first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate(), title = strf("%B %Y", d);
    var s = new Array(Math.floor((20 - title.length) / 2) + 1).join(" ") + title + "\nSu Mo Tu We Th Fr Sa\n" + new Array(first * 3 + 1).join(" ");
    for (var i = 1; i <= days; i++) { var cell = lpad(i, 2); s += (i === d.getDate() && ctx.tty ? c("7", cell) : cell) + ((first + i) % 7 === 0 || i === days ? "\n" : " "); }
    ctx.out(s + "\n");
    return 0;
  });
  function upStr(m) { var u = m.uptime(), mins = Math.floor(u / 60); return mins >= 60 ? Math.floor(mins / 60) + ":" + lpad(mins % 60, 2, "0") : mins + " min"; }
  def("uptime", "System", "uptime", "How long this Pi has been on, and how busy it is.", function (ctx) { var m = ctx.m; ctx.out(" " + strf("%T", date(m)) + " up " + upStr(m) + ",  1 user,  load average: " + m.load().map(function (x) { return x.toFixed(2); }).join(", ") + "\n"); return 0; });
  def("free", "System", "free [-h]", "How much memory is in use.", function (ctx) {
    var h = opts(ctx.args, "hmg").o.h, free = ctx.m.memFree(), tot = 3884404, cache = 409328, used = tot - free - cache, f = function (kb) { return lpad(h ? (kb > 1048576 ? (kb / 1048576).toFixed(1) + "Gi" : Math.round(kb / 1024) + "Mi") : kb, 12); };
    ctx.out("               total        used        free      shared  buff/cache   available\nMem:    " + f(tot).slice(1) + f(used) + f(free) + f(1284) + f(cache) + f(free + 380000) + "\nSwap:   " + f(102396).slice(1) + f(0) + f(102396) + "\n");
    return 0;
  });
  def("lscpu", "System", "lscpu", "About the processor.", function (ctx) {
    ctx.out("Architecture:           aarch64\n  CPU op-mode(s):       32-bit, 64-bit\n  Byte Order:           Little Endian\nCPU(s):                 4\n  On-line CPU(s) list:  0-3\nVendor ID:              ARM\n  Model name:           Cortex-A72\n    Model:              3\n    Thread(s) per core: 1\n    Core(s) per cluster: 4\n    CPU max MHz:        1800.0000\n    CPU min MHz:        600.0000\n    BogoMIPS:           108.00\nCaches (sum of all):\n  L1d:                  128 KiB (4 instances)\n  L1i:                  192 KiB (4 instances)\n  L2:                   1 MiB (1 instance)\n");
    return 0;
  });
  def("lsusb", "System", "lsusb", "What is plugged into the USB ports.", function (ctx) { ctx.out("Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub\nBus 001 Device 003: ID 046d:c31c Logitech, Inc. Keyboard K120\nBus 001 Device 002: ID 2109:3431 VIA Labs, Inc. Hub\nBus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub\n"); return 0; });
  def("lsblk", "System", "lsblk", "The SD card and its partitions.", function (ctx) { ctx.out("NAME        MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nmmcblk0     179:0    0 29.7G  0 disk \n├─mmcblk0p1 179:1    0  512M  0 part /boot/firmware\n└─mmcblk0p2 179:2    0 29.2G  0 part /\n"); return 0; });
  def("dmesg", "System", "dmesg", "What the kernel has said since it started.", function (ctx) {
    var os = ctx.os, t = 0, k = function (dt, s) { t += dt; return "[" + lpad(t.toFixed(6), 12) + "] " + s + "\n"; };
    ctx.out(k(0, "Booting Linux on physical CPU 0x0000000000 [0x410fd083]") + k(0, "Linux version " + os.kernel + " " + os.build) + k(0, "Machine model: " + OS.MODEL) + k(0.31, "raspberrypi-firmware soc:firmware: Attached to firmware from 2024-09-23T13:02:56") +
      k(0.47, "mmc0: new high speed SDHC card at address aaaa") + k(0.19, "pinctrl-bcm2835 fe200000.gpio: GPIO chip registered, 58 lines") + k(0.62, "EXT4-fs (mmcblk0p2): mounted filesystem with ordered data mode.") + k(1.9, "brcmfmac: brcmf_cfg80211_set_power_mgmt: power save enabled") + k(2.2, "IPv6: ADDRCONF(NETDEV_CHANGE): wlan0: link becomes ready"));
    return 0;
  });
  def("ifconfig", "System", "ifconfig", "Network connections and their addresses.", function (ctx) {
    ctx.out("lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        loop  txqueuelen 1000  (Local Loopback)\n\nwlan0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 192.168.4.27  netmask 255.255.255.0  broadcast 192.168.4.255\n        ether dc:a6:32:c0:ff:ee  txqueuelen 1000  (Ethernet)\n        RX packets 1834  bytes 412230 (402.5 KiB)\n        TX packets 921  bytes 118204 (115.4 KiB)\n\n");
    return 0;
  });
  def("ip", "System", "ip a", "Network connections, the modern way.", function (ctx) {
    if (!/^(a|addr|address)$/.test(ctx.args[0] || "a")) { ctx.err('Object "' + ctx.args[0] + '" is unknown, try "ip help".\n'); return 1; }
    ctx.out("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc mq state DOWN group default qlen 1000\n    link/ether dc:a6:32:c0:ff:ed brd ff:ff:ff:ff:ff:ff\n3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc pfifo_fast state UP group default qlen 1000\n    link/ether dc:a6:32:c0:ff:ee brd ff:ff:ff:ff:ff:ff\n    inet 192.168.4.27/24 brd 192.168.4.255 scope global dynamic noprefixroute wlan0\n");
    return 0;
  });
  def("ping", "System", "ping [-c N] host", "Ask another computer whether it is there, and time the answer.", function* (ctx) {
    var p = opts(ctx.args, "", "ci"), host = p.rest[0], n = p.o.c ? parseInt(p.o.c, 10) : 4, sent = 0, times = [];
    if (!host) return ctx.fail("usage error: Destination address required");
    var local = /^(localhost|127\.|192\.168\.|raspberrypi|ubuntu|debian)/.test(host) || host === ctx.m.hostName, ipn = local ? (/^\d/.test(host) ? host : "127.0.0.1") : [142, 250, (host.length * 37) % 255, (host.charCodeAt(0) * 3) % 255].join(".");
    ctx.out("PING " + host + " (" + ipn + ") 56(84) bytes of data.\n");
    try {
      for (; sent < n; sent++) { yield sent ? 1 : 0.05; var ms = local ? 0.05 + Math.random() * 0.08 : 11 + Math.random() * 9; times.push(ms); ctx.out("64 bytes from " + ipn + ": icmp_seq=" + (sent + 1) + " ttl=" + (local ? 64 : 117) + " time=" + ms.toFixed(local ? 3 : 1) + " ms\n"); }
    } catch (e) { if (e !== Py.SIGINT) throw e; }
    var avg = times.reduce(function (a, b) { return a + b; }, 0) / (times.length || 1);
    ctx.out("\n--- " + host + " ping statistics ---\n" + Math.max(sent, times.length) + " packets transmitted, " + times.length + " received, 0% packet loss, time " + Math.round(Math.max(0, times.length - 1) * 1001) + "ms\n" + (times.length ? "rtt min/avg/max/mdev = " + Math.min.apply(null, times).toFixed(3) + "/" + avg.toFixed(3) + "/" + Math.max.apply(null, times).toFixed(3) + "/0.412 ms\n" : ""));
    return 0;
  });
  def("curl wget", "System", "curl URL", "Fetch a web page (this Pi's network only reaches the package mirror).", function (ctx) {
    var url = ctx.args.filter(function (a) { return a.charAt(0) !== "-"; })[0] || "", host = url.replace(/^\w+:\/\//, "").split("/")[0];
    if (!url) return ctx.fail(ctx.name === "curl" ? "try 'curl --help' for more information" : "missing URL", 2);
    ctx.err(ctx.name === "curl" ? "curl: (6) Could not resolve host: " + host + "\n" : "--" + strf("%F %T", date(ctx.m)) + "--  " + url + "\nResolving " + host + " (" + host + ")... failed: Temporary failure in name resolution.\nwget: unable to resolve host address ‘" + host + "’\n");
    ctx.err(c("2", "(The lab's network stops at the classroom door: only apt's package mirror is reachable.)") + "\n");
    return ctx.name === "curl" ? 6 : 4;
  });
  def("vcgencmd", "System", "vcgencmd measure_temp", "Ask the Pi's firmware about itself: measure_temp, measure_volts, get_throttled, get_mem arm.", function (ctx) {
    var a = ctx.args;
    switch (a[0]) {
      case "measure_temp": ctx.out("temp=" + ctx.m.temp().toFixed(1) + "'C\n"); return 0;
      case "measure_volts": ctx.out("volt=0.8625V\n"); return 0;
      case "get_throttled": ctx.out("throttled=0x0\n"); return 0;
      case "get_mem": ctx.out((a[1] === "gpu" ? "gpu=76M" : "arm=948M") + "\n"); return 0;
      case "measure_clock": ctx.out("frequency(48)=" + (ctx.m.procs.length > 2 ? 1800457088 : 600117184) + "\n"); return 0;
      case "version": ctx.out("Sep 23 2024 13:02:56 \nCopyright (c) 2012 Broadcom\nversion 26826259c3f0bb7ed33d3a6f7c4b3d2b3f1f0c1f (clean) (release) (start)\n"); return 0;
      case "commands": case undefined: ctx.out('commands="commands, measure_temp, measure_volts, measure_clock, get_throttled, get_mem, version"\n'); return 0;
    }
    ctx.out("error=1 error_msg=\"Command not registered\"\n");
    return 255;
  }, { only: ["raspios"] });
  def("raspi-config", "System", "sudo raspi-config", "The Pi's settings menu.", function (ctx) {
    if (!ctx.root) { ctx.out("Script must be run as root. Try 'sudo raspi-config'\n"); return 1; }
    var w = 58, line = function (s) { return "│ " + pad(s, w - 2) + " │\n"; };
    ctx.out("┌" + new Array(w + 1).join("─") + "┐\n" + line("Raspberry Pi Software Configuration Tool (raspi-config)") + line("") +
      ["1 System Options       Hostname: " + ctx.m.hostName, "2 Display Options      No display attached (headless)", "3 Interface Options    SSH on · I2C on · SPI on · Serial on", "4 Performance Options  GPU memory 76M", "5 Localisation Options en_GB.UTF-8 · Europe/London", "6 Advanced Options     Filesystem already expanded", "8 Update               sudo apt update && sudo apt upgrade"].map(line).join("") +
      line("") + line("                 <Select>          <Finish>") + "└" + new Array(w + 1).join("─") + "┘\n" + c("2", "This simulated Pi is already set up, so there is nothing to change here. To rename it: sudo hostname NAME") + "\n");
    return 0;
  }, { only: ["raspios"] });

  /* neofetch: the picture every Linux user posts first */
  def("neofetch", "System", "neofetch", "This Pi at a glance, next to its Linux's logo.", function (ctx) {
    var m = ctx.m, os = ctx.os, logo = os.logo, u = m.uptime(), busy = m.gpio.inUse ? m.gpio.inUse() : [], a = function (s) { return c("1;" + os.accent, s); };
    var info = [a(ctx.sh.user) + "@" + a(m.hostName), new Array((ctx.sh.user + m.hostName).length + 2).join("-"),
      a("OS") + ": " + os.pretty + " aarch64", a("Host") + ": " + OS.MODEL, a("Kernel") + ": " + os.kernel, a("Uptime") + ": " + (u < 60 ? Math.floor(u) + " secs" : Math.floor(u / 60) + " min" + (Math.floor(u / 60) === 1 ? "" : "s")),
      a("Packages") + ": " + (os.pkgs + Object.keys(m.pkgs).length) + " (dpkg)", a("Shell") + ": " + os.shell, a("Terminal") + ": /dev/tty1", a("CPU") + ": BCM2711 (4) @ 1.800GHz",
      a("Memory") + ": " + Math.round((3884404 - m.memFree() - 409328) / 1024) + "MiB / 3793MiB", a("Temp") + ": " + m.temp().toFixed(1) + "°C", a("GPIO") + ": " + (busy.length ? busy.length + " pin" + (busy.length > 1 ? "s" : "") + " in use (" + busy.slice(0, 6).join(", ") + (busy.length > 6 ? "…" : "") + ")" : "all 26 pins free"),
      "", [30, 31, 32, 33, 34, 35, 36, 37].map(function (k) { return "\x1b[7;" + k + "m   \x1b[0m"; }).join(""), [90, 91, 92, 93, 94, 95, 96, 97].map(function (k) { return "\x1b[7;" + k + "m   \x1b[0m"; }).join("")];
    var w = Math.max.apply(null, logo.map(function (l) { return l.length; })) + 3, n = Math.max(logo.length, info.length), out = "";
    for (var i = 0; i < n; i++) {
      var l = logo[i] || "", col = os.logoColors[os.logoSplit != null && i >= os.logoSplit ? 1 : 0];
      out += (ctx.tty ? c("1;" + col, pad(l, w)) : pad(l, w)) + (info[i] || "") + "\n";
    }
    ctx.out(ctx.tty ? out : out.replace(/\x1b\[[0-9;]*m/g, ""));
    return 0;
  }, { pkg: "neofetch" });

  /* top / htop: a page that redraws itself until you press q */
  function topLike(fancy) {
    return function* (ctx) {
      var m = ctx.m;
      if (!ctx.tty) { ctx.err(ctx.name + ": failed tty get\n"); return 1; }
      ctx.out("\x1b[?1049h"); m.raw = true;
      try {
        for (;;) {
          var rows = table(m), ld = m.load(), busy = Math.min(100, m.procs.filter(function (p) { return !p.sys && p !== ctx.proc; }).length * 22 + 2), s = "\x1b[H\x1b[2J";
          if (fancy) {
            for (var k = 0; k < 4; k++) { var pc = Math.max(1, Math.round(busy * (k === 0 ? 1 : 0.25 + 0.2 * Math.sin(m.t + k)))), bar = Math.round(pc / 100 * 28); s += "  " + c("36", k) + "[" + c(pc > 60 ? "31" : "32", new Array(bar + 1).join("|")) + new Array(28 - bar + 1).join(" ") + lpad(pc.toFixed(1) + "%", 6) + "]" + (k === 0 ? "   Tasks: " + c("1", 60 + m.procs.length) + ", " + c("1;32", Math.max(1, m.procs.length - 1)) + " running" : k === 1 ? "   Load average: " + c("1", ld.map(function (x) { return x.toFixed(2); }).join(" ")) : k === 2 ? "   Uptime: " + c("1", upStr(m)) : "   Temp: " + c("1", m.temp().toFixed(1) + "°C")) + "\n"; }
            var mem = (3884404 - m.memFree() - 409328) / 3884404, mb = Math.round(mem * 28);
            s += "" + c("36", "Mem") + "[" + c("32", new Array(mb + 1).join("|")) + new Array(28 - mb + 1).join(" ") + lpad(Math.round(mem * 3793) + "M/3.70G", 12).slice(-12) + "]\n\n";
            s += "\x1b[7;32m" + pad("    PID USER       PRI  NI  VIRT   RES S  CPU% MEM%   TIME+  Command", m.cols) + "\x1b[0m\n";
          } else {
            s += "top - " + strf("%T", date(m)) + " up " + upStr(m) + ",  1 user,  load average: " + ld.map(function (x) { return x.toFixed(2); }).join(", ") + "\n";
            s += "Tasks: " + (60 + m.procs.length) + " total,   " + Math.max(1, m.procs.length - 1) + " running, " + 59 + " sleeping,   0 stopped,   0 zombie\n";
            s += "%Cpu(s): " + lpad((busy / 4).toFixed(1), 4) + " us,  0.7 sy,  0.0 ni, " + lpad((100 - busy / 4 - 0.7).toFixed(1), 4) + " id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st\n";
            s += "MiB Mem :   3793.4 total, " + lpad((m.memFree() / 1024).toFixed(1), 8) + " free, " + lpad(((3884404 - m.memFree() - 409328) / 1024).toFixed(1), 8) + " used,    399.7 buff/cache\n\n";
            s += "\x1b[7m" + pad("    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND", m.cols) + "\x1b[0m\n";
          }
          rows.push([ctx.proc ? ctx.proc.pid : 999, ctx.sh.user, ctx.name, 0.7, 0.1, 0]);
          rows.sort(function (a, b) { return b[3] - a[3]; });
          rows.slice(0, Math.max(4, m.rows - 9)).forEach(function (r) {
            var tm = Math.floor(r[5] || 0);
            s += lpad(r[0], 7) + " " + pad(r[1], fancy ? 10 : 9) + (fancy ? " 20   0 " : "20   0 ") + lpad(r[0] === 1 ? "168M" : (9 + r[0] % 30) + "M", fancy ? 5 : 7) + lpad(r[0] === 1 ? "11M" : (2 + r[0] % 9) + "M", fancy ? 6 : 7) + (fancy ? " " : lpad("3M", 7) + " ") + (r[3] > 1 ? c("32", "R") : "S") + lpad(r[3].toFixed(1), 6) + lpad(r[4].toFixed(1), fancy ? 5 : 6) + lpad(Math.floor(tm / 60) + ":" + lpad(tm % 60, 2, "0") + ".00", 10) + " " + (r[3] > 1 ? c("1", r[2].slice(0, 44)) : r[2].slice(0, 44)) + "\n";
          });
          s += "\n" + (fancy ? "\x1b[7;36mF1\x1b[0mHelp  \x1b[7;36mq\x1b[0mQuit" : c("2", "press q to quit"));
          ctx.out(s);
          for (var w = 0; w < 20; w++) { if (m.keys.length) { var key = m.keys.shift(); if (key === "q" || key === "Q") return 0; } yield 0.05; }
        }
      } finally { ctx.out("\x1b[?1049l"); m.raw = false; }
    };
  }
  def("top", "Programs", "top", "A live table of what is running. Press q to leave.", topLike(false));
  def("htop", "Programs", "htop", "top with colour and bars. Press q to leave.", topLike(true), { pkg: "htop" });
  def("watch", "Programs", "watch [-n secs] command", "Run a command again and again and show its latest answer. Press q to leave.", function* (ctx) {
    var p = opts(ctx.args, "td", "n"), every = p.o.n ? Math.max(0.1, parseFloat(p.o.n) || 2) : 2, m = ctx.m, line = p.rest.join(" ");
    if (!line) { ctx.err("Usage:\n watch [options] command\n"); return 1; }
    if (!ctx.tty) return ctx.fail("needs a terminal");
    ctx.out("\x1b[?1049h"); m.raw = true;
    try {
      for (;;) {
        var out = yield* ctx.sh.capture(line, { stdin: "", err: function () {}, proc: ctx.proc });
        var head = "Every " + every.toFixed(1) + "s: " + line, when = m.hostName + ": " + strf("%a %b %e %T %Y", date(m));
        ctx.out("\x1b[H\x1b[2J" + head + new Array(Math.max(2, m.cols - head.length - when.length + 1)).join(" ") + when + "\n\n" + lines(out).slice(0, m.rows - 3).join("\n") + "\n");
        for (var w = 0; w < every / 0.05; w++) { if (m.keys.length) { var key = m.keys.shift(); if (key === "q" || key === "Q") return 0; } yield 0.05; }
      }
    } finally { ctx.out("\x1b[?1049l"); m.raw = false; }
  });

  /* ================================================================ POWER */

  def("sudo", "System", "sudo command", "Run one command as root, the user who is allowed to do anything. Use it only when a command says it needs it.", function* (ctx) {
    var a = ctx.args.slice(), m = ctx.m;
    if (!a.length) { ctx.err("usage: sudo -h | -K | -k | -V\nusage: sudo [-i | -s] [command [arg ...]]\n"); return 1; }
    if (a[0] === "-i" || a[0] === "-s" || (a[0] === "su" && (a.length === 1 || a[1] === "-"))) { var rs = new OS.Shell(m, "root"); rs.prev = ctx.sh; rs.history = ctx.sh.history; m.sh = rs; return 0; }
    if (a[0] === "!!") { ctx.err(c("2", "(history expansion isn't in this small bash: press the up arrow, then type sudo in front)") + "\n"); return 1; }
    while (a.length && /^-/.test(a[0])) a.shift();
    return yield* ctx.sh.run(a, ctx.io, true);
  });
  def("su", "System", "su", "Become another user. (Use sudo instead: root has no password on a Pi.)", function* (ctx) {
    if (ctx.root) { var rs = new OS.Shell(ctx.m, "root"); rs.prev = ctx.sh; ctx.m.sh = rs; return 0; }
    ctx.out("Password: ");
    yield* ctx.readLine();
    yield 1.2;
    ctx.err("su: Authentication failure\n" + c("2", "(root has no password here. Use: sudo -i)") + "\n");
    return 1;
  });
  function power(reboot) {
    return function* (ctx) {
      var a = ctx.args.join(" ");
      if (!ctx.root) { ctx.err("Failed to set wall message, ignoring: Interactive authentication required.\nFailed to " + (reboot ? "reboot" : "power off") + " system via logind: Interactive authentication required.\n" + c("2", "(This needs root: sudo " + ctx.name + (a ? " " + a : "") + ")") + "\n"); return 1; }
      if (ctx.name === "shutdown" && /-c/.test(a)) { ctx.out("Shutdown cancelled.\n"); return 0; }
      var later = ctx.name === "shutdown" && !/now|\+0/.test(a) && !/-r|-h|-P/.test(a.replace(/now/, "")) && !a;
      if (later || (ctx.name === "shutdown" && /\+\d+|\d\d:\d\d/.test(a) && !/\+0\b/.test(a))) { ctx.out("Shutdown scheduled for " + strf("%a %Y-%m-%d %H:%M:%S GMT", new Date(ctx.m.wall() * 1000 + 60000)) + ", use 'shutdown -c' to cancel.\n" + c("2", "(This lab's Pi doesn't keep appointments. For right now: sudo shutdown -h now)") + "\n"); return 0; }
      return yield* ctx.m.halt(reboot || (ctx.name === "shutdown" && /-r/.test(a)));
    };
  }
  def("reboot", "System", "sudo reboot", "Restart the Pi.", power(true));
  def("shutdown poweroff halt", "System", "sudo shutdown -h now", "Shut the Pi down properly before unplugging it, so the SD card is not caught mid-write.", power(false));

  /* ================================================================= GPIO */

  /* The 40-pin header, in the order the pins are numbered on the board. */
  var J8 = OS.J8 = [
    ["3V3", null], ["5V", null], ["GPIO2", 2, "SDA"], ["5V", null], ["GPIO3", 3, "SCL"], ["GND", null], ["GPIO4", 4], ["GPIO14", 14, "TXD"], ["GND", null], ["GPIO15", 15, "RXD"],
    ["GPIO17", 17], ["GPIO18", 18, "PWM0"], ["GPIO27", 27], ["GND", null], ["GPIO22", 22], ["GPIO23", 23], ["3V3", null], ["GPIO24", 24], ["GPIO10", 10, "MOSI"], ["GND", null],
    ["GPIO9", 9, "MISO"], ["GPIO25", 25], ["GPIO11", 11, "SCLK"], ["GPIO8", 8, "CE0"], ["GND", null], ["GPIO7", 7, "CE1"], ["GPIO0", 0, "ID_SD"], ["GPIO1", 1, "ID_SC"], ["GPIO5", 5], ["GND", null],
    ["GPIO6", 6], ["GPIO12", 12, "PWM0"], ["GPIO13", 13, "PWM1"], ["GND", null], ["GPIO19", 19], ["GPIO16", 16], ["GPIO26", 26], ["GPIO20", 20], ["GND", null], ["GPIO21", 21]
  ];
  var WPI = { 2: 8, 3: 9, 4: 7, 14: 15, 15: 16, 17: 0, 18: 1, 27: 2, 22: 3, 23: 4, 24: 5, 10: 12, 9: 13, 25: 6, 11: 14, 8: 10, 7: 11, 0: 30, 1: 31, 5: 21, 6: 22, 12: 26, 13: 23, 19: 24, 16: 27, 26: 25, 20: 28, 21: 29 };
  var WNAME = { 2: "SDA.1", 3: "SCL.1", 4: "GPIO. 7", 14: "TxD", 15: "RxD", 17: "GPIO. 0", 18: "GPIO. 1", 27: "GPIO. 2", 22: "GPIO. 3", 23: "GPIO. 4", 24: "GPIO. 5", 10: "MOSI", 9: "MISO", 25: "GPIO. 6", 11: "SCLK", 8: "CE0", 7: "CE1", 0: "SDA.0", 1: "SCL.0", 5: "GPIO.21", 6: "GPIO.22", 12: "GPIO.26", 13: "GPIO.23", 19: "GPIO.24", 16: "GPIO.27", 26: "GPIO.25", 20: "GPIO.28", 21: "GPIO.29" };
  function pinColour(name) { return /^3V3/.test(name) ? "33" : /^5V/.test(name) ? "31" : /^GND/.test(name) ? "2" : "32"; }

  def("pinout", "GPIO", "pinout", "A map of the 40 pins: which is which, and where 3.3 V, 5 V and ground are.", function (ctx) {
    var col = ctx.tty ? c : function (k, s) { return s; }, g = ctx.m.gpio;
    var board = [
      ",--------------------------------.", "| " + col("33", "oooooooooooooooooooo") + " J8   +======", "| " + col("33", "1ooooooooooooooooooo") + "  PoE |   Net", "|  Wi                    " + col("33", "1o") + " +======", "|  Fi  " + col("1", "Pi Model 4B  V1.5") + " " + col("33", "oo") + "      |",
      "|        ,----. +---+         +====", "| |D|    |SoC | |RAM|         |USB3", "| |S|    |    | |   |         +====", "| |I|    `----' +---+            |", "|                   |C|       +====", "|                   |S|       |USB2", "| pwr   |hd|   |hd| |I||A|    +====", "`-| |---|m0|---|m1|----|V|-------'"
    ];
    var s = "Description        : Raspberry Pi 4B rev 1.5\nRevision           : c03115\nSoC                : BCM2711\nRAM                : 4GB\nStorage            : MicroSD\nUSB ports          : 4 (of which 2 USB3)\nEthernet ports     : 1 (1000Mbps max. speed)\nWi-fi              : True\nBluetooth          : True\n\n" + board.join("\n") + "\n\nJ8:\n";
    for (var i = 0; i < 40; i += 2) {
      var a = J8[i], b = J8[i + 1], mark = function (p) { if (p[1] == null || !ctx.tty) return ""; var st = g.state(p[1]); return st.fn === "op" ? col(st.level ? "1;33" : "2", st.level ? " ● on" : " ○ off") : ""; };
      s += col(pinColour(a[0]), lpad(a[0], 7)) + " (" + lpad(i + 1, 2).replace(" ", "") + ")" + (i + 1 < 10 ? " " : "") + " (" + (i + 2) + ")" + (i + 2 < 10 ? " " : "") + " " + col(pinColour(b[0]), pad(b[0], 7)) + mark(b) + (mark(a) ? col("2", "   ← pin " + (i + 1) + ":") + mark(a) : "") + "\n";
    }
    ctx.out(s + "\n" + (ctx.tty ? c("2", "For further information, please refer to https://pinout.xyz/\nA pin your program is driving shows ● on or ○ off. Try: gpio readall") + "\n" : "For further information, please refer to https://pinout.xyz/\n"));
    return 0;
  });

  function bcmArg(ctx, s) { var n = /^\d+$/.test(s || "") ? +s : null; if (n == null || !ctx.m.gpio.valid(n)) return null; return n; }
  function describe(g, n) {
    var st = g.state(n);
    return lpad(n, 2) + ": " + st.fn + "    " + (st.fn === "op" ? (st.level ? "dh" : "dl") : "--") + " " + st.pull + " | " + (st.level ? "hi" : "lo") + " // GPIO" + n + " = " + (st.fn === "op" ? "output" : "input");
  }
  /* pinctrl set 17 op dh  — the tool Raspberry Pi OS ships for poking pins from the shell */
  function pinSet(ctx, n, words) {
    var g = ctx.m.gpio, st = g.state(n), fn = st.fn, pull = st.pull, level = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w === "op") fn = "op"; else if (w === "ip") fn = "ip"; else if (w === "dh") level = 1; else if (w === "dl") level = 0;
      else if (w === "pu" || w === "pd" || w === "pn") pull = w;
      else if (/^a[0-5]$/.test(w)) { ctx.err(c("2", "(alternate functions aren't simulated: the pin stays a plain GPIO)") + "\n"); }
      else return ctx.fail("Unknown argument \"" + w + "\"");
    }
    if (fn === "op") { g.setup(n, "out"); g.write(n, level != null ? level : st.fn === "op" ? st.level : 0); }
    else g.setup(n, pull === "pu" ? "pu" : pull === "pd" ? "pd" : "in");
    return 0;
  }
  def("pinctrl", "GPIO", "pinctrl get 17      pinctrl set 17 op dh", "Read or set a pin from the shell. op = output, ip = input, dh/dl = drive high/low, pu/pd/pn = pull up/down/none.", function (ctx) {
    var a = ctx.args.slice(), g = ctx.m.gpio, n, i;
    if (a[0] === "help" || a[0] === "-h" || a[0] === "--help") { ctx.out("Use:\n  pinctrl get [GPIO]\nOR\n  pinctrl set <GPIO> [options]\n\noptions:\n  ip      set GPIO as input\n  op      set GPIO as output\n  pu/pd/pn  set GPIO in-pad pull up/down/none\n  dh/dl   set GPIO to drive high (1) or low (0) level\n\nExamples:\n  pinctrl set 17 op dh     Light an LED on GPIO17\n  pinctrl set 17 dl        …and switch it off\n  pinctrl get 2            Is the button on GPIO2 pressed? (lo = pressed)\n  pinctrl set 2 ip pu      Make GPIO2 an input with its pull-up on\n"); return 0; }
    if (!a.length || a[0] === "get") {
      if (a.length > 1) { for (i = 1; i < a.length; i++) { var list = a[i].split(","); for (var k = 0; k < list.length; k++) { n = bcmArg(ctx, list[k]); if (n == null) return ctx.fail("Unknown GPIO \"" + list[k] + "\""); ctx.out(describe(g, n) + "\n"); } } return 0; }
      for (n = 2; n <= 27; n++) ctx.out(describe(g, n) + "\n");
      return 0;
    }
    if (a[0] === "set") {
      if (a.length < 3) return ctx.fail("set needs a GPIO and at least one option — try: pinctrl set 17 op dh");
      var pins = a[1].split(",").map(function (s) { return bcmArg(ctx, s); });
      if (pins.some(function (x) { return x == null; })) return ctx.fail("Unknown GPIO \"" + a[1] + "\"");
      for (i = 0; i < pins.length; i++) { var r = pinSet(ctx, pins[i], a.slice(2)); if (r) return r; }
      return 0;
    }
    return ctx.fail("Unknown argument \"" + a[0] + "\" — try: pinctrl help");
  }, { only: ["raspios"] });
  def("raspi-gpio", "GPIO", "raspi-gpio get 17      raspi-gpio set 17 op dh", "The older name for pinctrl. Same words: op ip dh dl pu pd pn.", function (ctx) {
    var a = ctx.args.slice(), g = ctx.m.gpio, n;
    var show = function (k) { var st = g.state(k); return "GPIO " + k + ": level=" + st.level + " fsel=" + (st.fn === "op" ? 1 : 0) + " func=" + (st.fn === "op" ? "OUTPUT" : "INPUT") + " pull=" + (st.pull === "pu" ? "UP" : st.pull === "pd" ? "DOWN" : "NONE") + "\n"; };
    if (a[0] === "get" || !a.length) {
      if (a.length > 1) { n = bcmArg(ctx, a[1]); if (n == null) return ctx.fail("Unknown GPIO \"" + a[1] + "\""); ctx.out(show(n)); return 0; }
      ctx.out("BANK0 (GPIO 0 to 27):\n"); for (n = 2; n <= 27; n++) ctx.out(show(n));
      return 0;
    }
    if (a[0] === "set" && a.length >= 3) { n = bcmArg(ctx, a[1]); if (n == null) return ctx.fail("Unknown GPIO \"" + a[1] + "\""); return pinSet(ctx, n, a.slice(2)); }
    ctx.out("Use:\n  raspi-gpio get [GPIO]\n  raspi-gpio set <GPIO> [options]   (ip op dh dl pu pd pn)\n");
    return a[0] === "help" ? 0 : 1;
  }, { only: ["raspios"] });

  /* libgpiod: what Ubuntu and Debian use, and what works on every Linux board */
  function chipOk(ctx, s) { if (/^(gpiochip0|0|\/dev\/gpiochip0)$/.test(s || "")) return true; ctx.err(ctx.name + ": cannot find gpiochip '" + (s || "") + "'\n" + c("2", "(the Pi's header is on gpiochip0)") + "\n"); return false; }
  def("gpiodetect", "GPIO", "gpiodetect", "List the GPIO chips Linux knows about.", function (ctx) { ctx.out("gpiochip0 [pinctrl-bcm2711] (58 lines)\ngpiochip1 [raspberrypi-exp-gpio] (8 lines)\n"); return 0; }, { pkg: "gpiod" });
  def("gpioinfo", "GPIO", "gpioinfo", "Every GPIO line, whether it is in use, and which way it points.", function (ctx) {
    var g = ctx.m.gpio;
    ctx.out("gpiochip0 - 58 lines:\n");
    for (var n = 0; n <= 27; n++) { var st = g.state(n), nm = n < 2 ? (n ? "ID_SCL" : "ID_SDA") : "GPIO" + n, who = st.user; ctx.out("\tline " + lpad(n, 3) + ": " + lpad('"' + nm + '"', 12) + " " + lpad(who ? '"' + who + '"' : "unused", 14) + " " + lpad(st.fn === "op" ? "output" : "input", 7) + "  active-high" + (who ? " [used]" : "") + "\n"); }
    ctx.out(c("2", "\t(lines 28 to 57 are inside the Pi: Ethernet, Wi-Fi, the SD card…)") + "\n");
    return 0;
  }, { pkg: "gpiod" });
  def("gpioset", "GPIO", "gpioset gpiochip0 17=1", "Make a pin an output and set it: =1 is 3.3 V, =0 is 0 V.", function (ctx) {
    var a = ctx.args.filter(function (x) { return !/^-/.test(x); }), g = ctx.m.gpio;
    if (a.length < 2) { ctx.err("Usage: gpioset [OPTIONS] <chip name/number> <offset1>=<value1> <offset2>=<value2> ...\n"); return 1; }
    if (!chipOk(ctx, a[0])) return 1;
    for (var i = 1; i < a.length; i++) {
      var m = /^(\d+)=([01])$/.exec(a[i]);
      if (!m) return ctx.fail("invalid offset<->value mapping: " + a[i]);
      if (!g.valid(+m[1])) return ctx.fail("error setting the GPIO line values: Invalid argument");
      if (g.state(+m[1]).user) return ctx.fail("error setting the GPIO line values: Device or resource busy");
      g.setup(+m[1], "out"); g.write(+m[1], +m[2]);
    }
    return 0;
  }, { pkg: "gpiod" });
  def("gpioget", "GPIO", "gpioget gpiochip0 17", "Read a pin: prints 1 or 0.", function (ctx) {
    var a = ctx.args.filter(function (x) { return !/^-/.test(x); }), g = ctx.m.gpio, vals = [];
    if (a.length < 2) { ctx.err("Usage: gpioget [OPTIONS] <chip name/number> <offset 1> <offset 2> ...\n"); return 1; }
    if (!chipOk(ctx, a[0])) return 1;
    for (var i = 1; i < a.length; i++) {
      var n = bcmArg(ctx, a[i]);
      if (n == null) return ctx.fail("error reading GPIO values: Invalid argument");
      var st = g.state(n);
      if (st.user) return ctx.fail("error reading GPIO values: Device or resource busy");
      if (st.fn === "op") g.setup(n, "in");
      vals.push(g.read(n));
    }
    ctx.out(vals.join(" ") + "\n");
    return 0;
  }, { pkg: "gpiod" });

  /* WiringPi's gpio: old, loved, and the best table of the header there is */
  def("gpio", "GPIO", "gpio readall      gpio -g mode 17 out      gpio -g write 17 1", "WiringPi's tool. gpio readall draws every pin with its mode and level; -g means \"use GPIO numbers\".", function* (ctx) {
    var a = ctx.args.slice(), g = ctx.m.gpio, bcm = false, n;
    if (a[0] === "-g") { bcm = true; a.shift(); }
    if (a[0] === "-v") { ctx.out("gpio version: 3.10\nCopyright (c) 2012-2024 Gordon Henderson and contributors\nThis is free software with ABSOLUTELY NO WARRANTY.\n\nHardware details:\n  Type: Pi 4B, Revision: 05, Memory: 4096MB, Maker: Sony UK\n"); return 0; }
    var pin = function (s) { var v = /^\d+$/.test(s || "") ? +s : null; if (v == null) return null; if (!bcm) { for (var k in WPI) if (WPI[k] === v) return g.valid(+k) ? +k : null; return null; } return g.valid(v) ? v : null; };
    switch (a[0]) {
      case "readall": {
        var edge = " +-----+-----+---------+------+---+---Pi 4B--+---+------+---------+-----+-----+\n", cell = function (p, right) {
          var st = p[1] != null && p[1] >= 2 ? g.state(p[1]) : null, nm = p[1] == null ? (p[0] === "3V3" ? "3.3v" : p[0] === "5V" ? "5v" : "0v") : WNAME[p[1]];
          var mode = st ? (st.fn === "op" ? "OUT" : "IN") : (p[1] != null ? "IN" : ""), v = st ? String(st.level) : (p[1] != null ? "1" : "");
          var vv = ctx.tty && st && st.fn === "op" ? c(st.level ? "1;33" : "2", v) : v, cols = [lpad(p[1] == null ? "" : p[1], 3), lpad(p[1] == null ? "" : WPI[p[1]], 3), right ? pad(nm, 7) : lpad(nm, 7), right ? pad(mode, 4) : lpad(mode, 4), vv + (v ? "" : " ")];
          return right ? " | " + cols[4] + " | " + cols[3] + " | " + cols[2] + " | " + cols[1] + " | " + cols[0] + " |" : " | " + cols[0] + " | " + cols[1] + " | " + cols[2] + " | " + cols[3] + " | " + cols[4];
        };
        var s = edge + " | BCM | wPi |   Name  | Mode | V | Physical | V | Mode | Name    | wPi | BCM |\n" + edge.replace("---Pi 4B--", "----++----");
        for (var i = 0; i < 40; i += 2) s += cell(J8[i], false) + " | " + lpad(i + 1, 2) + " || " + pad(i + 2, 2) + cell(J8[i + 1], true) + "\n";
        ctx.out(s + edge.replace("---Pi 4B--", "----++----") + " | BCM | wPi |   Name  | Mode | V | Physical | V | Mode | Name    | wPi | BCM |\n" + edge);
        return 0;
      }
      case "mode": {
        n = pin(a[1]);
        if (n == null || !a[2]) return ctx.fail("Usage: gpio mode pin mode   (in, out, up, down, tri, pwm)");
        if (a[2] === "out" || a[2] === "output") { var was = g.state(n); g.setup(n, "out"); g.write(n, was.fn === "op" ? was.level : 0); }
        else if (a[2] === "in" || a[2] === "input" || a[2] === "tri") g.setup(n, "in");
        else if (a[2] === "up") g.setup(n, "pu"); else if (a[2] === "down") g.setup(n, "pd");
        else if (a[2] === "pwm") { g.setup(n, "out"); g.pwm(n, 0, 100); }
        else return ctx.fail("gpio: Invalid mode: " + a[2] + ". Should be in/out/pwm/up/down/tri");
        return 0;
      }
      case "write": n = pin(a[1]); if (n == null || !/^(0|1|on|off|up|down)$/.test(a[2] || "")) return ctx.fail("Usage: gpio write pin value"); if (g.state(n).fn !== "op") g.setup(n, "out"); g.pwm(n, null); g.write(n, /^(1|on|up)$/.test(a[2]) ? 1 : 0); return 0;
      case "read": n = pin(a[1]); if (n == null) return ctx.fail("Usage: gpio read pin"); ctx.out(g.read(n) + "\n"); return 0;
      case "toggle": n = pin(a[1]); if (n == null) return ctx.fail("Usage: gpio toggle pin"); var cur = g.state(n); g.setup(n, "out"); g.write(n, cur.fn === "op" && cur.level ? 0 : 1); return 0;
      case "pwm": n = pin(a[1]); if (n == null || !/^\d+$/.test(a[2] || "")) return ctx.fail("Usage: gpio pwm pin value   (0 to 1023)"); g.setup(n, "out"); g.pwm(n, Math.min(1023, +a[2]) / 1023, 100); return 0;
      case "blink": {
        n = pin(a[1]); if (n == null) return ctx.fail("Usage: gpio blink pin");
        g.setup(n, "out");
        try { for (;;) { g.write(n, 1); yield 0.5; g.write(n, 0); yield 0.5; } } finally { g.write(n, 0); }
      }
    }
    ctx.err("gpio: Usage: gpio [-g] mode/read/write/toggle/pwm/blink ...\n       gpio readall\n");
    return 1;
  }, { pkg: "wiringpi" });

  /* ============================================================= PROGRAMS */

  def("python3 python", "Programs", "python3 file.py      python3", "Run a Python program. With no file you get the >>> prompt, for trying one line at a time.", function* (ctx) {
    var a = ctx.args.slice(), m = ctx.m, fs = ctx.fs, sh = ctx.sh, src = null, path = null, argv = [], interactive = false;
    if (a[0] === "--version" || a[0] === "-V") { ctx.out("Python 3.11.2\n"); return 0; }
    while (a.length && /^-[uBOi]$/.test(a[0])) { if (a[0] === "-i") interactive = true; a.shift(); }
    if (a[0] === "-c") { if (a[1] == null) { ctx.err("Argument expected for the -c option\nusage: python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...\n"); return 2; } src = a[1] + "\n"; path = "<string>"; argv = ["-c"].concat(a.slice(2)); }
    else if (a[0] === "-m") { ctx.err("/usr/bin/python3: No module named " + (a[1] || "") + c("2", "   (python3 -m isn't simulated)") + "\n"); return 1; }
    else if (a.length && a[0] !== "-") {
      path = sh.abs(a[0]);
      var n = fs.node(path);
      if (!n) { ctx.err(ctx.name + ": can't open file '" + path + "': [Errno 2] No such file or directory\n"); return 2; }
      if (n instanceof Dir) { ctx.err(ctx.name + ": can't find '__main__' module in '" + path + "'\n"); return 1; }
      src = fs.readNode(n); argv = [a[0]].concat(a.slice(1));
    } else if (ctx.stdin != null) { src = yield* ctx.readAll(); path = "<stdin>"; argv = [""]; }
    var pipeLines = null, mine = function () { return ctx.proc && ctx.proc === m.fg; };
    var env = {
      gpio: m.gpio.as ? m.gpio.as("python3") : m.gpio,
      out: function (s, kind) { if (kind === "err") ctx.err(s); else ctx.out(s); },
      now: function () { return m.t; }, wall: function () { return m.wall(); },
      readLine: function () {
        if (ctx.stdin != null && src !== null && path !== "<stdin>") { if (pipeLines === null) pipeLines = lines(ctx.stdin); return pipeLines.length ? pipeLines.shift() : false; }
        if (!mine()) return false;
        return m.stdin.length ? m.stdin.shift() : null;
      },
      wantInput: function (on) { if (mine()) m.wantIn = !!on; },
      fs: {
        read: function (p) { var nd = fs.node(sh.abs(p)); return !nd ? null : nd instanceof Dir ? false : fs.readNode(nd); },
        write: function (p, text, append) { var e = fs.write(sh.abs(p), text, append, ctx.root); return e ? "[Errno " + (/space/.test(e) ? 28 : /Permission/.test(e) ? 13 : /directory$/.test(e) && /Is a/.test(e) ? 21 : 2) + "] " + e + ": '" + p + "'" : null; },
        list: function (p) { var nd = fs.node(sh.abs(p)); return nd instanceof Dir ? Object.keys(nd.kids).sort() : null; },
        cwd: function () { return sh.cwd; }
      },
      system: function* (cmd) { var tree; try { tree = OS.parse(cmd); } catch (e) { ctx.err("sh: 1: Syntax error\n"); return 512; } return (yield* new OS.Shell(m, sh.user, sh).execList(tree, { stdin: "", out: ctx.out, err: ctx.err, proc: ctx.proc })) * 256; },
      temp: function () { return m.temp(); }, user: sh.user, link: m.link
    };
    var proc = new Py.Process(env);
    if (ctx.proc) ctx.proc.py = proc;
    try {
      if (src === null) return yield* proc.runRepl("Python 3.11.2 (main, Nov 30 2024, 21:22:50) [GCC 12.2.0] on linux\nType \"help\", \"copyright\", \"credits\" or \"license\" for more information.\n");
      return yield* proc.runFile(src, path, argv);
    } finally { if (ctx.proc && ctx.proc.py === proc) ctx.proc.py = null; }
  }, { python: true });
  /* Chalk Link from the shell: the same tags Python's chalklink module uses */
  def("link", "Programs", "link list      link send lamp on      link get lamp", "Chalk Link: share named values with the board's web API, so software anywhere can read this project and drive it.", function (ctx) {
    var a = ctx.args, lk = ctx.m.link, tagOk = function (n) { return /^[a-z0-9][a-z0-9_.\-]{0,47}$/.test(n || ""); };
    var parse = function (t) { var low = t.toLowerCase(); return /^(true|on|yes)$/.test(low) ? true : /^(false|off|no)$/.test(low) ? false : /^(null|none)$/.test(low) ? null : /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : t; };
    var show = function (v) { return v === true ? "true" : v === false ? "false" : v === null || v === undefined ? "null" : String(v); };
    switch (a[0]) {
      case "status": case undefined:
        ctx.out(lk.online() ? "Chalk Link: " + c("32", "online") + "\n  " + lk.url() + "\n  " + Object.keys(lk.all()).length + " tags — link list shows them\n"
                            : "Chalk Link: " + c("33", "offline") + " — values stay on this Pi.\n" + c("2", "  Open the Link panel at the top of the lab to give this board a web address.") + "\n");
        return 0;
      case "list": case "ls": {
        var all = lk.all(), names = Object.keys(all).sort(), w = Math.max.apply(null, names.map(function (n) { return n.length; }).concat([3]));
        if (!names.length) { ctx.out(c("2", "(no tags yet — link send NAME VALUE makes one)") + "\n"); return 0; }
        names.forEach(function (n) { ctx.out(pad(n, w + 2) + show(all[n]) + "\n"); });
        return 0;
      }
      case "get": {
        if (!tagOk((a[1] || "").toLowerCase())) return ctx.fail("usage: link get NAME");
        var v = lk.get(a[1].toLowerCase());
        if (v === undefined) return ctx.fail("there is no tag called '" + a[1] + "' yet");
        ctx.out(show(v) + "\n");
        return 0;
      }
      case "send": case "set":
        if (a.length < 3 || !tagOk(a[1].toLowerCase())) return ctx.fail("usage: link send NAME VALUE   (names: a-z 0-9 . - _)");
        lk.set(a[1].toLowerCase(), parse(a.slice(2).join(" ")));
        return 0;
      case "url": if (!lk.online()) return ctx.fail("the link is offline"); ctx.out(lk.url() + "\n"); return 0;
    }
    ctx.err("Usage: link [status]\n       link list\n       link get NAME\n       link send NAME VALUE\n       link url\n");
    return 1;
  });

  def("pip pip3", "Programs", "pip list", "Python's package installer. On this Pi the GPIO libraries are already there.", function (ctx) {
    var a = ctx.args;
    if (a[0] === "list" || a[0] === "freeze") { ctx.out(a[0] === "freeze" ? "gpiozero==2.0.1\nRPi.GPIO==0.7.1\n" : "Package    Version\n---------- -------\ngpiozero   2.0.1\npip        23.0.1\nRPi.GPIO   0.7.1\nsetuptools 66.1.1\n"); return 0; }
    if (a[0] === "--version" || a[0] === "-V") { ctx.out("pip 23.0.1 from /usr/lib/python3/dist-packages/pip (python 3.11)\n"); return 0; }
    if (a[0] === "install") {
      ctx.err(c("1;31", "error") + ": " + c("1", "externally-managed-environment") + "\n\n" + c("35", "×") + " This environment is externally managed\n" + c("35", "╰─>") + " To install Python packages system-wide, try apt install\n    python3-xyz, where xyz is the package you are trying to\n    install.\n\n" +
        c("2", "(That is what a real Pi says too. Here gpiozero and RPi.GPIO are already installed, and those are the two this lab's Python knows.)") + "\n");
      return 1;
    }
    ctx.out("\nUsage:   \n  pip <command> [options]\n\nCommands:\n  install                     Install packages.\n  list                        List installed packages.\n  freeze                      Output installed packages in requirements format.\n");
    return 0;
  });

  def("nano", "Programs", "nano file", "Edit a file. Ctrl+O saves, Ctrl+X leaves — the two keys everyone asks about.", function* (ctx) {
    var m = ctx.m, name = ctx.args.filter(function (a) { return a.charAt(0) !== "-" && a.charAt(0) !== "+"; })[0];
    if (!ctx.tty || !m.onEdit) { ctx.err(m.onEdit ? "Too many errors from stdin\n" : "Error opening terminal: unknown.\n"); return 1; }
    var abs = name ? ctx.sh.abs(name) : null, n = abs ? ctx.fs.node(abs) : null, done = false;
    if (n instanceof Dir) { ctx.err("[ " + name + " is a directory ]\n"); return 1; }
    m.onEdit({
      name: name || "", path: abs, text: n ? ctx.fs.readNode(n) : "", isNew: !n, readOnly: !!(n && (n.get || n.bin)) || !!(abs && !ctx.fs.mayWrite(abs, ctx.root)),
      /* returns null, or why it could not be written */
      save: function (asName, text) {
        var p = ctx.sh.abs(asName), keepX = ctx.fs.node(p) && ctx.fs.node(p).x, e = ctx.fs.write(p, text, false, ctx.root);
        if (!e && keepX) ctx.fs.node(p).x = true;
        return e;
      },
      close: function () { done = true; }
    });
    try { while (!done) yield 0.05; } catch (e) { if (e !== Py.SIGINT) throw e; }
    return 0;
  }, { pkg: "nano" });
  def("vi vim", "Programs", "nano file", "Not on this Pi. nano is.", function (ctx) { ctx.err("Command '" + ctx.name + "' not found. This Pi keeps things simple: use " + c("1", "nano " + (ctx.args[0] || "file")) + "\n" + c("2", "(Nobody has ever got stuck inside nano.)") + "\n"); return 127; }, { hidden: true });
  def("thonny startx", "Programs", "", "", function (ctx) { ctx.err(ctx.name + ": cannot open display: this Pi is headless — there is no screen plugged into its HDMI socket.\n" + c("2", "Write programs with nano, or with the Files button above the terminal.") + "\n"); return 1; }, { hidden: true });

  /* ------------------------------------------------------------------ apt */

  var PK = OS.PACKAGES = {
    cowsay: { ver: "3.03+dfsg2-8", kb: 20.1, inst: 91.1, desc: "configurable talking cow" },
    "fortune-mod": { ver: "1:1.99.1-7.3", kb: 44.8, inst: 143, desc: "provides fortune cookies on demand" },
    sl: { ver: "5.02-1+b1", kb: 26.4, inst: 60.4, desc: "Correct you if you type `sl' by mistake" },
    cmatrix: { ver: "2.0-3", kb: 17.5, inst: 52.2, desc: "simulates the display from \"The Matrix\"" },
    figlet: { ver: "2.2.5-3+b1", kb: 136, inst: 744, desc: "Make large character ASCII banners out of ordinary text" },
    neofetch: { ver: "7.1.0-4", kb: 93.1, inst: 361, desc: "Shows Linux System Information with Distribution Logo" },
    htop: { ver: "3.2.2-2", kb: 126, inst: 387, desc: "interactive processes viewer" },
    tree: { ver: "2.1.0-1", kb: 49.6, inst: 116, desc: "displays an indented directory tree, in color" },
    nano: { ver: "7.2-1+deb12u1", kb: 678, inst: 2871, desc: "small, friendly text editor inspired by Pico" },
    gpiod: { ver: "1.6.3-1+b3", kb: 23.2, inst: 139, desc: "Tools for interacting with Linux GPIO character device" },
    wiringpi: { ver: "3.10", kb: 52.3, inst: 310, desc: "The wiringPi libraries, headers and gpio command" },
    python3: { ver: "3.11.2-1+b1", kb: 26.3, inst: 91.2, desc: "interactive high-level object-oriented language" },
    "python3-gpiozero": { ver: "2.0.1-0+rpt1", kb: 148, inst: 780, desc: "Simple API for controlling devices attached to a Pi's GPIO pins" },
    "python3-rpi.gpio": { ver: "0.7.1~a4-1+b4", kb: 23.9, inst: 96, desc: "Module to control Raspberry Pi GPIO channels" },
    bc: { ver: "1.07.1-3+b1", kb: 108, inst: 233, desc: "GNU bc arbitrary precision calculator language" },
    apcalc: { ver: "2.14.1.5-1", kb: 337, inst: 1033, desc: "Arbitrary precision calculator (calc): exact fractions, sqrt, sin, ln, pi" }
  };
  OS.PREINSTALLED = { neofetch: 1, htop: 1, tree: 1, nano: 1, gpiod: 1, wiringpi: 1, python3: 1, "python3-gpiozero": 1, "python3-rpi.gpio": 1 };
  OS.SUGGEST = { fortune: "fortune-mod", cowthink: "cowsay", git: null };
  /* Names people type that the mirror files under another name: apt install calc fetches apcalc. */
  var ALIAS = { fortune: "fortune-mod", calc: "apcalc" };
  function pkgName(n) { return ALIAS[n] || n; }
  /* apt sub-commands typed after install — "sudo apt install update" means "sudo apt update". */
  var SUBCMD = { update: 1, upgrade: 1, "full-upgrade": 1, "dist-upgrade": 1, autoremove: 1 };
  function aptLists(ctx) { ctx.out("Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n"); }
  def("apt apt-get", "Programs", "sudo apt install NAME      sudo apt update", "Install and update software. Try: sudo apt install cowsay", function* (ctx) {
    var a = ctx.args.filter(function (x) { return !/^-/.test(x); }), m = ctx.m, os = ctx.os, sub = a[0], names = a.slice(1), i;
    var locked = function () { ctx.err(c("1;31", "E:") + " Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n" + c("1;31", "E:") + " Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n"); return 100; };
    switch (sub) {
      case "update":
        if (!ctx.root) { ctx.err("Reading package lists... Done\n" + c("1;31", "E:") + " Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\n" + c("1;31", "E:") + " Unable to lock directory /var/lib/apt/lists/\n"); return 100; }
        ctx.out("Hit:1 " + os.mirror + " InRelease\n"); yield 0.35;
        ctx.out("Get:2 " + os.mirror2 + " InRelease [48.0 kB]\n"); yield 0.45;
        ctx.out("Get:3 " + os.mirror2 + "/main arm64 Packages [102 kB]\n"); yield 0.4;
        ctx.out("Fetched 151 kB in 1s (126 kB/s)\n"); yield 0.3;
        aptLists(ctx); ctx.out("All packages are up to date.\n");
        return 0;
      case "upgrade": case "full-upgrade": case "dist-upgrade":
        if (!ctx.root) return locked();
        aptLists(ctx); yield 0.4; ctx.out("Calculating upgrade... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n");
        return 0;
      case "install": {
        if (!ctx.root) return locked();
        if (!names.length) { ctx.out("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n"); return 0; }
        aptLists(ctx); yield 0.3;
        var fresh = [];
        for (i = 0; i < names.length; i++) {
          var nm = pkgName(names[i]);
          if (!PK[nm]) {
            ctx.err(c("1;31", "E:") + " Unable to locate package " + names[i] + "\n");
            if (ctx.tty && SUBCMD[names[i]]) ctx.err(c("2", "(" + names[i] + " is an apt command, not a package. Type it without install:  ") + c("1", "sudo apt " + names[i]) + c("2", ")") + "\n");
            else if (i === 0 && ctx.tty) ctx.err(c("2", "(This lab's mirror is small. apt search \"\" lists everything on it.)") + "\n");
            return 100;
          }
          if (m.pkgs[nm]) ctx.out(nm + " is already the newest version (" + PK[nm].ver + ").\n"); else if (fresh.indexOf(nm) < 0) fresh.push(nm);
        }
        if (!fresh.length) { ctx.out("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n"); return 0; }
        var kb = fresh.reduce(function (t, n2) { return t + PK[n2].kb; }, 0), inst = fresh.reduce(function (t, n2) { return t + PK[n2].inst; }, 0);
        ctx.out("The following NEW packages will be installed:\n  " + fresh.join(" ") + "\n0 upgraded, " + fresh.length + " newly installed, 0 to remove and 0 not upgraded.\nNeed to get " + kb.toFixed(1) + " kB of archives.\nAfter this operation, " + inst.toFixed(1) + " kB of additional disk space will be used.\n");
        for (i = 0; i < fresh.length; i++) { yield 0.35; ctx.out("Get:" + (i + 1) + " " + os.mirror + "/main arm64 " + fresh[i] + " arm64 " + PK[fresh[i]].ver + " [" + PK[fresh[i]].kb + " kB]\n"); }
        yield 0.3;
        ctx.out("Fetched " + kb.toFixed(1) + " kB in 0s (" + Math.round(kb * 2.6) + " kB/s)\n");
        for (i = 0; i < fresh.length; i++) {
          var f = fresh[i];
          ctx.out("Selecting previously unselected package " + f + ".\n(Reading database ... ");
          if (ctx.tty) for (var pc = 5; pc <= 100; pc += 19) { ctx.out("\r(Reading database ... " + Math.min(100, pc) + "%"); yield 0.05; }
          ctx.out((ctx.tty ? "\r" : "") + "(Reading database ... " + (131842 + i * 17) + " files and directories currently installed.)\n");
          ctx.out("Preparing to unpack .../" + f + "_" + PK[f].ver.replace(/^\d+:/, "") + "_arm64.deb ...\nUnpacking " + f + " (" + PK[f].ver + ") ...\n"); yield 0.3;
        }
        for (i = 0; i < fresh.length; i++) { ctx.out("Setting up " + fresh[i] + " (" + PK[fresh[i]].ver + ") ...\n"); m.installPkg(fresh[i]); yield 0.2; }
        ctx.out("Processing triggers for man-db (2.11.2-2) ...\n");
        m.changed();
        return 0;
      }
      case "remove": case "purge": case "autoremove": {
        if (!ctx.root) return locked();
        aptLists(ctx);
        names = names.map(pkgName);
        var gone = names.filter(function (n2) { return m.pkgs[n2]; });
        for (i = 0; i < names.length; i++) if (!PK[names[i]]) { ctx.err(c("1;31", "E:") + " Unable to locate package " + names[i] + "\n"); return 100; }
        var keep = gone.filter(function (n2) { return /^(python3|nano|gpiod|python3-gpiozero|python3-rpi\.gpio)$/.test(n2); });
        if (keep.length) { ctx.err(c("1;33", "W:") + " " + keep.join(", ") + " " + (keep.length > 1 ? "are" : "is") + " held by the lab: the lessons need " + (keep.length > 1 ? "them" : "it") + ".\n"); gone = gone.filter(function (n2) { return keep.indexOf(n2) < 0; }); }
        if (!gone.length) { ctx.out("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n"); return 0; }
        ctx.out("The following packages will be REMOVED:\n  " + gone.join(" ") + "\n0 upgraded, 0 newly installed, " + gone.length + " to remove and 0 not upgraded.\n"); yield 0.4;
        gone.forEach(function (n2) { ctx.out("Removing " + n2 + " (" + PK[n2].ver + ") ...\n"); m.removePkg(n2); });
        m.changed();
        return 0;
      }
      case "list": Object.keys(PK).sort().forEach(function (n2) { if (m.pkgs[n2] || !/--installed/.test(ctx.args.join(" "))) ctx.out((ctx.tty ? c("32", n2) : n2) + "/" + (os.id === "ubuntu" ? "noble" : "stable") + " " + PK[n2].ver + " arm64" + (m.pkgs[n2] ? " [installed]" : "") + "\n"); }); return 0;
      case "search": Object.keys(PK).sort().forEach(function (n2) { if (!names[0] || (n2 + " " + PK[n2].desc).toLowerCase().indexOf(names[0].toLowerCase()) >= 0) ctx.out((ctx.tty ? c("32", n2) : n2) + "/" + (os.id === "ubuntu" ? "noble" : "stable") + " " + PK[n2].ver + " arm64" + (m.pkgs[n2] ? " [installed]" : "") + "\n  " + PK[n2].desc + "\n\n"); }); return 0;
      case "show": if (names[0]) names[0] = pkgName(names[0]); if (!PK[names[0]]) { ctx.err(c("1;31", "E:") + " No packages found\n"); return 100; } ctx.out("Package: " + names[0] + "\nVersion: " + PK[names[0]].ver + "\nArchitecture: arm64\nInstalled-Size: " + PK[names[0]].inst + " kB\nDescription: " + PK[names[0]].desc + "\n\n"); return 0;
      case "moo": ctx.out("                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n...\"Have you mooed today?\"...\n"); return 0;
    }
    ctx.out("apt 2.6.1 (arm64)\nUsage: apt [options] command\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n\n                                        This APT has Super Cow Powers.\n");
    return sub ? 1 : 0;
  });
  def("dpkg", "Programs", "dpkg -l", "The list of installed packages.", function (ctx) {
    if (!/-l|--list/.test(ctx.args.join(" "))) { ctx.err("dpkg: error: need an action option — try dpkg -l\n"); return 2; }
    ctx.out("Desired=Unknown/Install/Remove/Purge/Hold\n||/ Name               Version            Architecture Description\n+++-==================-==================-============-=====================================\n");
    Object.keys(PK).sort().forEach(function (n) { if (ctx.m.pkgs[n]) ctx.out("ii  " + pad(n, 18) + " " + pad(PK[n].ver, 18) + " arm64        " + PK[n].desc.slice(0, 44) + "\n"); });
    return 0;
  });

  /* =========================================================== CALCULATORS */

  /* bc and calc. lab_pi_calc.js does the maths; this is the part a terminal
   * sees. Both read any files named, then standard input — piped (echo 2+3 | bc)
   * or typed, a line at a time, until quit or Ctrl+D. */
  var BC_BANNER = "bc 1.07.1\nCopyright 1991-1994, 1997, 1998, 2000, 2004, 2006, 2008, 2012-2017 Free Software Foundation, Inc.\nThis is free software with ABSOLUTELY NO WARRANTY.\nFor details type `warranty'. \n";
  var CALC_BANNER = "C-style arbitrary precision calculator (version 2.14.1.5)\nCalc is open software. For license details type:  help copyright\n[Type \"exit\" to exit, or \"help\" for help.]\n\n";
  var CALC_HELP = "calc: type a sum and press Enter; the answer comes back indented.\n\n" +
    "  2+3*4      1/3      2^100      7//2  (whole-number divide)   7%2  (remainder)\n" +
    "  x = 5      x^2      define sq(n) = n*n;      sq(12)\n\n" +
    "Answers are exact fractions. One that does not end within 20 decimals\nprints rounded, with a ~ in front: 1/3 is ~0.33333333333333333333\n\n" +
    "Functions: sqrt abs round int frac floor ceil  exp ln log log2 root(x,n) power\n" +
    "           sin cos tan asin acos atan pi()  fact gcd lcm isprime max min num den\n\n" +
    "exit or quit leaves (so does Ctrl+D).\n";
  function* calcFeed(ctx, sess, mode, line) {
    var w = line.trim();
    if (mode === "calc" && /^help(\s|$)/.test(w)) { ctx.out(/copyright/.test(w) ? "Calc is open software, under the GNU Lesser General Public License.\n" : CALC_HELP); return null; }
    if (mode === "bc" && w === "warranty") { ctx.out(BC_BANNER.split("\n")[0] + "\nThis program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY.\n"); return null; }
    return yield* sess.feed(line);
  }
  function* calcRun(ctx, sess, mode, files, banner) {
    var i, j, ls;
    for (i = 0; i < files.length; i++) {
      var n = ctx.fs.node(ctx.sh.abs(files[i]));
      if (!n || n instanceof Dir) { ctx.err(mode === "bc" ? "File " + files[i] + " is unavailable.\n" : "calc: cannot open " + files[i] + "\n"); return 1; }
      ls = lines(ctx.fs.readNode(n));
      for (j = 0; j < ls.length; j++) if ((yield* calcFeed(ctx, sess, mode, ls[j])) === "quit") return 0;
    }
    if (ctx.stdin != null || !ctx.tty) {
      ls = lines(yield* ctx.readAll());
      for (j = 0; j < ls.length; j++) if ((yield* calcFeed(ctx, sess, mode, ls[j])) === "quit") return 0;
      if (sess.pending()) ctx.err(mode === "bc" ? "(standard_in) " + sess.line + ": syntax error\n" : "calc: the input stopped part-way through a statement\n");
      return 0;
    }
    if (banner) ctx.out(banner);
    for (;;) {
      if (mode === "calc") ctx.out(sess.pending() ? "  " : "; ");
      try {
        var line = yield* ctx.readLine();
        if (line === false) return 0;
        if ((yield* calcFeed(ctx, sess, mode, line)) === "quit") return 0;
      } catch (e) {
        if (e !== Py.SIGINT) throw e;
        sess.reset();
        ctx.out(mode === "bc" ? "(interrupt) use quit to exit.\n" : "[Abort level 1]\n");
      }
    }
  }
  def("bc", "Programs", "bc [-lq] [file]      echo 'scale=3; 22/7' | bc", "A calculator language. Type a sum, get the answer; scale=N sets how many decimal places division keeps (bc -l: 20, plus s c a l e for sine, cosine, arctan, ln and e^x). quit leaves.", function* (ctx) {
    var p = opts(ctx.args, "lqisvw", "");
    if (p.o.bad) { ctx.err("bc: invalid option -- '" + p.o.bad.charAt(1) + "'\nusage: bc [options] [file ...]\n  -l  --mathlib   use the predefined math routines\n  -q  --quiet     don't print initial banner\n"); return 1; }
    if (p.o.v || p.o.version) { ctx.out(BC_BANNER.split("\n").slice(0, 2).join("\n") + "\n"); return 0; }
    var sess = new Calc.Session("bc", { lib: !!(p.o.l || p.o.mathlib), out: ctx.out, err: ctx.err });
    return yield* calcRun(ctx, sess, "bc", p.rest, p.o.q || p.o.quiet ? "" : BC_BANNER);
  }, { pkg: "bc" });
  def("calc", "Programs", "calc 'sqrt(2)'      calc", "A calculator with exact fractions: calc 1/3*3 is exactly 1. Give it a sum to work out, or no sum for its ; prompt. help lists the functions; exit leaves.", function* (ctx) {
    var a = ctx.args.slice(), pipe = false, files = [];
    while (a.length && /^-[a-zA-Z]/.test(a[0])) {
      var f = a.shift();
      if (f === "-p") pipe = true;
      else if (f === "-f" && a.length) files.push(a.shift());
      else if (!/^-[qdeimuhc]+$/.test(f)) { ctx.err("calc: unknown option " + f + "\nusage: calc [-p] [-q] [-f file] [expression ...]\n"); return 1; }
    }
    var sess = new Calc.Session("calc", { pipe: pipe, out: ctx.out, err: ctx.err });
    if (a.length) {
      var r = yield* calcFeed(ctx, sess, "calc", a.join(" "));
      if (r !== "quit" && sess.pending()) { ctx.err("\"(cmd)\", line 1: the expression stops part-way through\n"); return 1; }
      return sess.errors ? 1 : 0;
    }
    return yield* calcRun(ctx, sess, "calc", files, ctx.tty && ctx.stdin == null ? CALC_BANNER : "");
  }, { pkg: "apcalc" });

  /* ================================================================== FUN */

  function bubble(text, think) {
    var words = text.replace(/\s+/g, " ").trim().split(" "), rows = [], cur = "";
    words.forEach(function (w) { if ((cur + " " + w).trim().length > 38 && cur) { rows.push(cur); cur = w; } else cur = (cur + " " + w).trim(); });
    if (cur || !rows.length) rows.push(cur);
    var w = Math.max.apply(null, rows.map(function (r) { return r.length; })), s = " " + new Array(w + 3).join("_") + "\n";
    rows.forEach(function (r, i) { var e = think ? "()" : rows.length === 1 ? "<>" : i === 0 ? "/\\" : i === rows.length - 1 ? "\\/" : "||"; s += e.charAt(0) + " " + pad(r, w) + " " + e.charAt(1) + "\n"; });
    return s + " " + new Array(w + 3).join("-") + "\n";
  }
  def("cowsay cowthink", "Fun", "cowsay words", "A cow says it. Try: fortune | cowsay", function* (ctx) {
    var p = opts(ctx.args, "bdgpstwy", "ef"), text = p.rest.length ? p.rest.join(" ") : (yield* ctx.readAll()), think = ctx.name === "cowthink", t = think ? "o" : "\\";
    var eyes = p.o.e ? (p.o.e + "oo").slice(0, 2) : p.o.d ? "xx" : p.o.g ? "$$" : p.o.s ? "**" : p.o.t ? "--" : p.o.w ? "OO" : "oo";
    ctx.out(bubble(text || "Moo.", think) + "        " + t + "   ^__^\n         " + t + "  (" + eyes + ")\\_______\n            (__)\\       )\\/\\\n             " + (p.o.d || p.o.s ? "U " : "  ") + " ||----w |\n                ||     ||\n");
    return 0;
  }, { pkg: "cowsay" });
  var COOKIES = [
    "There are 10 kinds of people: those who read binary and those who don't.", "A resistor never complains. It just gets warm.", "Red to plus, black to ground, and check it twice before the power's found.",
    "It works on my bench.", "Have you tried turning it off and on again?", "The long leg of the LED is the one that wants the plus side.", "Linux: because rebooting is for adding hardware.",
    "A loose ground wire explains more mysteries than ghosts do.", "Real programmers count from 0. Everyone else is off by one.", "sudo make me a sandwich.", "3.3 volts is plenty. 5 volts on a GPIO pin is a goodbye.",
    "If at first you don't succeed, read the error message. It is usually telling the truth.", "Every expert was once a beginner who kept typing.", "Measure twice, solder once.", "The pin you forgot to set as an output is the pin that isn't working.",
    "Ctrl+C: for when the loop was more infinite than you meant.", "An SD card unplugged mid-write remembers nothing and forgives nothing.", "Today is a good day to label your wires."
  ];
  def("fortune", "Fun", "fortune", "A short saying, different each time.", function (ctx) { ctx.out(COOKIES[Math.floor(Math.random() * COOKIES.length)] + "\n"); return 0; }, { pkg: "fortune-mod" });
  def("sl", "Fun", "sl", "What you get for mistyping ls.", function* (ctx) {
    var m = ctx.m, W = m.cols, train = ["      ====        ________                ___________ ", "  _D _|  |_______/        \\__I_I_____===__|_________| ", "   |(_)---  |   H\\________/ |   |        =|___ ___|   ", "   /     |  |   H  |  |     |   |         ||_| |_||   ", "  |      |  |   H  |__--------------------| [___] |   ", "  | ________|___H__/__|_____/[][]~\\_______|       |   ", "  |/ |   |-----------I_____I [][] []  D   |=======|__ ", "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ", " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ", "  \\_/      \\O=====O=====O=====O_/      \\_/            "];
    var smoke = ["                 (  ) (@@) ( )  (@)  ()    @@    O     @", "            (@@@)", "        (    )", "     (@@@@)", "   (   )"];
    if (!ctx.tty) return 0;
    ctx.out("\x1b[?1049h");
    try {
      for (var x = W; x > -56; x -= 3) {
        var s = "\x1b[H\x1b[2J" + new Array(Math.max(1, Math.floor((m.rows - 16) / 2))).join("\n");
        smoke.concat(train).forEach(function (row, i) { var shifted = i < 5 && Math.floor(x / 9) % 2 ? " " + row : row, line = x >= 0 ? new Array(x + 1).join(" ") + shifted : shifted.slice(-x); s += line.slice(0, W) + "\n"; });
        ctx.out(s);
        try { yield 0.045; } catch (e) { if (e !== Py.SIGINT) throw e; /* the train does not stop for Ctrl+C. It never has. */ }
      }
    } finally { ctx.out("\x1b[?1049l"); }
    return 0;
  }, { pkg: "sl" });
  def("cmatrix", "Fun", "cmatrix", "Green rain. Press q to leave.", function* (ctx) {
    var m = ctx.m, W = Math.min(m.cols, 100), H = m.rows - 1, drops = [], glyphs = "ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF<>*+=".split("").filter(function (g) { return g.charCodeAt(0) < 256; }), grid = [], x, y;
    if (!ctx.tty) return 1;
    for (y = 0; y < H; y++) { grid.push([]); for (x = 0; x < W; x++) grid[y].push(" "); }
    for (x = 0; x < W; x += 2) drops.push({ x: x, y: -Math.floor(Math.random() * H), len: 4 + Math.floor(Math.random() * 12), on: Math.random() < 0.6 });
    ctx.out("\x1b[?1049h"); m.raw = true;
    try {
      for (;;) {
        drops.forEach(function (d) {
          if (!d.on) { if (Math.random() < 0.03) { d.on = true; d.y = 0; } return; }
          if (d.y >= 0 && d.y < H) grid[d.y][d.x] = glyphs[Math.floor(Math.random() * glyphs.length)];
          var tail = d.y - d.len; if (tail >= 0 && tail < H) grid[tail][d.x] = " ";
          d.y++; if (d.y - d.len > H) { d.on = Math.random() < 0.7; d.y = 0; d.len = 4 + Math.floor(Math.random() * 12); }
        });
        var s = "\x1b[H\x1b[2J";
        for (y = 0; y < H; y++) {
          var row = "";
          for (x = 0; x < W; x++) { var ch = grid[y][x], head = ch !== " " && drops.some(function (d) { return d.x === x && d.y - 1 === y; }); row += ch === " " ? " " : head ? "\x1b[1;97m" + ch + "\x1b[0m" : "\x1b[32m" + ch + "\x1b[0m"; }
          s += row.replace(/ +$/, "") + "\n";
        }
        ctx.out(s);
        if (m.keys.length) { var k = m.keys.shift(); if (k === "q" || k === "Q") return 0; }
        yield 0.08;
      }
    } finally { ctx.out("\x1b[?1049l"); m.raw = false; }
  }, { pkg: "cmatrix" });
  var FIG = { A: [" ## ", "#  #", "####", "#  #", "#  #"], B: ["### ", "#  #", "### ", "#  #", "### "], C: [" ###", "#   ", "#   ", "#   ", " ###"], D: ["### ", "#  #", "#  #", "#  #", "### "], E: ["####", "#   ", "### ", "#   ", "####"], F: ["####", "#   ", "### ", "#   ", "#   "], G: [" ###", "#   ", "# ##", "#  #", " ###"], H: ["#  #", "#  #", "####", "#  #", "#  #"], I: ["###", " # ", " # ", " # ", "###"], J: ["  ##", "   #", "   #", "#  #", " ## "], K: ["#  #", "# # ", "##  ", "# # ", "#  #"], L: ["#   ", "#   ", "#   ", "#   ", "####"], M: ["#   #", "## ##", "# # #", "#   #", "#   #"], N: ["#  #", "## #", "# ##", "#  #", "#  #"], O: [" ## ", "#  #", "#  #", "#  #", " ## "], P: ["### ", "#  #", "### ", "#   ", "#   "], Q: [" ## ", "#  #", "#  #", "# ##", " ###"], R: ["### ", "#  #", "### ", "# # ", "#  #"], S: [" ###", "#   ", " ## ", "   #", "### "], T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "], U: ["#  #", "#  #", "#  #", "#  #", " ## "], V: ["#   #", "#   #", "#   #", " # # ", "  #  "], W: ["#   #", "#   #", "# # #", "## ##", "#   #"], X: ["#  #", "#  #", " ## ", "#  #", "#  #"], Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "], Z: ["####", "   #", " ## ", "#   ", "####"],
    0: [" ## ", "#  #", "#  #", "#  #", " ## "], 1: [" # ", "## ", " # ", " # ", "###"], 2: ["### ", "   #", " ## ", "#   ", "####"], 3: ["### ", "   #", " ## ", "   #", "### "], 4: ["#  #", "#  #", "####", "   #", "   #"], 5: ["####", "#   ", "### ", "   #", "### "], 6: [" ## ", "#   ", "### ", "#  #", " ## "], 7: ["####", "   #", "  # ", " #  ", " #  "], 8: [" ## ", "#  #", " ## ", "#  #", " ## "], 9: [" ## ", "#  #", " ###", "   #", " ## "],
    " ": ["  ", "  ", "  ", "  ", "  "], "!": ["#", "#", "#", " ", "#"], "?": ["### ", "   #", " ## ", "    ", " #  "], ".": [" ", " ", " ", " ", "#"], "-": ["   ", "   ", "###", "   ", "   "], ":": [" ", "#", " ", "#", " "] };
  def("figlet", "Fun", "figlet words", "Big letters made of small ones.", function* (ctx) {
    var text = (ctx.args.length ? ctx.args.join(" ") : (yield* ctx.readAll()).trim()).toUpperCase().slice(0, 18), rows = ["", "", "", "", ""];
    text.split("").forEach(function (ch) { var g = FIG[ch] || FIG["?"]; for (var i = 0; i < 5; i++) rows[i] += g[i] + " "; });
    ctx.out(rows.map(function (r) { return r.replace(/ +$/, ""); }).join("\n") + "\n\n");
    return 0;
  }, { pkg: "figlet" });

  /* ================================================================= HELP */

  var GROUPS = ["GPIO", "Programs", "Files", "Text", "System", "Shell", "Fun"];
  def("help", "Shell", "help [command]", "This list — or help NAME for one command.", function (ctx) {
    var sh = ctx.sh, name = ctx.args[0];
    if (name) return manual(ctx, name, false);
    var s = c("1", ctx.os.name + " on a " + OS.MODEL) + c("2", "  ·  simulated in the Circuit Lab") + "\n\n";
    GROUPS.forEach(function (g) {
      var names = Object.keys(CMDS).filter(function (n) { var d = CMDS[n]; return d.group === g && !d.hidden && d.name === n && (sh.has(n) || d.pkg) && (!d.only || d.only.indexOf(ctx.os.id) >= 0) && !/^(:|\[\[|\.|logout|apt-get|printenv|python|pip3|more|reset|pkill|poweroff|halt|sh|type|command|cowthink)$/.test(n); }).sort();
      if (!names.length) return;
      var line = "", block = "";
      names.forEach(function (n) { var shown = sh.has(n) ? n : c("2", n + "*"), len = n.length + (sh.has(n) ? 0 : 1); if (line.replace(/\x1b\[[0-9;]*m/g, "").length + len + 2 > ctx.m.cols - 12) { block += line.replace(/ +$/, "") + "\n" + new Array(11).join(" "); line = ""; } line += shown + "  "; });
      s += c("1;" + (g === "GPIO" ? "33" : g === "Fun" ? "35" : "36"), pad(g, 10)) + block + line.replace(/ +$/, "") + "\n";
    });
    s += "\n" + c("2", "  * not installed yet: sudo apt install NAME") + "\n\n" +
      "First things to try:\n" +
      "  " + c("1", "pinout") + "                      which pin is which\n" +
      "  " + (sh.has("pinctrl") ? c("1", "pinctrl set 17 op dh") + "        light an LED on GPIO17 (dl puts it out)\n" : c("1", "gpioset gpiochip0 17=1") + "      light an LED on GPIO17 (=0 puts it out)\n") +
      "  " + c("1", "ls") + " then " + c("1", "python3 blink.py") + "    run a program from your home folder\n" +
      "  " + c("1", "nano blink.py") + "               change it   (Ctrl+O saves, Ctrl+X leaves)\n" +
      "  " + c("1", "help ls") + " or " + c("1", "man ls") + "           what a command does\n" +
      c("2", "Keys: ↑ ↓ earlier commands · Tab finishes a name · Ctrl+C stops a program · Ctrl+L clears") + "\n";
    ctx.out(ctx.tty ? s : s.replace(/\x1b\[[0-9;]*m/g, ""));
    return 0;
  }, { builtin: true });
  function manual(ctx, name, page) {
    var d = CMDS[name];
    if (!d || d.hidden) { ctx.err(page ? "No manual entry for " + name + "\n" : "-bash: help: no help topics match `" + name + "'.  Try `help' on its own.\n"); return page ? 16 : 1; }
    var b = ctx.tty ? function (s) { return c("1", s); } : function (s) { return s; };
    if (!page) { ctx.out(b(d.usage || name) + "\n    " + d.help + "\n" + (d.pkg && !ctx.sh.has(name) ? "    Not installed yet: sudo apt install " + d.pkg + "\n" : "")); return 0; }
    ctx.out(pad(name.toUpperCase() + "(1)", 30) + "User Commands" + lpad(name.toUpperCase() + "(1)", 30) + "\n\n" + b("NAME") + "\n       " + name + " - " + d.help.split(". ")[0].replace(/\.$/, "").replace(/^./, function (x) { return x.toLowerCase(); }) + "\n\n" + b("SYNOPSIS") + "\n       " + (d.usage || name).split(/ {3,}/).join("\n       ") + "\n\n" + b("DESCRIPTION") + "\n       " + d.help.replace(/(.{1,66})(\s|$)/g, "$1\n       ").trim() + "\n\n" +
      (d.pkg ? b("PACKAGE") + "\n       " + d.pkg + (ctx.sh.has(name) ? " (installed)" : " — sudo apt install " + d.pkg) + "\n\n" : "") + pad(ctx.os.name, 30) + strf("%B %Y", date(ctx.m)) + lpad(name.toUpperCase() + "(1)", 34) + "\n");
    return 0;
  }
  def("man", "Shell", "man command", "The manual page for a command.", function (ctx) {
    if (!ctx.args.length) { ctx.out("What manual page do you want?\nFor example, try 'man man'.\n"); return 1; }
    return manual(ctx, ctx.args[ctx.args.length - 1], true);
  });

  /* What a brand-new card has on it: enough to light an LED in the first minute. */
  OS.starterSD = function () {
    return OS.makeSD({
      "README.txt": "Welcome to your Raspberry Pi.\n\nThis is its SD card. Whatever you keep in this folder is saved with\nyour circuit, so it is still here next lesson.\n\n  ls                  see what is here\n  cat blink.py        read a program\n  python3 blink.py    run it          (Ctrl+C stops it)\n  nano blink.py       change it       (Ctrl+O saves, Ctrl+X leaves)\n  pinout              which pin is which\n  help                everything this Pi can do\n\nblink.py expects an LED on GPIO17 (pin 11): GPIO17 -> 220 ohm resistor\n-> LED long leg, LED short leg -> any GND pin.\n",
      "blink.py": "from gpiozero import LED\nfrom time import sleep\n\nled = LED(17)          # GPIO17 is pin 11 on the header\n\nwhile True:\n    led.on()\n    sleep(0.5)\n    led.off()\n    sleep(0.5)\n"
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
