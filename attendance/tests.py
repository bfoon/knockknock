"""
Check-in flows: the event QR "door" page, walk-ins, the organizer's
"Mark present", and the welcome shown after checking in.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import AttendanceEvent, CheckIn, EventField, Registration


PLAIN_STATIC = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
AJAX = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC)
class CheckInTestBase(TestCase):
    def setUp(self):
        User = get_user_model()
        self.host = User.objects.create_user("host", password="pw-pw-pw-123")
        now = timezone.now()
        self.ev = AttendanceEvent.objects.create(
            owner=self.host, title="Gambia Youth Summit",
            starts_at=now - dt.timedelta(minutes=30),
            ends_at=now + dt.timedelta(hours=6),
            status=AttendanceEvent.STATUS_LIVE, location="Banjul",
        )
        self.name_field = EventField.objects.create(
            event=self.ev, preset_key="full_name", label="Full name",
            field_type="text", required=True, order=1)
        self.email_field = EventField.objects.create(
            event=self.ev, preset_key="email", label="Email",
            field_type="email", required=True, order=2)
        self.awa = Registration.objects.create(
            event=self.ev, full_name="Awa Jallow", email="awa@x.gm",
            status=Registration.STATUS_ACCEPTED, accepted_at=now)

        self.door = f"/attendance/e/{self.ev.public_token}/checkin/"
        self.register = f"/attendance/e/{self.ev.public_token}/"
        self.dashboard = f"/attendance/{self.ev.pk}/"

    def action_url(self, reg):
        return f"/attendance/{self.ev.pk}/r/{reg.pk}/action/"

    def reg_form(self, name, email):
        return {self.name_field.html_input_name(): name,
                self.email_field.html_input_name(): email}


class DoorPageTests(CheckInTestBase):
    """Scanning the event QR: 'I registered already' and 'I'm new here'."""

    def test_page_shows_both_doors(self):
        html = self.client.get(self.door).content.decode()
        self.assertIn("Knock knock.", html)
        self.assertIn("I registered already", html)
        self.assertIn("I’m new here", html)
        self.assertIn("?walk_in=1", html)       # was ?walkin=1, which the view ignored
        self.assertNotIn("?walkin=1", html)

    def test_registered_email_checks_in(self):
        r = self.client.post(self.door, {"identifier": "awa@x.gm", "device_token": "phone-a"})
        self.assertRedirects(r, f"/attendance/t/{self.awa.token}/?welcome=1",
                             fetch_redirect_response=False)
        self.awa.refresh_from_db()
        self.assertEqual(self.awa.status, Registration.STATUS_CHECKED_IN)
        ci = self.awa.check_ins.get()
        self.assertEqual(ci.method, CheckIn.METHOD_SELF)
        self.assertEqual(ci.device_token, "phone-a")

    def test_email_match_ignores_case_and_spaces(self):
        r = self.client.post(self.door, {"identifier": "  AWA@X.GM "})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.awa.check_ins.count(), 1)

    def test_second_attempt_says_already_in(self):
        self.client.post(self.door, {"identifier": "awa@x.gm", "device_token": "phone-a"})
        r = self.client.post(self.door, {"identifier": "awa@x.gm", "device_token": "phone-a"})
        self.assertRedirects(r, f"/attendance/t/{self.awa.token}/?welcome=again",
                             fetch_redirect_response=False)
        self.assertEqual(self.awa.check_ins.count(), 1)

    def test_unknown_email_offers_register_with_email_prefilled(self):
        r = self.client.post(self.door, {"identifier": "new@x.gm"})
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("couldn&#x27;t find a registration for new@x.gm", html)
        self.assertIn("walk_in=1&amp;email=new%40x.gm", html)
        self.assertIn("<details class=\"kk-door kk-door-known\" id=\"kk-door-known\"\n             open>", html)

    def test_pending_is_not_checked_in(self):
        p = Registration.objects.create(event=self.ev, full_name="Pa Modou",
                                        email="pa@x.gm", status=Registration.STATUS_PENDING)
        r = self.client.post(self.door, {"identifier": "pa@x.gm"})
        self.assertContains(r, "hasn&#x27;t approved you yet")
        self.assertFalse(p.check_ins.exists())

    def test_withdrawn_is_not_checked_in(self):
        d = Registration.objects.create(event=self.ev, full_name="Ida",
                                        email="ida@x.gm", status=Registration.STATUS_DECLINED)
        r = self.client.post(self.door, {"identifier": "ida@x.gm"})
        self.assertContains(r, "registration was withdrawn")
        self.assertFalse(d.check_ins.exists())

    def test_one_phone_cannot_check_in_two_people(self):
        lamin = Registration.objects.create(event=self.ev, full_name="Lamin",
                                            email="lamin@x.gm", status=Registration.STATUS_ACCEPTED)
        self.client.post(self.door, {"identifier": "awa@x.gm", "device_token": "phone-a"})
        r = self.client.post(self.door, {"identifier": "lamin@x.gm", "device_token": "phone-a"})
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "already checked someone else in today")
        self.assertFalse(lamin.check_ins.exists())

    def test_before_check_in_opens_newcomers_can_still_register(self):
        self.ev.starts_at = timezone.now() + dt.timedelta(days=2)
        self.ev.ends_at = self.ev.starts_at + dt.timedelta(hours=6)
        self.ev.status = AttendanceEvent.STATUS_OPEN
        self.ev.save()
        r = self.client.get(self.door)
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("Check-in opens at", html)
        self.assertIn(f'href="{self.register}"', html)  # normal sign-up, not a walk-in
        self.assertNotIn("walk_in=1", html)
        self.client.post(self.door, {"identifier": "awa@x.gm"})
        self.assertFalse(self.awa.check_ins.exists())

    def test_geofence_step_keeps_the_device_token(self):
        self.ev.require_geofence = True
        self.ev.geofence_lat, self.ev.geofence_lng = 13.45, -16.58
        self.ev.save()
        r = self.client.post(self.door, {"identifier": "awa@x.gm", "device_token": "phone-a"})
        self.assertContains(r, 'name="device_token" value="phone-a"')
        self.assertFalse(self.awa.check_ins.exists())
        # Back with coordinates inside the radius → checked in, token kept.
        r = self.client.post(self.door, {"identifier": "awa@x.gm", "device_token": "phone-a",
                                         "lat": "13.4500", "lng": "-16.5800"})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.awa.check_ins.get().device_token, "phone-a")


