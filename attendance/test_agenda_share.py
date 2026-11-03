"""
Public agenda links: share an agenda with anyone, no sign-in, and stop
it whenever you like.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .agenda_share_models import AgendaShareLink
from .agenda_share_views import _ics_fold, agenda_fingerprint
from .models import AgendaDay, AgendaItem, AttendanceEvent, Registration


PLAIN_STATIC = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC)
class AgendaShareTestBase(TestCase):
    def setUp(self):
        User = get_user_model()
        self.host = User.objects.create_user("host", password="pw-pw-pw-123")
        self.other = User.objects.create_user("other", password="pw-pw-pw-123")
        start = timezone.now().replace(hour=9, minute=0, second=0, microsecond=0) + dt.timedelta(days=2)
        self.ev = AttendanceEvent.objects.create(
            owner=self.host, title="Gambia Youth Summit", location="Arch 22, Banjul",
            starts_at=start, ends_at=start + dt.timedelta(hours=8),
            timezone_name="Africa/Banjul", status=AttendanceEvent.STATUS_OPEN,
            geofence_lat=13.4531, geofence_lng=-16.5786,
        )
        day = AgendaDay.objects.create(event=self.ev, date=start.date(), label="Day 1")
        self.keynote = AgendaItem.objects.create(
            event=self.ev, day=day, order=0, start_time=dt.time(9, 0), end_time=dt.time(10, 0),
            title="Opening keynote", speaker="Hon. Minister", track="Main Hall")
        AgendaItem.objects.create(event=self.ev, day=day, order=1, start_time=dt.time(10, 30),
                                  title="Panel: youth, jobs, tech")
        Registration.objects.create(event=self.ev, full_name="Awa Jallow", email="awa@x.gm",
                                    status=Registration.STATUS_ACCEPTED)

    def make_link(self, **kw):
        return AgendaShareLink.objects.create(event=self.ev, created_by=self.host, **kw)

    def public(self, link, suffix=""):
        return f"/attendance/a/{link.token}/{suffix}"


class PublicAgendaTests(AgendaShareTestBase):
    def test_anyone_can_open_it_without_signing_in(self):
        link = self.make_link(label="WhatsApp group")
        r = self.client.get(self.public(link))
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("Gambia Youth Summit", html)
        self.assertIn("Opening keynote", html)
        self.assertIn("Add to my calendar", html)
        self.assertIn("destination=13.453100,-16.578600", html)   # directions to the venue pin
        self.assertNotIn("<form", html.split('id="kk-pa"')[1].split("</section>")[0])

    def test_never_shows_attendee_data(self):
        link = self.make_link()
        html = self.client.get(self.public(link)).content.decode()
        self.assertNotIn("Awa Jallow", html)
        self.assertNotIn("awa@x.gm", html)

    def test_kept_out_of_search_engines(self):
        r = self.client.get(self.public(self.make_link()))
        self.assertEqual(r["X-Robots-Tag"], "noindex, nofollow")
        self.assertEqual(r["Referrer-Policy"], "no-referrer")
        self.assertContains(r, '<meta name="robots" content="noindex, nofollow">')

    def test_views_are_counted_but_not_the_organizers_own(self):
        link = self.make_link()
        self.client.get(self.public(link))
        self.client.get(self.public(link))
        self.client.force_login(self.host)
        self.client.get(self.public(link))
        link.refresh_from_db()
        self.assertEqual(link.view_count, 2)
        self.assertIsNotNone(link.last_viewed_at)

    def test_stopped_link_shows_the_closed_door_and_no_event(self):
        link = self.make_link()
        link.stop()
        r = self.client.get(self.public(link))
        self.assertEqual(r.status_code, 410)
        html = r.content.decode()
        self.assertIn("This agenda link is turned off", html)
        self.assertNotIn("Gambia Youth Summit", html)
        self.assertNotIn("Opening keynote", html)

    def test_unknown_link(self):
        r = self.client.get("/attendance/a/not-a-real-token/")
        self.assertEqual(r.status_code, 404)
        self.assertContains(r, "doesn’t work", status_code=404)

    def test_auto_stop_a_day_after_the_event(self):
        link = self.make_link(stop_after_event=True)
        self.ev.starts_at = timezone.now() - dt.timedelta(days=3)
        self.ev.ends_at = timezone.now() - dt.timedelta(days=2)
        self.ev.save()
        r = self.client.get(self.public(link))
        self.assertEqual(r.status_code, 410)
        self.assertContains(r, "expired", status_code=410)
        # A link set to stay on keeps working.
        forever = self.make_link(stop_after_event=False)
        self.assertEqual(self.client.get(self.public(forever)).status_code, 200)

    def test_status_reports_changes_and_stops(self):
        link = self.make_link()
        first = self.client.get(self.public(link, "status.json")).json()
        self.assertTrue(first["live"])
        self.assertEqual(first["fingerprint"], agenda_fingerprint(self.ev))
        self.keynote.title = "Opening keynote (moved to Hall B)"
        self.keynote.save()
        second = self.client.get(self.public(link, "status.json")).json()
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])
        link.stop()
        self.assertEqual(self.client.get(self.public(link, "status.json")).json(), {"live": False})

    def test_calendar_file(self):
        link = self.make_link()
        r = self.client.get(self.public(link, "agenda.ics"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "text/calendar; charset=utf-8")
        body = r.content.decode()
        self.assertTrue(body.startswith("BEGIN:VCALENDAR\r\n"))
        self.assertEqual(body.count("BEGIN:VEVENT"), 2)
        self.assertIn("SUMMARY:Opening keynote", body)
        self.assertIn("LOCATION:Arch 22\\, Banjul", body)
        self.assertIn("GEO:13.453100;-16.578600", body)
        # Banjul is UTC+0: 09:00 local is 09:00Z. No end time → ends at the next session.
        day = self.ev.starts_at.date().strftime("%Y%m%d")
        self.assertIn(f"DTSTART:{day}T090000Z", body)
        self.assertIn(f"DTSTART:{day}T103000Z\r\nDTEND:{day}T110000Z", body)
        for line in body.split("\r\n"):
            self.assertLessEqual(len(line.encode()), 75)
        link.stop()
        self.assertEqual(self.client.get(self.public(link, "agenda.ics")).status_code, 410)

    def test_ics_folding_keeps_utf8_intact(self):
        line = "SUMMARY:" + "Kër Jaam ñ — " * 12
        folded = _ics_fold(line)
        self.assertEqual(folded.replace("\r\n ", ""), line)
        self.assertTrue(all(len(p.encode()) <= 75 for p in folded.split("\r\n")))


class OrganizerTests(AgendaShareTestBase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.host)
        self.page = f"/attendance/{self.ev.pk}/agenda/share/"

    def test_create_stop_resume_delete(self):
        r = self.client.post(self.page + "new/", {"label": "Printed flyer", "stop_after_event": "on"})
        link = AgendaShareLink.objects.get()
        self.assertRedirects(r, f"{self.page}#link-{link.pk}", fetch_redirect_response=False)
        self.assertEqual((link.label, link.stop_after_event, link.is_active), ("Printed flyer", True, True))

        html = self.client.get(self.page).content.decode()
        self.assertIn("Printed flyer", html)
        self.assertIn(link.token, html)
        self.assertIn("wa.me", html)

        self.client.post(f"{self.page}{link.pk}/toggle/", {"action": "stop"})
        link.refresh_from_db()
        self.assertFalse(link.is_active)
        self.assertEqual(self.client.get(self.public(link)).status_code, 410)

        self.client.post(f"{self.page}{link.pk}/toggle/", {"action": "resume"})
        link.refresh_from_db()
        self.assertTrue(link.is_active)
        self.assertEqual(self.client.get(self.public(link)).status_code, 200)   # same address

        self.client.post(f"{self.page}{link.pk}/delete/")
        self.assertFalse(AgendaShareLink.objects.exists())
        self.assertEqual(self.client.get(self.public(link)).status_code, 404)

    def test_stopping_one_link_leaves_the_others(self):
        a, b = self.make_link(label="A"), self.make_link(label="B")
        self.client.post(f"{self.page}{a.pk}/toggle/", {"action": "stop"})
        self.assertEqual(self.client.get(self.public(a)).status_code, 410)
        self.assertEqual(self.client.get(self.public(b)).status_code, 200)

    def test_stop_every_link(self):
        links = [self.make_link(label=str(i)) for i in range(3)]
        self.client.post(self.page + "stop-all/")
        for link in links:
            self.assertEqual(self.client.get(self.public(link)).status_code, 410)

    def test_resuming_an_expired_link_keeps_it_on(self):
        link = self.make_link(stop_after_event=True)
        self.ev.ends_at = timezone.now() - dt.timedelta(days=2)
        self.ev.starts_at = self.ev.ends_at - dt.timedelta(hours=8)
        self.ev.save()
        self.client.post(f"{self.page}{link.pk}/toggle/", {"action": "resume"})
        link.refresh_from_db()
        self.assertFalse(link.stop_after_event)
        self.assertEqual(self.client.get(self.public(link)).status_code, 200)

    def test_qr_code(self):
        link = self.make_link()
        r = self.client.get(f"{self.page}{link.pk}/qr.png")
        self.assertEqual(r["Content-Type"], "image/png")
        self.assertTrue(r.content.startswith(b"\x89PNG"))

    def test_only_the_owner_can_manage(self):
        link = self.make_link()
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.page).status_code, 404)
        self.assertEqual(self.client.post(f"{self.page}{link.pk}/toggle/", {"action": "stop"}).status_code, 404)
        self.assertEqual(self.client.post(f"{self.page}{link.pk}/delete/").status_code, 404)
        self.assertEqual(self.client.post(self.page + "stop-all/").status_code, 404)
        link.refresh_from_db()
        self.assertTrue(link.is_active)

    def test_managing_needs_login_but_viewing_does_not(self):
        link = self.make_link()
        self.client.logout()
        self.assertEqual(self.client.get(self.page).status_code, 302)
        self.assertEqual(self.client.get(self.public(link)).status_code, 200)

    def test_share_buttons_on_dashboard_and_editor(self):
        for url in (f"/attendance/{self.ev.pk}/", f"/attendance/{self.ev.pk}/agenda/"):
            self.assertContains(self.client.get(url), self.page)
