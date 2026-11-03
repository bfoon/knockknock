"""
Venue location: Plus Codes, typed coordinates, Google Maps links,
address search, and the directions attendees get from the pin.

No test touches the network: geocoder responses are faked by patching
geo._http_json, and short links use a fake opener.
"""
import datetime as dt
import io
import os
import urllib.error
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from . import geo, services
from .models import AttendanceEvent, Registration


PLAIN_STATIC = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
LOCMEM_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# Reference values produced by Google's official openlocationcode library.
PLUS_CODE_VECTORS = [
    ((13.4549, -16.5790), "7C55FC3C+XC", (13.4549375, -16.5789375)),    # Banjul
    ((13.4531, -16.5786), "7C55FC3C+6H", (13.4530625, -16.5785625)),    # Arch 22
    ((51.5007, -0.1246), "9C3XGV2G+75", (51.5006875, -0.1245625)),
    ((-33.8568, 151.2153), "4RRH46V8+74", (-33.8568125, 151.2153125)),
    ((40.6892, -74.0445), "87G7MXQ4+M6", (40.6891875, -74.0444375)),
    ((-0.0001, 0.0001), "6FF2X2X2+X2", (-0.0000625, 0.0000625)),
    ((89.99, 179.99), "CVXXXXRR+22", (89.9900625, 179.9900625)),
]


class PlusCodeTests(SimpleTestCase):
    def test_encode_matches_reference(self):
        for (lat, lng), code, _ in PLUS_CODE_VECTORS:
            self.assertEqual(geo.encode_plus_code(lat, lng), code)

    def test_decode_matches_reference(self):
        for _, code, (lat, lng) in PLUS_CODE_VECTORS:
            got = geo.decode_plus_code(code)
            self.assertAlmostEqual(got[0], lat, places=7)
            self.assertAlmostEqual(got[1], lng, places=7)

    def test_short_code_recovered_near_banjul(self):
        lat, lng = geo.recover_nearest("FC3C+XC", 13.40, -16.60)
        self.assertAlmostEqual(lat, 13.4549375, places=6)
        self.assertAlmostEqual(lng, -16.5789375, places=6)

    def test_validation(self):
        self.assertTrue(geo.is_full_plus_code("7c55fc3c+xc"))
        self.assertFalse(geo.is_full_plus_code("FC3C+XC"))
        self.assertTrue(geo.is_short_plus_code("FC3C+XC"))
        self.assertFalse(geo.is_full_plus_code("XC55FC3C+XC"))   # latitude out of range
        self.assertFalse(geo.is_short_plus_code("FC3+XC"))       # odd digit count


class CoordinateParsingTests(SimpleTestCase):
    def test_accepted_forms(self):
        expected = (13.4549, -16.579)
        for text in ["13.4549, -16.5790", "13.4549 -16.5790", "13.4549,-16.5790",
                     "13.4549N, 16.5790W", "N 13.4549 W 16.5790", "16.5790W 13.4549N"]:
            got = geo.parse_coordinates(text)
            self.assertIsNotNone(got, text)
            self.assertAlmostEqual(got[0], expected[0], places=6, msg=text)
            self.assertAlmostEqual(got[1], expected[1], places=6, msg=text)

    def test_degrees_minutes_seconds_from_google_maps(self):
        lat, lng = geo.parse_coordinates("13°27'17.6\"N 16°34'44.4\"W")
        self.assertAlmostEqual(lat, 13.454889, places=5)
        self.assertAlmostEqual(lng, -16.579, places=5)

    def test_rejected(self):
        for text in ["91, 10", "13.45", "Kairaba Avenue", "N 13.45 N 16.57", "13 70' 0\" N 16 0 W"]:
            self.assertIsNone(geo.parse_coordinates(text), text)


