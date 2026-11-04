"""
Attendance list and report downloads.

Covers the two promises the exports make (one row per person, one
column per fact) and that every format builds, downloads and stays
private to the event's owner.
"""
import csv
import datetime as dt
import io

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from . import attendance_exports as L
from . import attendance_report_exports as R
from .models import AgendaDay, AttendanceEvent, CheckIn, EventField, Registration, RegistrationAnswer


PLAIN_STATIC = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

LIST_FORMATS = {"xlsx": b"PK", "docx": b"PK", "pdf": b"%PDF", "csv": "\ufeff#".encode()}
REPORT_FORMATS = {"xlsx": b"PK", "docx": b"PK", "pdf": b"%PDF"}


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC)
class ExportTestBase(TestCase):
    """A finished two-day event with the awkward cases built in."""

    def setUp(self):
        User = get_user_model()
        self.host = User.objects.create_user("host", password="pw-pw-pw-123")
        self.client.force_login(self.host)
        start = timezone.now() - dt.timedelta(days=3)
        self.ev = AttendanceEvent.objects.create(
            owner=self.host, title="Gambia Youth Summit",
            starts_at=start, ends_at=start + dt.timedelta(days=1, hours=8),
            status=AttendanceEvent.STATUS_ENDED, location="Banjul", capacity=20,
        )
        self.day1 = AgendaDay.objects.create(event=self.ev, date=start.date(), label="Day 1")
        self.day2 = AgendaDay.objects.create(
            event=self.ev, date=start.date() + dt.timedelta(days=1), label="Day 2", order=1)

        def field(order, label, ftype, preset=""):
            return EventField.objects.create(event=self.ev, order=order, label=label,
                                             field_type=ftype, preset_key=preset)
        self.f_name = field(1, "Full name", "text", "full_name")
        self.f_email = field(2, "Email address", "email", "email")
        self.f_phone = field(3, "Phone number", "phone", "phone")
        self.f_org = field(4, "Organization", "text", "organization")
        self.f_diet = field(5, "Dietary needs", "select", "dietary")
        self.f_whatsapp = field(6, "WhatsApp number", "phone")
        self.f_dept = field(7, "Department", "text", "department")
        self.f_terms = field(8, "I accept the event terms", "checkbox", "consent_terms")

        self.awa = self.reg("Awa Jallow", "awa@x.gm", "+220 7001111", "checked_in",
                            org="UTG", diet="Halal")
        self.lamin = self.reg("Lamin Ceesay", "lamin@x.gm", "+220 7002222", "accepted",
                              org="NAWEC", diet="None")
        self.fatou = self.reg("Fatou Sowe", "fatou@x.gm", "+220 7003333", "pending",
                              org="", diet="Vegetarian")
        # Awa cancelled an earlier registration, then registered again.
        self.awa_old = self.reg("Awa Jallow", "awa@x.gm", "+220 7001111", "cancelled")
        # Lamin signed up a second time: local number, no email, sloppy name.
        self.lamin_dup = self.reg("lamin  CEESAY", "", "7002222", "pending")
        # Two siblings on one family phone: different people.
        self.hawa = self.reg("Hawa Touray", "", "+220 7009999", "accepted")
        self.yankuba = self.reg("Yankuba Touray", "", "7009999", "accepted")

        self.check_in(self.awa, self.day1, 9, 5)
        self.check_in(self.awa, self.day2, 8, 40)

    def reg(self, name, email, phone, status, org="", diet=""):
        r = Registration.objects.create(event=self.ev, full_name=name, email=email,
                                        phone=phone, status=status)
        answers = {self.f_name: name, self.f_email: email, self.f_phone: phone,
                   self.f_org: org, self.f_diet: diet, self.f_whatsapp: phone,
                   self.f_dept: "", self.f_terms: "True"}
        for f, v in answers.items():
            RegistrationAnswer.objects.create(registration=r, field=f, value=v)
        return r

    def check_in(self, reg, day, hour, minute):
        at = timezone.make_aware(dt.datetime.combine(day.date, dt.time(hour, minute)))
        c = CheckIn.objects.create(registration=reg, event=self.ev, day=day.date,
                                   agenda_day=day, method="ticket")
        CheckIn.objects.filter(pk=c.pk).update(checked_in_at=at)
        Registration.objects.filter(pk=reg.pk, checked_in_at__isnull=True).update(checked_in_at=at)

    def ctx(self):
        return L.build_list_context(self.ev)

    def labels(self):
        return [c.label for c in self.ctx()["columns"]]