class WalkInTests(CheckInTestBase):
    """'I'm new here': register at the door and get checked in."""

    def test_walk_in_registers_and_checks_in(self):
        r = self.client.post(self.register + "?walk_in=1", self.reg_form("Fatou Ceesay", "fatou@x.gm"))
        fatou = Registration.objects.get(email="fatou@x.gm")
        self.assertRedirects(r, f"/attendance/t/{fatou.token}/?welcome=1",
                             fetch_redirect_response=False)
        self.assertTrue(fatou.is_walk_in)
        self.assertEqual(fatou.status, Registration.STATUS_CHECKED_IN)
        self.assertEqual(fatou.check_ins.count(), 1)  # a real per-day row now

    def test_old_walkin_spelling_still_works(self):
        self.client.post(self.register + "?walkin=1", self.reg_form("Musa", "musa@x.gm"))
        self.assertEqual(Registration.objects.get(email="musa@x.gm").status,
                         Registration.STATUS_CHECKED_IN)

    def test_walk_in_with_an_already_registered_email_checks_them_in(self):
        r = self.client.post(self.register + "?walk_in=1", self.reg_form("Awa Jallow", "awa@x.gm"))
        self.assertRedirects(r, f"/attendance/t/{self.awa.token}/?welcome=1",
                             fetch_redirect_response=False)
        self.assertEqual(Registration.objects.filter(email="awa@x.gm").count(), 1)
        self.assertEqual(self.awa.check_ins.count(), 1)

    def test_walk_ins_off_means_register_then_check_in_from_ticket(self):
        self.ev.allow_walk_ins = False
        self.ev.save()
        self.assertNotIn("walk_in=1", self.client.get(self.door).content.decode())
        self.client.post(self.register + "?walk_in=1", self.reg_form("Ebou", "ebou@x.gm"))
        ebou = Registration.objects.get(email="ebou@x.gm")
        self.assertEqual(ebou.status, Registration.STATUS_ACCEPTED)
        self.assertFalse(ebou.is_walk_in)
        # Their ticket's "I'm here" button then checks them in.
        r = self.client.get(f"/attendance/t/{ebou.token}/checkin/")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(ebou.check_ins.count(), 1)

    def test_email_is_prefilled_from_the_door_page(self):
        r = self.client.get(self.register + "?walk_in=1&email=new%40x.gm")
        self.assertContains(r, 'value="new@x.gm"')