class MapsLinkTests(SimpleTestCase):
    def test_place_link_prefers_the_place_over_the_viewport(self):
        url = ("https://www.google.com/maps/place/Arch+22/@13.4520,-16.5770,17z/"
               "data=!3m1!4b1!4m6!3m5!8m2!3d13.4531!4d-16.5786")
        self.assertEqual(geo.parse_maps_url(url), ("point", (13.4531, -16.5786)))

    def test_other_link_shapes(self):
        cases = {
            "https://maps.google.com/?q=13.4549,-16.5790": (13.4549, -16.579),
            "https://www.google.com/maps/search/?api=1&query=13.4549%2C-16.5790": (13.4549, -16.579),
            "https://www.google.com/maps/dir/?api=1&destination=13.45,-16.57": (13.45, -16.57),
            "https://www.google.com/maps/@13.4549,-16.579,15z": (13.4549, -16.579),
        }
        for url, point in cases.items():
            self.assertTrue(geo.is_maps_link(url), url)
            self.assertEqual(geo.parse_maps_url(url), ("point", point), url)

    def test_link_with_only_a_name(self):
        self.assertEqual(geo.parse_maps_url("https://www.google.com/maps/search/Kairaba+Avenue+Serekunda"),
                         ("text", "Kairaba Avenue Serekunda"))

    def test_not_a_maps_link(self):
        self.assertFalse(geo.is_maps_link("https://example.com/maps/place/x"))
        self.assertFalse(geo.is_maps_link("javascript:alert(1)"))

    def test_short_link_is_expanded_via_redirect_only(self):
        target = "https://www.google.com/maps/place/X/data=!3d13.4531!4d-16.5786"
        opened = []

        class FakeOpener:
            def open(self, req, timeout=None):
                opened.append(req.full_url)
                raise urllib.error.HTTPError(req.full_url, 302, "Found",
                                             {"Location": target}, io.BytesIO())

        url = geo.expand_short_link("https://maps.app.goo.gl/abc123", opener=FakeOpener())
        self.assertEqual(url, target)
        self.assertEqual(opened, ["https://maps.app.goo.gl/abc123"])  # google.com never fetched

    def test_other_hosts_are_never_fetched(self):
        class Boom:
            def open(self, *a, **k):
                raise AssertionError("must not fetch")
        self.assertEqual(geo.expand_short_link("https://evil.example/x", opener=Boom()),
                         "https://evil.example/x")


