"""Slide videos: upload, stable link, the screen copy (real ffmpeg, small clips)."""

import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings

from hanns import video as hv
from hanns.models import Deck

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _clip(path, size, vcodec, acodec, secs=2, rate=25, extra=()):
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate={rate}",
           "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", str(secs),
           "-c:v", vcodec, *extra, "-c:a", acodec, path]
    subprocess.run(cmd, check=True, capture_output=True)
    with open(path, "rb") as f:
        return f.read()


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg not installed")
class VideoTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.mkdtemp()
        # "too big" for this test = above 320×180, so a 640×360 clip takes the 4K path
        cls.big = _clip(os.path.join(cls.tmp, "big.webm"), "640x360", "libvpx-vp9", "libopus",
                        extra=("-deadline", "realtime", "-cpu-used", "8"))
        cls.fine = _clip(os.path.join(cls.tmp, "fine.mp4"), "320x180", "libx264", "aac",
                         extra=("-pix_fmt", "yuv420p", "-b:v", "300k"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.o = override_settings(MEDIA_ROOT=self.media, HANNS_VIDEO_MAX_WIDTH=320, HANNS_VIDEO_MAX_HEIGHT=180,
                                   STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
        self.o.enable()
        U = get_user_model()
        self.owner = U.objects.create_user("v-owner", password="pw-pw-pw-123")
        self.deck = Deck.objects.create(owner=self.owner, code="VIDS01", title="Clips")
        self.client.force_login(self.owner)
        hv.heartbeat()                          # pretend a worker is up: tests call the worker themselves

    def tearDown(self):
        self.o.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def _upload(self, data, name="clip.webm", ctype="video/webm"):
        return self.client.post("/hanns/VIDS01/video-upload/", {"video": SimpleUploadedFile(name, data, content_type=ctype)})

    def test_upload_rules(self):
        self.client.logout()
        self.assertEqual(self._upload(self.big).status_code, 302)                     # sign in first
        stranger = get_user_model().objects.create_user("v-stranger", password="pw-pw-pw-123")
        self.client.force_login(stranger)
        self.assertIn(self._upload(self.big).status_code, (403, 404))                 # not their deck
        self.client.force_login(self.owner)
        self.assertEqual(self._upload(b"hello", "notes.txt", "text/plain").status_code, 400)
        with override_settings(HANNS_VIDEO_UPLOAD_MAX_SIZE=1000):
            self.assertEqual(self._upload(self.big).status_code, 413)
        self.assertContains(self.client.get(f"/hanns/{self.deck.code}/edit/"), "/hanns/VIDS01/video-upload/")   # editor knows

    def test_big_video_gets_a_screen_copy(self):
        r = self._upload(self.big)
        self.assertEqual(r.status_code, 200, r.content)
        j = r.json()
        vid, url = j["id"], j["url"]
        self.assertEqual(url, f"/hanns/video/{vid}/")
        self.assertEqual(j["status"]["status"], "queued")
        # until it's converted, the stable link plays the original
        play = self.client.get(url)
        self.assertEqual(play.status_code, 302)
        self.assertTrue(play["Location"].endswith("/original.webm"))
        self.assertEqual(play["Cache-Control"], "no-store")
        meta = hv.process_one(vid)
        self.assertEqual(meta["status"], "ready", meta.get("error"))
        self.assertTrue(meta["reasons"])                                                # why it was converted
        out = hv.probe(os.path.join(self.media, meta["screen"]))
        self.assertEqual((out["codec"], out["width"], out["height"]), ("h264", 320, 180))   # 640×360 → 320×180
        with open(os.path.join(self.media, meta["screen"]), "rb") as f:
            head = f.read(4096)
        self.assertLess(head.find(b"moov"), head.find(b"mdat") if b"mdat" in head else 10 ** 9)   # faststart
        self.assertTrue(self.client.get(url)["Location"].endswith("/screen.mp4"))       # now plays the copy
        st = self.client.get(f"/hanns/video/{vid}/status/").json()
        self.assertEqual((st["status"], st["playing"], st["screen"]["width"]), ("ready", "screen copy", 320))
        self.assertEqual(self.client.get(f"/hanns/video/{vid}/poster/").status_code, 302)
        self.assertIsNone(hv.process_one(vid))                                          # already done: no rework

    def test_light_video_is_left_alone(self):
        vid = self._upload(self.fine, "fine.mp4", "video/mp4").json()["id"]
        meta = hv.process_one(vid)
        self.assertEqual((meta["status"], meta["screen"]), ("ready", None))
        self.assertTrue(self.client.get(f"/hanns/video/{vid}/")["Location"].endswith("/original.mp4"))

    def test_broken_file_keeps_playing_the_original(self):
        vid = self._upload(b"\x00not a video" * 500, "broken.mp4", "video/mp4").json()["id"]
        meta = hv.process_one(vid)
        self.assertEqual(meta["status"], "failed")
        self.assertTrue(meta["error"])
        self.assertTrue(self.client.get(f"/hanns/video/{vid}/")["Location"].endswith("/original.mp4"))
        self.assertFalse(os.path.exists(os.path.join(self.media, f"hanns/decks/VIDS01/videos/{vid}/screen.part.mp4")))

    def test_worker_command_and_stale_jobs(self):
        a = self._upload(self.big).json()["id"]
        b = self._upload(self.fine, "fine.mp4", "video/mp4").json()["id"]
        # a job a dead worker left half-way gets put back
        os.rename(os.path.join(self.media, hv.QUEUE_DIR, b), os.path.join(self.media, hv.QUEUE_DIR, b + ".working"))
        old = time.time() - 4 * 3600
        os.utime(os.path.join(self.media, hv.QUEUE_DIR, b + ".working"), (old, old))
        m = hv.read_meta(b); m["updated"] = old; hv._write_meta(m)
        self.assertEqual(hv.requeue_stale(), 1)
        call_command("hanns_video_worker", "--once", stdout=open(os.devnull, "w"))
        self.assertEqual(hv.read_meta(a)["status"], "ready")
        self.assertEqual(hv.read_meta(b)["status"], "ready")
        self.assertEqual(hv.pending(), [])

    def test_no_worker_converts_in_the_background(self):
        os.remove(os.path.join(self.media, hv.HEARTBEAT))                               # nobody's watching the queue
        vid = self._upload(self.big).json()["id"]
        for _ in range(120):
            if hv.read_meta(vid)["status"] in ("ready", "failed"):
                break
            time.sleep(0.25)
        self.assertEqual(hv.read_meta(vid)["status"], "ready")

    def test_unknown_ids(self):
        self.assertEqual(self.client.get("/hanns/video/" + "0" * 32 + "/").status_code, 404)
        self.assertEqual(self.client.get("/hanns/video/../../etc/").status_code, 404)
        self.assertIsNone(hv.read_meta("../../etc/passwd"))

    def test_interrupted_job_restarts_when_looked_at(self):
        """The web process restarted mid-conversion and no worker runs: the editor's
        status check puts the job back and converts it."""
        vid = self._upload(self.big).json()["id"]
        q = os.path.join(self.media, hv.QUEUE_DIR)
        os.rename(os.path.join(q, vid), os.path.join(q, vid + ".working"))
        m = hv.read_meta(vid); m.update(status="converting", progress=24, updated=time.time() - 3600); hv._write_meta(m)
        os.utime(os.path.join(q, vid + ".working"), (time.time() - 3600,) * 2)
        os.remove(os.path.join(self.media, hv.HEARTBEAT))
        self.client.get(f"/hanns/video/{vid}/status/")
        for _ in range(120):
            if hv.read_meta(vid)["status"] == "ready":
                break
            time.sleep(0.25)
        self.assertEqual(hv.read_meta(vid)["status"], "ready")
        # a job that's merely busy (fresh progress) is left alone
        hv.heartbeat()                          # a worker again: this upload mustn't start its own thread
        vid2 = self._upload(self.fine, "fine.mp4", "video/mp4").json()["id"]
        os.rename(os.path.join(q, vid2), os.path.join(q, vid2 + ".working"))
        self.assertEqual(hv.requeue_stale(only=vid2), 0)