class OneRowPerPersonTests(ExportTestBase):
    def test_same_email_and_same_phone_are_merged(self):
        ctx = self.ctx()
        self.assertEqual(ctx["registration_count"], 7)
        self.assertEqual(len(ctx["people"]), 5)
        self.assertEqual(ctx["merged"], 2)

    def test_merged_person_keeps_the_most_advanced_status(self):
        people = {p.display_name: p for p in self.ctx()["people"]}
        self.assertEqual(people["Awa Jallow"].status, Registration.STATUS_CHECKED_IN)
        self.assertEqual(people["Awa Jallow"].merged, 1)
        self.assertEqual(people["Lamin Ceesay"].status, Registration.STATUS_ACCEPTED)

    def test_merge_prefers_the_tidy_name_and_full_phone(self):
        lamin = next(p for p in self.ctx()["people"] if p.primary.pk == self.lamin.pk)
        self.assertEqual(lamin.name, "Lamin Ceesay")
        self.assertEqual(lamin.phone, "+220 7002222")
        self.assertEqual(lamin.email, "lamin@x.gm")

    def test_shared_family_phone_with_different_names_stays_separate(self):
        names = [p.display_name for p in self.ctx()["people"]]
        self.assertIn("Hawa Touray", names)
        self.assertIn("Yankuba Touray", names)

    def test_nameless_row_cannot_chain_two_different_people(self):
        self.reg("", "", "+220 7009999", "pending")
        names = [p.display_name for p in self.ctx()["people"]]
        self.assertEqual(names.count("Hawa Touray"), 1)
        self.assertEqual(names.count("Yankuba Touray"), 1)

    def test_check_ins_are_one_column_per_day(self):
        awa = next(p for p in self.ctx()["people"] if p.display_name == "Awa Jallow")
        self.assertEqual(len(awa.visits), 2)
        labels = self.labels()
        self.assertIn("Day 1 (" + f"{self.day1.date.day} {self.day1.date:%b})", labels)
        self.assertIn("Days attended", labels)

    def test_rows_are_ordered_by_status_then_name(self):
        statuses = [p.status for p in self.ctx()["people"]]
        self.assertEqual(statuses, sorted(statuses, key=L.status_rank))


class OneColumnPerFactTests(ExportTestBase):
    def test_identity_questions_are_not_repeated(self):
        labels = self.labels()
        for repeated in ("Full name", "Email address", "Phone number"):
            self.assertNotIn(repeated, labels)
        for core in ("Name", "Email", "Phone"):
            self.assertIn(core, labels)

    def test_answer_that_copies_the_phone_is_dropped(self):
        ctx = self.ctx()
        self.assertNotIn("WhatsApp number", [c.label for c in ctx["columns"]])
        self.assertIn("WhatsApp number", ctx["notes"]["repeats"])

    def test_same_answer_for_everyone_becomes_a_note(self):
        ctx = self.ctx()
        self.assertNotIn("I accept the event terms", [c.label for c in ctx["columns"]])
        self.assertIn(("I accept the event terms", "Yes"), ctx["notes"]["same_for_all"])
        self.assertTrue(any("I accept the event terms" in n for n in L.note_lines(ctx)))

    def test_unanswered_question_is_left_out(self):
        ctx = self.ctx()
        self.assertNotIn("Department", [c.label for c in ctx["columns"]])
        self.assertIn("Department", ctx["notes"]["unanswered"])

    def test_real_answers_keep_their_column(self):
        labels = self.labels()
        self.assertIn("Organization", labels)
        self.assertIn("Dietary needs", labels)

    def test_grouped_layouts_drop_the_status_column(self):
        ctx = self.ctx()
        self.assertIn("Status", [c.label for c in ctx["columns"]])
        self.assertNotIn("Status", [c.label for c in L.grouped_columns(ctx)])

    def test_single_day_event_gets_one_arrived_column(self):
        CheckIn.objects.filter(day=self.day2.date).delete()
        self.day2.delete()
        self.ev.ends_at = self.ev.starts_at + dt.timedelta(hours=8)
        self.ev.save()
        labels = self.labels()
        self.assertIn("Arrived", labels)
        self.assertNotIn("Days attended", labels)


class CsvTests(ExportTestBase):
    def test_csv_has_unique_headers_and_one_row_per_person(self):
        text = L.build_attendance_csv(self.ev).decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text)))
        header, body = rows[0], rows[1:]
        self.assertEqual(len(header), len(set(header)))
        self.assertEqual(len(body), 5)
        emails = [r[header.index("Email")] for r in body]
        self.assertEqual(emails.count("awa@x.gm"), 1)

    def test_legacy_export_url_serves_the_clean_csv(self):
        r = self.client.get(f"/attendance/{self.ev.pk}/export.csv")
        self.assertEqual(r.status_code, 200)
        header = r.content.decode("utf-8-sig").splitlines()[0]
        self.assertNotIn("Full name", header)