@override_settings(CACHES=LOCMEM_CACHE)
class ResolveTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_full_plus_code(self):
        r = geo.resolve("7C55FC3C+6H")
        self.assertEqual(r["kind"], "plus_code")
        self.assertAlmostEqual(r["results"][0]["lat"], 13.453062, places=5)

    def test_short_plus_code_uses_the_map_centre(self):
        r = geo.resolve("FC3C+6H", near=(13.45, -16.58))
        self.assertEqual(r["results"][0]["plus_code"], "7C55FC3C+6H")

    def test_short_plus_code_without_reference_asks_for_a_town(self):
        r = geo.resolve("FC3C+6H")
        self.assertEqual(r["results"], [])
        self.assertIn("Add the town", r["message"])

    def test_short_plus_code_with_town_geocodes_the_town(self):
        nominatim = [{"lat": "13.4549", "lon": "-16.5790", "display_name": "Banjul, The Gambia"}]
        with mock.patch.object(geo, "_http_json", return_value=nominatim) as http:
            r = geo.resolve("FC3C+6H Banjul")
        self.assertEqual(r["results"][0]["plus_code"], "7C55FC3C+6H")
        self.assertIn("q=Banjul", http.call_args[0][0])

    def test_coordinates(self):
        r = geo.resolve("13.4531, -16.5786")
        self.assertEqual((r["kind"], r["results"][0]["lat"]), ("coordinates", 13.4531))

    def test_address_search_with_openstreetmap(self):
        rows = [{"lat": "13.4400", "lon": "-16.6800", "display_name": "Kairaba Avenue, Serekunda"},
                {"lat": "13.4300", "lon": "-16.7000", "display_name": "Kairaba Avenue, Kanifing"}]
        with mock.patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": ""}), \
             mock.patch.object(geo, "_http_json", return_value=rows) as http:
            r = geo.resolve("Kairaba Avenue", near=(13.45, -16.58))
        self.assertEqual(r["kind"], "address")
        self.assertEqual([x["label"] for x in r["results"]],
                         ["Kairaba Avenue, Serekunda", "Kairaba Avenue, Kanifing"])
        url = http.call_args[0][0]
        self.assertIn("nominatim.openstreetmap.org/search", url)
        self.assertIn("viewbox=", url)   # results near the map rank first

    def test_address_search_uses_google_when_a_key_is_set(self):
        google = {"status": "OK", "results": [{
            "formatted_address": "Arch 22, Banjul, The Gambia",
            "geometry": {"location": {"lat": 13.4531, "lng": -16.5786}}}]}
        with mock.patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test-key"}), \
             mock.patch.object(geo, "_http_json", return_value=google) as http:
            r = geo.resolve("Arch 22")
        self.assertEqual(r["results"][0]["label"], "Arch 22, Banjul, The Gambia")
        self.assertIn("maps.googleapis.com", http.call_args[0][0])

    def test_results_are_cached(self):
        rows = [{"lat": "13.44", "lon": "-16.68", "display_name": "Somewhere"}]
        with mock.patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": ""}), \
             mock.patch.object(geo, "_http_json", return_value=rows) as http:
            geo.resolve("Somewhere")
            geo.resolve("somewhere")
        self.assertEqual(http.call_count, 1)

    def test_nothing_found(self):
        with mock.patch.object(geo, "_http_json", return_value=[]):
            r = geo.resolve("zzzz nowhere")
        self.assertEqual(r["results"], [])
        self.assertIn("No places found", r["message"])


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC, CACHES=LOCMEM_CACHE)
class LocationViewsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user("org", password="pw-pw-pw-123")
        self.client.force_login(self.user)

    def test_lookup_needs_login(self):
        self.client.logout()
        r = self.client.get("/attendance/geo/resolve/?q=13.45,-16.57")
        self.assertEqual(r.status_code, 302)

    def test_resolve_plus_code(self):
        r = self.client.get("/attendance/geo/resolve/", {"q": "FC3C+6H", "near_lat": "13.45", "near_lng": "-16.58"})
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["results"][0]["plus_code"], "7C55FC3C+6H")

    def test_service_down_gives_a_helpful_message(self):
        with mock.patch.object(geo, "_http_json", side_effect=geo.LookupUnavailable("Address search is unavailable right now.")):
            r = self.client.get("/attendance/geo/resolve/", {"q": "Kairaba Avenue"})
        self.assertEqual(r.status_code, 503)
        self.assertIn("Plus Code", r.json()["message"])

    def test_rate_limited(self):
        for _ in range(30):
            self.client.get("/attendance/geo/resolve/", {"q": "13.45,-16.57"})
        self.assertEqual(self.client.get("/attendance/geo/resolve/", {"q": "13.45,-16.57"}).status_code, 429)

    def test_reverse_gives_plus_code_and_optional_address(self):
        r = self.client.get("/attendance/geo/reverse/", {"lat": "13.4531", "lng": "-16.5786"}).json()
        self.assertEqual((r["plus_code"], r["address"]), ("7C55FC3C+6H", ""))
        with mock.patch.object(geo, "_http_json", return_value={"display_name": "Arch 22, Banjul"}):
            r = self.client.get("/attendance/geo/reverse/",
                                {"lat": "13.4531", "lng": "-16.5786", "address": "1"}).json()
        self.assertEqual(r["address"], "Arch 22, Banjul")

    def test_reverse_rejects_bad_coordinates(self):
        self.assertEqual(self.client.get("/attendance/geo/reverse/", {"lat": "99", "lng": "0"}).status_code, 400)


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC, CACHES=LOCMEM_CACHE)
class DirectionsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("org", password="pw-pw-pw-123")
        now = timezone.now()
        self.ev = AttendanceEvent.objects.create(
            owner=self.user, title="Summit", location="Arch 22, Banjul",
            starts_at=now - dt.timedelta(minutes=10), ends_at=now + dt.timedelta(hours=4),
            status=AttendanceEvent.STATUS_LIVE)

    def test_directions_use_the_pin_when_set(self):
        self.assertIn("destination=Arch%2022%2C%20Banjul", self.ev.get_directions_url())
        self.ev.geofence_lat, self.ev.geofence_lng = 13.4531, -16.5786
        self.assertTrue(self.ev.get_directions_url().endswith("destination=13.453100,-16.578600"))
        self.assertEqual(self.ev.venue_plus_code(), "7C55FC3C+6H")

    def test_zero_is_a_real_coordinate(self):
        self.ev.geofence_lat, self.ev.geofence_lng = 0.0, 0.0
        self.assertTrue(self.ev.has_venue_pin())

    def test_online_events_have_no_directions(self):
        self.ev.is_online = True
        self.assertEqual(self.ev.get_directions_url(), "")

    def test_pages_show_pin_directions_and_plus_code(self):
        self.ev.geofence_lat, self.ev.geofence_lng = 13.4531, -16.5786
        self.ev.save()
        reg = Registration.objects.create(event=self.ev, full_name="Awa", email="awa@x.gm",
                                          status=Registration.STATUS_ACCEPTED)
        link = "destination=13.453100,-16.578600"
        ticket = self.client.get(f"/attendance/t/{reg.token}/").content.decode()
        self.assertIn(link, ticket)
        self.assertIn("7C55FC3C+6H", ticket)
        self.assertIn('data-geofence=""', ticket)   # pin only: no check-in circle
        self.assertIn(link, self.client.get(f"/attendance/e/{self.ev.public_token}/checkin/").content.decode())
        self.assertIn(link, self.client.get(f"/attendance/e/{self.ev.public_token}/").content.decode())

        services.send_registration_confirmation(reg)
        msg = mail.outbox[-1]
        html = msg.alternatives[0][0] if getattr(msg, "alternatives", None) else msg.body
        self.assertIn(link, html)
        self.assertIn("7C55FC3C+6H", html)


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC, CACHES=LOCMEM_CACHE)
class EventFormLocationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("org", password="pw-pw-pw-123")
        self.client.force_login(self.user)
        start = timezone.localtime() + dt.timedelta(days=3)
        self.base = {
            "title": "Summit", "location": "Arch 22, Banjul",
            "starts_at": start.strftime("%Y-%m-%dT%H:%M"),
            "ends_at": (start + dt.timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M"),
            "timezone_name": "UTC", "registration_mode": "auto",
            "geofence_radius_m": "150", "allow_walk_ins": "on",
        }

    def test_form_page_has_the_picker(self):
        html = self.client.get("/attendance/new/").content.decode()
        self.assertIn("data-kk-locpick", html)
        self.assertIn("Find the venue", html)
        self.assertIn("Use my current location", html)

    def test_pin_saves_without_geofencing(self):
        r = self.client.post("/attendance/new/", {**self.base, "geofence_lat": "13.4531", "geofence_lng": "-16.5786"})
        self.assertEqual(r.status_code, 302)
        ev = AttendanceEvent.objects.get(title="Summit")
        self.assertEqual((ev.geofence_lat, ev.geofence_lng, ev.require_geofence), (13.4531, -16.5786, False))
        self.assertFalse(ev.has_geofence())

    def test_half_a_pin_is_rejected(self):
        r = self.client.post("/attendance/new/", {**self.base, "geofence_lat": "13.4531"})
        self.assertContains(r, "Set both latitude and longitude")

    def test_geofencing_needs_a_pin(self):
        r = self.client.post("/attendance/new/", {**self.base, "require_geofence": "on"})
        self.assertContains(r, "Pin the venue under")