class MarkPresentTests(CheckInTestBase):
    """The organizer's 'Mark present' on the event dashboard."""

    def setUp(self):
        super().setUp()
        self.client.force_login(self.host)

    def test_mark_present_records_a_real_check_in(self):
        self.client.post(self.action_url(self.awa), {"action": "check_in"})
        self.awa.refresh_from_db()
        self.assertEqual(self.awa.status, Registration.STATUS_CHECKED_IN)
        ci = self.awa.check_ins.get()
        self.assertEqual(ci.method, CheckIn.METHOD_ORGANIZER)
        self.assertEqual(ci.day, timezone.localdate())

    def test_mark_present_in_place_returns_the_new_row(self):
        r = self.client.post(self.action_url(self.awa), {"action": "check_in"}, **AJAX)
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["level"], "success")
        self.assertEqual(data["checked_in_count"], 1)
        self.assertIn("kk-presence-here", data["row_html"])
        self.assertIn('value="uncheck_in"', data["row_html"])
        self.assertNotIn('value="check_in"', data["row_html"])
        self.assertEqual(len(data["detail"]["checkins"]), 1)

    def test_mark_present_twice_is_harmless(self):
        self.client.post(self.action_url(self.awa), {"action": "check_in"}, **AJAX)
        data = self.client.post(self.action_url(self.awa), {"action": "check_in"}, **AJAX).json()
        self.assertEqual(data["level"], "info")
        self.assertIn("already checked in today", data["message"])
        self.assertEqual(self.awa.check_ins.count(), 1)

    def test_mark_present_approves_pending(self):
        p = Registration.objects.create(event=self.ev, full_name="Pa", email="pa@x.gm",
                                        status=Registration.STATUS_PENDING)
        self.client.post(self.action_url(p), {"action": "check_in"})
        p.refresh_from_db()
        self.assertEqual(p.status, Registration.STATUS_CHECKED_IN)
        self.assertIsNotNone(p.accepted_at)  # used to be lost (saved with save=False)
        self.assertEqual(p.check_ins.count(), 1)

    def test_withdrawn_cannot_be_marked_present(self):
        d = Registration.objects.create(event=self.ev, full_name="Ida", email="ida@x.gm",
                                        status=Registration.STATUS_CANCELLED)
        data = self.client.post(self.action_url(d), {"action": "check_in"}, **AJAX).json()
        self.assertFalse(data["ok"])
        self.assertFalse(d.check_ins.exists())

    def test_undo_removes_the_check_in(self):
        self.client.post(self.action_url(self.awa), {"action": "check_in"})
        data = self.client.post(self.action_url(self.awa), {"action": "uncheck_in"}, **AJAX).json()
        self.awa.refresh_from_db()
        self.assertEqual(self.awa.status, Registration.STATUS_ACCEPTED)
        self.assertIsNone(self.awa.checked_in_at)
        self.assertFalse(self.awa.check_ins.exists())
        self.assertIn('value="check_in"', data["row_html"])

    def test_multi_day_mark_present_on_day_two(self):
        yesterday = timezone.localdate() - dt.timedelta(days=1)
        ci = CheckIn.objects.create(registration=self.awa, event=self.ev, day=yesterday)
        self.awa.status = Registration.STATUS_CHECKED_IN
        self.awa.checked_in_at = ci.checked_in_at - dt.timedelta(days=1)
        self.awa.save()

        html = self.client.get(self.dashboard).content.decode()
        self.assertIn("kk-presence-earlier", html)
        self.assertIn('value="check_in"', html)   # can be marked for today

        self.client.post(self.action_url(self.awa), {"action": "check_in"})
        self.assertEqual(self.awa.check_ins.count(), 2)

        # Undo removes only today's; they stay checked in from yesterday.
        self.client.post(self.action_url(self.awa), {"action": "uncheck_in"})
        self.awa.refresh_from_db()
        self.assertEqual(self.awa.status, Registration.STATUS_CHECKED_IN)
        self.assertEqual(list(self.awa.check_ins.values_list("day", flat=True)), [yesterday])

    def test_dashboard_renders_rows(self):
        r = self.client.get(self.dashboard)
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "Mark present")
        self.assertContains(r, f'data-reg-id="{self.awa.pk}"')

    def test_row_endpoint_is_owner_only(self):
        url = f"/attendance/{self.ev.pk}/r/{self.awa.pk}/row/"
        self.assertEqual(self.client.get(url).json()["registration_id"], self.awa.pk)
        other = get_user_model().objects.create_user("other", password="pw-pw-pw-123")
        self.client.force_login(other)
        self.assertEqual(self.client.get(url).status_code, 404)


class WelcomeDoorTests(CheckInTestBase):
    """The 'door opens' welcome on the ticket page."""

    def ticket(self, query=""):
        return self.client.get(f"/attendance/t/{self.awa.token}/{query}").content.decode()

    def test_welcome_plays_after_check_in(self):
        self.client.post(self.door, {"identifier": "awa@x.gm"})
        html = self.ticket("?welcome=1")
        self.assertIn('id="kk-welcome"', html)
        self.assertIn("Awa.", html)

    def test_welcome_again_variant(self):
        self.client.post(self.door, {"identifier": "awa@x.gm"})
        self.assertIn("Awa, again.", self.ticket("?welcome=again"))

    def test_a_copied_link_cannot_fake_a_welcome(self):
        self.assertNotIn('id="kk-welcome"', self.ticket("?welcome=1"))

    def test_day_two_ticket_offers_check_in_again(self):
        yesterday = timezone.localdate() - dt.timedelta(days=1)
        ci = CheckIn.objects.create(registration=self.awa, event=self.ev, day=yesterday)
        self.awa.status = Registration.STATUS_CHECKED_IN
        self.awa.checked_in_at = ci.checked_in_at - dt.timedelta(days=1)
        self.awa.save()
        self.assertIn("Check in again for today", self.ticket())
