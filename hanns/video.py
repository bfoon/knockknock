"""Hanns · slide videos: upload, then a projector-friendly copy made in the background.

Why: a slide video is decoded at its own resolution. A 4K (or HEVC, or 40 Mbit/s)
file plays fine on a fast desktop and stutters on the laptop driving a projector —
picture breaks, sound carries on. So every uploaded video gets a "screen copy":
H.264 / AAC in an MP4, at most 1920×1080, sensible bitrate, `faststart` — the format
nearly every laptop decodes in hardware and every browser plays.

How it hangs together (no new table, so no migration to run):

  media/hanns/decks/<CODE>/videos/<id>/
      original.<ext>     what was uploaded — never changed
      screen.mp4         the screen copy (when one was needed)
      poster.jpg         a frame for the <video poster>
      meta.json          status: queued → converting (progress) → ready | failed
  media/hanns/video-queue/<id>         a job marker; the worker claims it by rename
  media/hanns/video-queue/.worker      the worker's heartbeat

The slide stores a STABLE link, /hanns/video/<id>/ . That view redirects to the
screen copy when it's ready and to the original until then (or if conversion
failed), so slide JSON never changes — no race with an editor that's open and
autosaving, and the deck simply gets lighter by itself.

The worker is `python manage.py hanns_video_worker` (its own compose service).
If no worker has been seen recently, an upload converts in a background thread
instead, so it still works before that service is added.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import uuid

from django.conf import settings
from django.core.files.storage import default_storage

log = logging.getLogger(__name__)

ALLOWED_EXTS = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".mpg", ".mpeg", ".ogv", ".3gp"}
QUEUE_DIR = "hanns/video-queue"
HEARTBEAT = QUEUE_DIR + "/.worker"
ID_RE = re.compile(r"^[0-9a-f]{32}$")


def _setting(name, default):
    return getattr(settings, name, default)


def max_upload_bytes():
    return int(_setting("HANNS_VIDEO_UPLOAD_MAX_SIZE", 1024 * 1024 * 1024))     # 1 GB


def max_w():
    return int(_setting("HANNS_VIDEO_MAX_WIDTH", 1920))


def max_h():
    return int(_setting("HANNS_VIDEO_MAX_HEIGHT", 1080))


def max_bitrate():
    return int(_setting("HANNS_VIDEO_MAX_BITRATE", 12_000_000))                  # bits/s, whole file


def ffmpeg_bin():
    return _setting("HANNS_FFMPEG", "ffmpeg")


def ffprobe_bin():
    return _setting("HANNS_FFPROBE", "ffprobe")


def available():
    """Conversion needs ffmpeg/ffprobe and local-disk media (ffmpeg reads paths)."""
    try:
        default_storage.path("x")
    except NotImplementedError:
        return False
    return bool(shutil.which(ffmpeg_bin()) and shutil.which(ffprobe_bin()))


# ── paths & meta ──────────────────────────────────────────────────────
def _dir(deck_code, vid):
    return f"hanns/decks/{deck_code}/videos/{vid}"


def _abs(rel):
    return default_storage.path(rel)


def _media_url(rel):
    url = default_storage.url(rel)
    if not url.startswith(("http://", "https://", "//")):
        url = url if url.startswith("/") else "/" + url
    return url


def play_url(vid):
    return f"/hanns/video/{vid}/"


def read_meta(vid):
    """meta.json for video <vid>, or None. Found through the queue-independent index."""
    if not ID_RE.match(str(vid or "")):
        return None
    idx = f"{QUEUE_DIR}/index/{vid}"
    try:
        with default_storage.open(idx) as f:
            deck_code = f.read().decode().strip()
        with default_storage.open(_dir(deck_code, vid) + "/meta.json") as f:
            return json.loads(f.read().decode())
    except Exception:
        return None


def _write_meta(meta):
    rel = _dir(meta["deck"], meta["id"]) + "/meta.json"
    path = _abs(rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(meta, f)
    os.replace(tmp, path)                       # atomic: readers never see half a file


def _update(meta, **kw):
    meta.update(kw)
    meta["updated"] = time.time()
    _write_meta(meta)
    return meta


# ── upload ────────────────────────────────────────────────────────────
def store_upload(deck_code, upload):
    """Save the uploaded file as an original, queue a screen copy, return meta."""
    name = os.path.basename(getattr(upload, "name", "") or "video")
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXTS:
        ext = ".mp4"
    vid = uuid.uuid4().hex
    rel = _dir(deck_code, vid) + "/original" + ext
    saved = default_storage.save(rel, upload)
    meta = {"id": vid, "deck": deck_code, "name": name[:120], "original": saved,
            "screen": None, "poster": None, "status": "queued", "progress": 0,
            "error": "", "info": {}, "created": time.time(), "updated": time.time()}
    _write_meta(meta)
    for d in (QUEUE_DIR, QUEUE_DIR + "/index"):
        os.makedirs(_abs(d), exist_ok=True)
    with open(_abs(f"{QUEUE_DIR}/index/{vid}"), "w") as f:
        f.write(deck_code)
    with open(_abs(f"{QUEUE_DIR}/{vid}"), "w") as f:
        f.write(deck_code)
    return meta


def worker_alive(window=90):
    try:
        return time.time() - os.path.getmtime(_abs(HEARTBEAT)) < window
    except OSError:
        return False


def heartbeat():
    os.makedirs(_abs(QUEUE_DIR), exist_ok=True)
    with open(_abs(HEARTBEAT), "w") as f:
        f.write(str(time.time()))


def kick_inline(vid):
    """No worker around: convert this one in a background thread (low priority)."""
    t = threading.Thread(target=process_one, args=(vid,), name=f"hanns-video-{vid[:8]}", daemon=True)
    t.start()
    return t


# ── probing & deciding ────────────────────────────────────────────────
def probe(path):
    out = subprocess.run(
        [ffprobe_bin(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, timeout=120, check=True).stdout
    j = json.loads(out or b"{}")
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in j.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        raise ValueError("No video stream in this file.")
    fmt = j.get("format", {})
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = abs(int(float(sd["rotation"]))) % 180
    rot = rot or (abs(int(float((v.get("tags") or {}).get("rotate", 0) or 0))) % 180)
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    if rot == 90:
        w, h = h, w                               # what the viewer sees
    def _rate(s):
        try:
            n, d = str(s or "0/1").split("/")
            return float(n) / float(d or 1)
        except (ValueError, ZeroDivisionError):
            return 0.0
    return {
        "width": w, "height": h, "codec": v.get("codec_name") or "", "pix_fmt": v.get("pix_fmt") or "",
        "fps": round(_rate(v.get("avg_frame_rate") or v.get("r_frame_rate")), 3),
        "audio": (a or {}).get("codec_name") or "",
        "duration": float(fmt.get("duration") or v.get("duration") or 0),
        "bitrate": int(fmt.get("bit_rate") or 0),
        "container": fmt.get("format_name") or "",
    }


def needs_screen_copy(info, original_name=""):
    """Reasons a file would struggle on a projector laptop (empty list = fine as is)."""
    why = []
    big_w, big_h = (max_w(), max_h()) if info["width"] >= info["height"] else (max_h(), max_w())
    if info["width"] > big_w or info["height"] > big_h:
        why.append(f"{info['width']}×{info['height']} is larger than {big_w}×{big_h}")
    if info["codec"] != "h264":
        why.append(f"{info['codec'] or 'unknown'} video isn't decoded in hardware everywhere")
    if info["pix_fmt"] not in ("yuv420p", "yuvj420p"):
        why.append(f"{info['pix_fmt'] or 'unknown'} colour format")
    if info["bitrate"] and info["bitrate"] > max_bitrate():
        why.append(f"{info['bitrate'] // 1_000_000} Mbit/s is heavy")
    if info["fps"] > 61:
        why.append(f"{info['fps']:.0f} fps")
    if info["audio"] not in ("", "aac", "mp3"):
        why.append(f"{info['audio']} audio")
    if "mp4" not in info["container"] and "mov" not in info["container"]:
        why.append("not an MP4")
    return why


# ── converting ────────────────────────────────────────────────────────
def _ffmpeg_args(src, dst, info):
    big_w, big_h = (max_w(), max_h()) if info["width"] >= info["height"] else (max_h(), max_w())
    vf = [f"scale='min({big_w},iw)':'min({big_h},ih)':force_original_aspect_ratio=decrease",
          "scale=trunc(iw/2)*2:trunc(ih/2)*2"]           # H.264 needs even sides
    if info["fps"] > 61:
        vf.append("fps=60")
    args = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-i", src,
            "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", ",".join(vf),
            "-c:v", "libx264", "-preset", _setting("HANNS_VIDEO_PRESET", "veryfast"), "-crf", "22",
            "-maxrate", "8M", "-bufsize", "16M", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ac", "2",
            "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", dst]
    if os.name == "posix" and shutil.which("nice"):
        args = ["nice", "-n", "15"] + args                # the website stays responsive
    return args


def _poster(src, dst, duration):
    at = min(1.0, max(0.0, duration / 3)) if duration else 0
    subprocess.run([ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-ss", f"{at:.2f}", "-i", src,
                    "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", dst],
                   capture_output=True, timeout=120, check=True)


def _claim(vid):
    """Take the job marker atomically, so a worker and an inline thread never both convert."""
    src, dst = _abs(f"{QUEUE_DIR}/{vid}"), _abs(f"{QUEUE_DIR}/{vid}.working")
    try:
        os.rename(src, dst)
        return dst
    except OSError:
        return None


def process_one(vid):
    """Convert one queued video. Never raises: failures are written to meta."""
    claim = _claim(vid)
    if not claim:
        return None                                       # someone else has it, or it's done
    meta = read_meta(vid)
    if not meta:
        _drop(claim)
        return None
    src = _abs(meta["original"])
    try:
        info = probe(src)
        _update(meta, status="converting", progress=0, info=info)
        base = os.path.dirname(src)
        try:
            _poster(src, os.path.join(base, "poster.jpg"), info["duration"])
            meta["poster"] = _dir(meta["deck"], vid) + "/poster.jpg"
        except Exception:
            log.info("Hanns video %s: no poster frame", vid)
        why = needs_screen_copy(info, meta.get("name", ""))
        if not why:
            return _update(meta, status="ready", progress=100, screen=None, reasons=[])
        tmp = os.path.join(base, "screen.part.mp4")
        timeout = max(600, info["duration"] * 6 + 300)
        p = subprocess.Popen(_ffmpeg_args(src, tmp, info), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        started, last = time.time(), 0
        for line in p.stdout:                             # "-progress pipe:1": key=value lines
            if time.time() - started > timeout:
                p.kill()
                raise RuntimeError("Conversion took too long.")
            if line.startswith("out_time_us=") and info["duration"]:
                try:
                    pct = min(99, int(int(line.split("=")[1]) / 1e6 / info["duration"] * 100))
                except ValueError:
                    continue
                if pct >= last + 3:
                    last = pct
                    _update(meta, progress=pct)
        err = p.stderr.read()[-800:]
        if p.wait() != 0:
            raise RuntimeError("ffmpeg: " + (err.strip().splitlines() or ["failed"])[-1])
        out = probe(tmp)                                  # check what we made before using it
        if out["codec"] != "h264" or not out["width"]:
            raise RuntimeError("The converted file didn't check out.")
        final = os.path.join(base, "screen.mp4")
        os.replace(tmp, final)
        return _update(meta, status="ready", progress=100, screen=_dir(meta["deck"], vid) + "/screen.mp4",
                       reasons=why, screen_info={k: out[k] for k in ("width", "height", "codec", "bitrate")})
    except Exception as e:
        log.warning("Hanns video %s failed: %s", vid, e)
        for leftover in ("screen.part.mp4",):
            try:
                os.remove(os.path.join(os.path.dirname(src), leftover))
            except OSError:
                pass
        return _update(meta, status="failed", error=str(e)[:300])
    finally:
        _drop(claim)


def _drop(path):
    try:
        os.remove(path)
    except OSError:
        pass


def pending():
    """Queued ids, oldest first."""
    try:
        names = os.listdir(_abs(QUEUE_DIR))
    except OSError:
        return []
    ids = [n for n in names if ID_RE.match(n)]
    return sorted(ids, key=lambda n: os.path.getmtime(_abs(f"{QUEUE_DIR}/{n}")))


STALE_AFTER = 600      # a conversion writes progress every few %; 10 min of silence = it died


def _stale(vid, older_than):
    meta = read_meta(vid) or {}
    last = meta.get("updated") or 0
    try:
        last = max(last, os.path.getmtime(_abs(f"{QUEUE_DIR}/{vid}.working")))
    except OSError:
        pass
    return time.time() - last > older_than


def requeue_stale(older_than=STALE_AFTER, only=None):
    """A worker or web process that stopped mid-job (restart, deploy, crash) leaves
    '<id>.working' and a meta stuck on "converting": put it back in the queue."""
    try:
        names = os.listdir(_abs(QUEUE_DIR))
    except OSError:
        return 0
    n = 0
    for name in names:
        vid = name[:-8]
        if not (name.endswith(".working") and ID_RE.match(vid)) or (only and vid != only):
            continue
        if _stale(vid, older_than):
            p = _abs(f"{QUEUE_DIR}/{name}")
            try:
                os.rename(p, p[:-8])
                n += 1
                meta = read_meta(vid)
                if meta:
                    _update(meta, status="queued", progress=0)
            except OSError:
                pass
    return n


def revive(vid):
    """Called when someone looks at a video's status: if its job was abandoned and
    no worker is around to pick it up, restart it here in the background."""
    if requeue_stale(only=vid) and not worker_alive():
        kick_inline(vid)


# ── serving ───────────────────────────────────────────────────────────
def best_url(meta):
    """What a slide should play right now."""
    if meta.get("status") == "ready" and meta.get("screen"):
        return _media_url(meta["screen"])
    return _media_url(meta["original"])


def public_status(meta):
    return {
        "id": meta["id"], "status": meta["status"], "progress": meta.get("progress", 0),
        "error": meta.get("error", ""), "reasons": meta.get("reasons", []),
        "playing": "screen copy" if (meta.get("status") == "ready" and meta.get("screen")) else "original",
        "original": {k: meta.get("info", {}).get(k) for k in ("width", "height", "codec", "bitrate", "fps")},
        "screen": meta.get("screen_info") or None,
        "poster": f"/hanns/video/{meta['id']}/poster/" if meta.get("poster") else "",
    }