class DownloadTests(ExportTestBase):
    def list_url(self, fmt):
        return f"/attendance/{self.ev.pk}/export/attendance-list.{fmt}"

    def report_url(self, fmt):
        return f"/attendance/{self.ev.pk}/export/attendance-report.{fmt}"

    def test_every_list_format_downloads(self):
        for fmt, magic in LIST_FORMATS.items():
            with self.subTest(fmt=fmt):
                r = self.client.get(self.list_url(fmt))
                self.assertEqual(r.status_code, 200)
                self.assertTrue(r.content.startswith(magic))
                self.assertIn(f'attendance-list-gambia-youth-summit.{fmt}"',
                              r["Content-Disposition"])

    def test_every_report_format_downloads_as_a_separate_file(self):
        for fmt, magic in REPORT_FORMATS.items():
            with self.subTest(fmt=fmt):
                r = self.client.get(self.report_url(fmt))
                self.assertEqual(r.status_code, 200)
                self.assertTrue(r.content.startswith(magic))
                self.assertIn(f'attendance-report-gambia-youth-summit.{fmt}"',
                              r["Content-Disposition"])

    def test_xlsx_list_is_a_filterable_table_with_live_counts(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(L.build_attendance_xlsx(self.ev)))
        ws = wb["Attendance"]
        self.assertIn("Attendance", ws.tables)
        self.assertTrue(str(ws["B5"].value).startswith("=COUNTA("))
        headers = [c.value for c in ws[7] if c.value]
        self.assertEqual(len(headers), len(set(headers)))
        self.assertEqual(ws.tables["Attendance"].ref, f"A7:{ws.cell(7, len(headers)).column_letter}12")

    def test_docx_list_repeats_no_identity_columns(self):
        from docx import Document
        doc = Document(io.BytesIO(L.build_attendance_docx(self.ev)))
        header = [c.text for c in doc.tables[2].rows[0].cells]
        self.assertIn("Name", header)
        self.assertNotIn("Full name", header)
        self.assertNotIn("Status", header)   # it's the group heading instead

    def test_unknown_format_is_404(self):
        self.assertEqual(self.client.get(self.list_url("exe")).status_code, 404)
        self.assertEqual(self.client.get(self.report_url("csv")).status_code, 404)

    def test_other_organizers_cannot_download(self):
        other = get_user_model().objects.create_user("other", password="pw-pw-pw-123")
        self.client.force_login(other)
        self.assertEqual(self.client.get(self.list_url("pdf")).status_code, 404)
        self.assertEqual(self.client.get(self.report_url("pdf")).status_code, 404)

    def test_anonymous_visitors_are_sent_to_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.list_url("xlsx")).status_code, 302)

    def test_event_page_offers_list_and_report_downloads(self):
        html = self.client.get(f"/attendance/{self.ev.pk}/").content.decode()
        for fmt in ("xlsx", "docx", "pdf", "csv"):
            self.assertIn(self.list_url(fmt), html)
        for fmt in ("xlsx", "docx", "pdf"):
            self.assertIn(self.report_url(fmt), html)

    def test_empty_event_still_builds_every_file(self):
        empty = AttendanceEvent.objects.create(
            owner=self.host, title="Nobody yet", starts_at=timezone.now() + dt.timedelta(days=5),
            ends_at=timezone.now() + dt.timedelta(days=5, hours=3))
        for build in (L.build_attendance_xlsx, L.build_attendance_docx, L.build_attendance_pdf,
                      L.build_attendance_csv, R.build_report_xlsx, R.build_report_docx,
                      R.build_report_pdf):
            with self.subTest(build=build.__name__):
                self.assertTrue(build(empty))


class ReportNumbersTests(ExportTestBase):
    def test_report_counts_people_not_registrations(self):
        ctx = R.build_report_context(self.ev)
        self.assertEqual(ctx["total"], 5)
        self.assertEqual(ctx["checked_in"], 1)
        self.assertEqual(ctx["accepted"], 4)          # Awa + Lamin + the Touray siblings
        self.assertEqual(ctx["show_rate"], 25)
        self.assertEqual(ctx["pending"], 1)

    def test_report_tables_cover_days_methods_and_answers(self):
        ctx = R.build_report_context(self.ev)
        self.assertEqual([d["arrived"] for d in ctx["by_day"]], [1, 1])
        self.assertEqual(ctx["methods"][0]["label"], "Personal QR")
        self.assertEqual(ctx["every_day"], 1)
        diet = next(b for b in ctx["breakdowns"] if b["label"] == "Dietary needs")
        self.assertEqual(sum(row["count"] for row in diet["rows"]), 3)

    def test_highlights_mention_pending_approvals(self):
        ctx = R.build_report_context(self.ev)
        self.assertTrue(any("waiting for your approval" in h for h in ctx["highlights"]))
