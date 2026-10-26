import io
import json
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from hanns import screen as svc
from hanns.models import BigScreen

from .models import ScreenBackdrop

TMP = tempfile.mkdtemp(prefix="screenart-test-")


def jpeg(w=1200, h=675, color=(200, 80, 30), gps=False):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    kw = {}
    if gps:
        exif = Image.Exif()
        exif[0x8825] = {1: "N", 2: (13.0, 27.0, 0.0)}      # GPSInfo — a location we must not keep
        exif[0x010F] = "PhoneMaker"
        kw["exif"] = exif
    img.save(buf, "JPEG", **kw)
    return SimpleUploadedFile("poster.jpg", buf.getvalue(), content_type="image/jpeg")


def png_alpha():
    img = Image.new("RGBA", (800, 450), (0, 0, 0, 0))
    buf = io.BytesIO(); img.save(buf, "PNG")
    return SimpleUploadedFile("logo.png", buf.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=TMP)
class EventBackgroundTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP, ignore_errors=True)

    def setUp(self):
        self.host = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.screen = BigScreen.objects.create(owner=self.host, name="Youth Summit")
        self.base = f"/screenart/s/{self.screen.token}/"

    def upload(self, *files):
        return self.client.post(self.base + "upload/", {"file": list(files)})

    def settings(self, **patch):
        return self.client.post(self.base + "settings/", json.dumps(patch), content_type="application/json")

    def test_upload_shows_in_the_screen_state(self):
        r = self.upload(jpeg())
        self.assertEqual(r.status_code, 200, r.content)
        bd = r.json()["state"]["backdrop"]
        self.assertEqual(len(bd["images"]), 1)
        self.assertEqual(bd["active"], bd["images"][0]["id"])     # first upload becomes the background
        self.assertTrue(bd["lobby"])
        self.assertFalse(bd["show"])
        self.assertEqual(svc.screen_state(self.screen)["backdrop"]["images"][0]["url"], bd["images"][0]["url"])

    def test_big_photos_are_downscaled_and_lose_their_gps(self):
        self.upload(jpeg(6000, 3375, gps=True))
        b = ScreenBackdrop.objects.get()
        self.assertEqual((b.width, b.height), (3840, 2160))
        with default_storage.open(b.image.name) as fh:
            img = Image.open(fh)
            img.load()
            self.assertEqual(img.size, (3840, 2160))
            self.assertNotIn(0x8825, img.getexif())                 # GPS gone
            self.assertNotIn(0x010F, img.getexif())

    def test_transparent_png_stays_png(self):
        self.upload(png_alpha())
        self.assertTrue(ScreenBackdrop.objects.get().image.name.endswith(".png"))

    def test_fake_images_and_empty_uploads_are_refused(self):
        bad = SimpleUploadedFile("evil.jpg", b"<script>alert(1)</script>", content_type="image/jpeg")
        r = self.upload(bad)
        self.assertEqual(r.status_code, 400)
        self.assertIn("isn't an image", r.json()["error"])
        self.assertEqual(self.client.post(self.base + "upload/", {}).status_code, 400)
        self.assertFalse(ScreenBackdrop.objects.exists())

    def test_mixed_batch_keeps_the_good_ones(self):
        bad = SimpleUploadedFile("notes.jpg", b"hello", content_type="image/jpeg")
        r = self.upload(jpeg(), bad, jpeg(color=(10, 10, 200)))
        self.assertEqual(len(r.json()["added"]), 2)
        self.assertEqual(len(r.json()["errors"]), 1)

    def test_settings_are_validated(self):
        self.upload(jpeg())
        r = self.settings(show=True, fit="contain", dim=500, motion="spin", slideshow=7, caption="  Lunch   break ",
                          countdown="25:99", code=True, junk="x")
        bd = r.json()["state"]["backdrop"]
        self.assertEqual((bd["show"], bd["fit"], bd["dim"], bd["motion"], bd["slideshow"], bd["caption"], bd["countdown"], bd["code"]),
                         (True, "contain", 80, "drift", 0, "Lunch break", "", True))
        self.assertNotIn("junk", bd)
        bd = self.settings(countdown="14:30", slideshow=15).json()["state"]["backdrop"]
        self.assertEqual((bd["countdown"], bd["slideshow"]), ("14:30", 15))

    def test_cannot_show_with_nothing_uploaded(self):
        r = self.settings(show=True)
        self.assertEqual(r.status_code, 400)
        self.assertIn("Upload", r.json()["error"])

    def test_choosing_and_deleting(self):
        a = self.upload(jpeg()).json()["added"][0]
        b = self.upload(jpeg(color=(0, 90, 0))).json()["added"][0]
        self.assertEqual(self.settings(active=b).json()["state"]["backdrop"]["active"], b)
        self.assertEqual(self.settings(active="00000000-0000-0000-0000-000000000000").json()["state"]["backdrop"]["active"], b)
        bd = self.client.post(self.base + f"{b}/delete/").json()["state"]["backdrop"]
        self.assertEqual((bd["active"], len(bd["images"])), (a, 1))
        self.settings(show=True)
        bd = self.client.post(self.base + f"{a}/delete/").json()["state"]["backdrop"]
        self.assertEqual((bd["images"], bd["show"]), ([], False))       # nothing left to show

    def test_stopped_screen_refuses_and_is_cleaned_up(self):
        self.upload(jpeg())
        path = ScreenBackdrop.objects.get().image.name
        self.client.post(f"/hanns/screen/s/{self.screen.token}/stop/")
        self.assertFalse(ScreenBackdrop.objects.exists())
        self.assertFalse(default_storage.exists(path))
        self.assertEqual(self.upload(jpeg()).status_code, 410)
        self.assertEqual(self.settings(show=True).status_code, 410)

    def test_unknown_screen_is_404(self):
        self.assertEqual(self.client.post("/screenart/s/nope/upload/", {"file": jpeg()}).status_code, 404)

    @override_settings(STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
    def test_stage_page_gets_the_backdrop_urls(self):
        r = self.client.get(f"/hanns/screen/s/{self.screen.token}/")
        self.assertContains(r, f"/screenart/s/{self.screen.token}/")
        self.assertContains(r, "hanns_screen_backdrop.js")


@override_settings(MEDIA_ROOT=TMP, STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
class HostDashboardTests(TestCase):
    def test_screens_page_has_the_background_button(self):
        host = get_user_model().objects.create_user("host2", password="pw-pw-pw-123")
        screen = BigScreen.objects.create(owner=host, name="Main Screen")
        self.client.force_login(host)
        r = self.client.get("/hanns/screen/")
        self.assertContains(r, "data-bg-toggle")
        self.assertContains(r, "Event background")
        self.assertContains(r, "hanns_screen_home_bg.js")
        self.assertContains(r, f'data-token="{screen.token}"')
