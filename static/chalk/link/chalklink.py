"""chalklink — talk to a Chalk Link from a real Raspberry Pi (or any Python).

A Chalk Link is a small table of named values ("tags") behind a web address.
The Circuit Lab's simulation, your own software and this program all read
and write the same tags, so a real project can report to — and be driven
by — anything else that holds the address.

    from chalklink import Link

    link = Link("https://your.site/chalk/api/link/ck_…/")   # or set CHALK_LINK
    link.send("temperature", 21.5)        # publish a value
    if link.get("lamp", False):           # read one (False until somebody sets it)
        ...
    link.when_changed("lamp", lambda on: led.on() if on else led.off())
    link.wait_for("door", "open", timeout=30)

The same four calls exist on the lab's simulated Pi, where Link() needs no
address. Write the program there, then copy it here unchanged.

Nothing to install: it uses only Python's standard library. Reads are
polled a few times a second and cached, so calling get() in a tight loop
does not flood the server.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

__all__ = ["Link"]


class Link:
    def __init__(self, url=None, name="pi", poll=0.4, timeout=5):
        url = url or os.environ.get("CHALK_LINK")
        if not url:
            raise ValueError("Link needs the link's address: Link('https://…/chalk/api/link/ck_…/') or set CHALK_LINK")
        self.url = url.rstrip("/") + "/"
        self.name = name                # shows up as "by" next to everything this program writes
        self.poll = poll
        self.timeout = timeout
        self.online = False
        self._tags = {}
        self._seq = 0
        self._at = 0.0
        self._lock = threading.Lock()
        self._watch = []
        self._thread = None

    # -- plumbing ----------------------------------------------------------

    def _call(self, path, data=None):
        req = urllib.request.Request(self.url + path, headers={"Content-Type": "application/json", "X-Chalk-By": self.name})
        if data is not None:
            req.data = json.dumps(data).encode()
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode() or "{}")

    def _refresh(self, force=False):
        with self._lock:
            if not force and time.monotonic() - self._at < self.poll:
                return
            self._at = time.monotonic()
            try:
                got = self._call("tags/?since=%d" % self._seq)
                for name, tag in got.get("tags", {}).items():
                    self._tags[name] = tag.get("value")
                self._seq = got.get("seq", self._seq)
                self.online = True
            except (urllib.error.URLError, OSError, ValueError):
                self.online = False

    # -- the four calls ----------------------------------------------------

    def send(self, name, value):
        """Publish a value: a number, True/False, a short string or None."""
        name = str(name).lower()
        try:
            self._call("tags/", {"values": {name: value}, "by": self.name})
            self.online = True
        except (urllib.error.URLError, OSError, ValueError):
            self.online = False
        with self._lock:
            self._tags[name] = value

    set = send

    def get(self, name, default=None):
        """The latest value of a tag, or `default` if nobody has set it."""
        self._refresh()
        return self._tags.get(str(name).lower(), default)

    def all(self):
        self._refresh()
        return dict(self._tags)

    def wait_for(self, name, value=None, timeout=None):
        """Wait until a tag changes — or, given a value, until it equals it.
        Returns the tag's value, or None if the time ran out."""
        name = str(name).lower()
        first, start = self.get(name), time.monotonic()
        while True:
            now = self.get(name)
            if (now == value and now is not None) if value is not None else now != first:
                return now
            if timeout is not None and time.monotonic() - start >= timeout:
                return None
            time.sleep(self.poll)

    def when_changed(self, name, callback):
        """Call callback(value) every time a tag changes."""
        self._watch.append([str(name).lower(), callback, self.get(name)])
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def _loop(self):
        while True:
            time.sleep(self.poll)
            self._refresh(force=True)
            for w in self._watch:
                now = self._tags.get(w[0])
                if now != w[2]:
                    w[2] = now
                    try:
                        w[1](now)
                    except TypeError:
                        w[1]()

    def close(self):
        pass

    def __repr__(self):
        return "<chalklink.Link %s>" % ("online" if self.online else "offline")
