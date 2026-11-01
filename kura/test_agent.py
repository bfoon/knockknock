"""
Tests for Foon, Kura's AI assistant.

    python manage.py test kura.test_agent

Covers the deterministic engine (charts, tables, cards, maps, shapes,
cleaning, privacy, dashboards, questionnaires), the privacy promise that no
raw answer reaches the language model, the built-in planner, every HTTP
endpoint with permissions, the file exports and the page injection rules.
"""

import io
import json
import random
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from . import agent_ai, agent_engine as eng
from .models import FormVersion, Submission, Survey

User = get_user_model()

REGIONS = ["Banjul", "Kanifing", "West Coast", "North Bank", "Lower River", "Central River", "Upper River"]
SCHEMA = {
    "settings": {"anonymous": True},
    "questions": [
        {"name": "intro", "type": "note", "label": "Welcome"},
        {"name": "consent", "type": "select_one", "label": "Do you agree?", "required": True,
         "choices": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
        {"name": "full_name", "type": "text", "label": "Respondent's full name"},
        {"name": "phone", "type": "text", "label": "Phone number"},
        {"name": "age", "type": "integer", "label": "How old are you?", "required": True},
        {"name": "sex", "type": "select_one", "label": "Sex",
         "choices": [{"value": "f", "label": "Female"}, {"value": "m", "label": "Male"}]},
        {"name": "region", "type": "select_one", "label": "Region",
         "choices": [{"value": r.lower().replace(" ", "_"), "label": r} for r in REGIONS]},
        {"name": "water", "type": "select_one", "label": "Main water source",
         "choices": [{"value": "tap", "label": "Tap"}, {"value": "well", "label": "Well"},
                     {"value": "borehole", "label": "Borehole"}]},
        {"name": "assets", "type": "select_multiple", "label": "Assets owned",
         "choices": [{"value": "radio", "label": "Radio"}, {"value": "tv", "label": "TV"},
                     {"value": "phone_set", "label": "Mobile phone"}]},
        {"name": "satisfaction", "type": "likert", "label": "I am satisfied",
         "choices": [{"value": str(i), "label": l} for i, l in
                     enumerate(["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"], 1)]},
        {"name": "income", "type": "decimal", "label": "Monthly income"},
        {"name": "village", "type": "text", "label": "Village name"},
        {"name": "hh_gps", "type": "gps", "label": "Household location"},
        {"name": "comments", "type": "long_text", "label": "Any comments?"},
        {"name": "members", "type": "repeat", "label": "Household members",
         "children": [{"name": "m_age", "type": "integer", "label": "Member age"}]},
        {"name": "bmi", "type": "calculate", "label": "BMI", "calc": "1"},
    ],
}
SECRET_NAMES = ["Fatou Ceesay", "Lamin Jallow", "Awa Touray", "Ebrima Sowe"]


def make_survey(owner, n=60, seed=7):
    rnd = random.Random(seed)
    s = Survey.objects.create(owner=owner, title="Household test survey", draft_schema=SCHEMA, state="collecting")
    fv = FormVersion.objects.create(survey=s, version=1, schema=SCHEMA, is_current=True, published_by=owner)
    now = timezone.now()
    for i in range(n):
        ans = {
            "consent": "yes",
            "full_name": SECRET_NAMES[i % 4] + ("  " if i % 9 == 0 else ""),
            "phone": f"+220 7{i:06d}",
            "age": 18 + (i * 7) % 60,
            "sex": "f" if i % 3 else "m",
            "region": REGIONS[i % 7].lower().replace(" ", "_"),
            "water": ["tap", "well", "borehole"][i % 3],
            "assets": ["radio", "tv"] if i % 2 else ["phone_set"],
            "satisfaction": str(1 + i % 5),
            "income": 2000 + rnd.randint(0, 3000) if i != 5 else 9_999_999,
            "village": " Brikama" if i % 4 == 0 else "Brikama",
            "hh_gps": f"{13.2 + i * 0.01:.5f} {-16.6 + i * 0.01:.5f}",
            "comments": "My neighbour Fatou Ceesay helped" if i == 3 else "",
            "members": [{"m_age": 30}, {"m_age": 4}],
        }
        sub = Submission.objects.create(survey=s, form_version=fv, answers=ans, calculations={"bmi": 20 + i % 5},
                                        status="complete", source="app" if i % 2 else "web",
                                        gps_lat=13.4, gps_lng=-16.6, duration_ms=300000 + i * 1000)
        Submission.objects.filter(pk=sub.pk).update(received_at=now - timedelta(hours=i * 5))
    # an exact duplicate submission
    dup = Submission.objects.filter(survey=s).first()
    Submission.objects.create(survey=s, form_version=fv, answers=dup.answers, calculations=dup.calculations,
                              status="complete", source="web")
    return s


class AgentEngineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("owner", password="pw", first_name="Baboucarr")
        cls.survey = make_survey(cls.owner)

    def ctx(self, page="data"):
        from .agent_views import build_context
        return build_context(self.owner, self.survey.code, page)

    def test_catalog_uses_frame_column_names(self):
        ctx = self.ctx()
        names = {f["name"] for f in ctx.catalog}
        self.assertIn("calc__bmi", names)
        self.assertNotIn("intro", names)
        self.assertIn("calc__bmi", ctx.frame.columns)

    def test_pii_classification(self):
        ctx = self.ctx()
        det = {f["name"]: eng.detect_pii(f, ctx.frame.get(f["name"])) for f in ctx.catalog}
        self.assertEqual(det["full_name"]["level"], "direct")
        self.assertEqual(det["full_name"]["action"], "drop")
        self.assertEqual(det["phone"]["level"], "direct")
        self.assertEqual(det["hh_gps"]["action"], "drop")
        self.assertEqual(det["age"], {"level": "quasi", "reason": "age", "action": "band10"})
        self.assertEqual(det["comments"]["action"], "drop")
        self.assertEqual(det["village"]["level"], "quasi")      # "village name" is a place, not a person
        self.assertEqual(det["water"]["level"], "none")

    def test_prompt_never_contains_raw_answers(self):
        ctx = self.ctx()
        prompt = agent_ai.build_user_prompt(ctx, "tell me about my data", [])
        for name in SECRET_NAMES:
            self.assertNotIn(name, prompt)
        self.assertNotIn("+220 7000001", prompt)
        self.assertNotIn("Brikama", prompt)
        self.assertNotIn("13.21", prompt)
        self.assertIn("Female", prompt)                    # aggregates are allowed
        self.assertIn("⚠ direct", prompt)

    def test_chart_bar_uses_labels_and_percentages(self):
        b = eng.run_tool(self.ctx(), {"tool": "chart", "kind": "bar", "x": "region"})
        self.assertEqual(b["type"], "chart", b)
        self.assertTrue(set(b["labels"]) <= set(REGIONS))
        self.assertAlmostEqual(sum(b["percent"]), 100, delta=1)
        self.assertIn("Most common", b["caption"])

    def test_chart_likert_keeps_form_order(self):
        b = eng.run_tool(self.ctx(), {"tool": "chart", "kind": "bar", "x": "satisfaction"})
        self.assertEqual(b["labels"][0], "Strongly disagree")
        self.assertEqual(b["labels"][-1], "Strongly agree")

    def test_chart_multi_select_is_exploded(self):
        b = eng.run_tool(self.ctx(), {"tool": "chart", "kind": "hbar", "x": "assets"})
        self.assertEqual(set(b["labels"]), {"Radio", "TV", "Mobile phone"})
        self.assertIn("more than one answer", b["caption"])

    def test_chart_variants(self):
        ctx = self.ctx()
        g = eng.run_tool(ctx, {"tool": "chart", "kind": "stacked", "x": "region", "group_by": "sex"})
        self.assertEqual(len(g["series"]), 2)
        m = eng.run_tool(ctx, {"tool": "chart", "kind": "bar", "x": "sex", "y": "age", "agg": "mean"})
        self.assertEqual(m["type"], "chart")
        hst = eng.run_tool(ctx, {"tool": "chart", "kind": "histogram", "x": "age"})
        self.assertIn("Mean", hst["caption"])
        sc = eng.run_tool(ctx, {"tool": "chart", "kind": "scatter", "x": "age", "y": "calc__bmi"})
        self.assertIn("Correlation", sc["caption"])
        ts = eng.run_tool(ctx, {"tool": "chart", "kind": "timeseries", "freq": "D"})
        self.assertEqual(ts["chart"], "line")
        self.assertTrue(ts["labels"])

    def test_filters_accept_choice_labels(self):
        b = eng.run_tool(self.ctx(), {"tool": "cards", "cards": [
            {"label": "Women", "agg": "count", "filters": [{"field": "sex", "operator": "eq", "value": "Female"}]},
            {"label": "Share of women", "format": "percent", "filters": [{"field": "sex", "operator": "eq", "value": "Female"}]},
            {"label": "Has a radio", "agg": "count", "filters": [{"field": "assets", "operator": "eq", "value": "Radio"}]},
        ]})
        women, share, radio = b["cards"]
        df = self.ctx().frame
        self.assertEqual(women["value"], int((df["sex"] == "f").sum()))
        self.assertAlmostEqual(share["value"], round((df["sex"] == "f").mean() * 100, 1))
        self.assertEqual(radio["value"], int(df["assets"].apply(lambda v: "radio" in v).sum()))

    def test_tables(self):
        ctx = self.ctx()
        f = eng.run_tool(ctx, {"tool": "table", "mode": "frequency", "x": "water"})
        self.assertEqual(f["columns"], ["Main water source", "Responses", "Percent"])
        c = eng.run_tool(ctx, {"tool": "table", "mode": "crosstab", "x": "region", "group_by": "sex", "percent": "row"})
        self.assertIn("Female", c["columns"])
        g = eng.run_tool(ctx, {"tool": "table", "mode": "group", "group_by": "water", "y": "age"})
        self.assertIn("Mean", g["columns"])
        r = eng.run_tool(ctx, {"tool": "table", "mode": "rows", "columns": ["sex", "assets"], "limit": 5})
        self.assertEqual(len(r["rows"]), 5)
        self.assertTrue(r["row_level"])
        self.assertIn(r["rows"][0]["Sex"], ("Female", "Male"))
        sm = eng.run_tool(ctx, {"tool": "table", "mode": "summary"})
        self.assertIn("Median", sm["columns"])

    def test_map_and_shapes(self):
        ctx = self.ctx()
        m = eng.run_tool(ctx, {"tool": "map", "color_by": "water"})
        self.assertEqual(m["type"], "map", m)
        self.assertEqual(set(m["legend"]), {"Tap", "Well", "Borehole"})
        r = eng.run_tool(ctx, {"tool": "shape", "kind": "ring", "x": "sex"})
        self.assertEqual(len(r["items"]), 2)
        fn = eng.run_tool(ctx, {"tool": "shape", "kind": "funnel", "items": [
            {"label": "Everyone"}, {"label": "Women", "filters": [{"field": "sex", "operator": "eq", "value": "f"}]},
            {"label": "Women with a TV", "filters": [{"field": "sex", "operator": "eq", "value": "f"},
                                                     {"field": "assets", "operator": "eq", "value": "tv"}]}]})
        vals = [i["value"] for i in fn["items"]]
        self.assertEqual(vals, sorted(vals, reverse=True))

    def test_profile_finds_problems(self):
        b = eng.run_tool(self.ctx(), {"tool": "profile"})
        text = " ".join(i["text"] for i in b["issues"])
        self.assertGreaterEqual(b["duplicates"], 1)
        self.assertIn("extreme", text)
        self.assertIn("stray spaces", text)
        self.assertIn("personal data", text)

    def test_auto_clean(self):
        ctx = self.ctx()
        b = eng.run_tool(ctx, {"tool": "clean", "auto": True})
        ops = [s["operation"] for s in b["steps"]]
        self.assertIn("trim_text", ops)
        self.assertIn("deduplicate", ops)
        self.assertTrue(all(s["status"] == "ok" for s in b["steps"]), b["steps"])
        self.assertLess(b["after"]["rows"], b["before"]["rows"])
        clean, _ = eng.run_clean(ctx, b["spec"]["steps"])
        self.assertFalse(clean["village"].astype(str).str.startswith(" ").any())
        # originals untouched
        self.assertTrue(Submission.objects.filter(answers__village=" Brikama").exists())

    def test_clean_rejects_unknown_operations(self):
        b = eng.run_tool(self.ctx(), {"tool": "clean", "steps": [{"operation": "rm_rf", "config": {}}]})
        # an unknown operation is refused, never swapped for something else
        self.assertEqual(b["type"], "error")
        self.assertIn("cleaning steps", b["text"])

    def test_privacy_copy(self):
        ctx = self.ctx()
        out, plan, k = eng.run_privacy(ctx, {})
        cols = set(out.columns)
        for gone in ("full_name", "hh_gps", "comments", "_uuid", "_gps_lat", "members"):
            self.assertNotIn(gone, cols)
        self.assertIn("phone", cols)
        self.assertTrue(out["phone"].dropna().str.startswith("id_").all())
        self.assertTrue(out["age"].dropna().str.contains("–").all())
        flat = out.astype(str).to_string()
        for name in SECRET_NAMES:
            self.assertNotIn(name, flat)
        self.assertIn("row_id", cols)
        self.assertGreater(k["at_risk"], 0)
        out2, _p, k2 = eng.run_privacy(ctx, {"suppress": True, "k": 3})
        self.assertEqual(k2["suppressed"], k2["at_risk"])
        self.assertLess(len(out2), len(out))
        out3, _p, _k = eng.run_privacy(ctx, {"rules": {"hh_gps": "round2", "phone": "drop"}})
        self.assertNotIn("phone", out3.columns)
        self.assertTrue(out3["hh_gps"].str.fullmatch(r"\d+\.\d{1,2} -\d+\.\d{1,2}").all(), out3["hh_gps"].head())

    def test_pseudonyms_are_stable_and_one_way(self):
        a = eng._pseudo("ABC", "phone", "+2207000001")
        self.assertEqual(a, eng._pseudo("ABC", "phone", "+2207000001"))
        self.assertNotEqual(a, eng._pseudo("XYZ", "phone", "+2207000001"))
        self.assertNotIn("7000001", a)

    def test_auto_dashboard(self):
        b = eng.run_tool(self.ctx(), {"tool": "dashboard", "auto": True, "theme": "ocean"})
        self.assertEqual(b["type"], "dashboard")
        self.assertEqual(b["theme"], "ocean")
        kinds = {it["block"]["type"] for it in b["items"]}
        self.assertTrue({"cards", "chart", "map"} <= kinds, kinds)
        self.assertFalse([it for it in b["items"] if it["block"]["type"] == "error"],
                         [it["block"] for it in b["items"] if it["block"]["type"] == "error"])
        for it in b["items"]:
            self.assertLessEqual(it["x"] + it["w"], 12)

    def test_questionnaire_sanitizer(self):
        qs = eng.sanitize_questions([
            {"type": "radio", "label": "Do you agree?", "name": "consent", "choices": ["Yes", "No"]},
            {"type": "number", "label": "Age", "name": "consent"},                         # duplicate name
            {"type": "weird", "label": "Something"},                                      # unknown type
            {"type": "text", "label": "Why not?", "relevant": {"op": "and", "rules": [
                {"q": "consent", "cmp": "eq", "value": "no"}, {"q": "later_q", "cmp": "eq", "value": 1}]}},
            {"type": "select_one", "label": "Later", "name": "later_q", "choices": []},
            {"type": "repeat", "label": "Members", "children": [{"type": "integer", "label": "Member age"},
                                                                {"type": "repeat", "label": "nested"}]},
        ])
        self.assertEqual(qs[0]["type"], "select_one")
        self.assertEqual([c["label"] for c in qs[0]["choices"]], ["Yes", "No"])
        self.assertEqual(qs[1]["type"], "integer")
        self.assertNotEqual(qs[1]["name"], "consent")
        self.assertEqual(qs[2]["type"], "text")
        self.assertEqual(qs[3]["relevant"]["rules"], [{"q": "consent", "cmp": "eq", "value": "no"}])
        self.assertEqual(len(qs[4]["choices"]), 2)                                         # filled in
        self.assertEqual(qs[5]["children"][1]["type"], "text")                            # no nested repeats
        names = [q["name"] for q in qs] + [c["name"] for c in qs[5]["children"]]
        self.assertEqual(len(names), len(set(names)))

    def test_review_form(self):
        sch = json.loads(json.dumps(SCHEMA))
        sch["questions"].append({"name": "pick", "type": "select_one", "label": "Pick one",
                                 "choices": [{"value": "option_1", "label": "Option 1"}]})
        sch["questions"].append({"name": "late", "type": "text", "label": "Late",
                                 "relevant": {"op": "and", "rules": [{"q": "nowhere", "cmp": "eq", "value": 1}]}})
        ctx = self.ctx("builder")
        ctx.draft_schema = sch
        b = eng.run_tool(ctx, {"tool": "review_form"})
        text = " ".join(i["text"] for i in b["issues"])
        self.assertIn("placeholder", text)
        self.assertIn("fewer than two", text)
        self.assertIn("doesn't come earlier", text)

    def test_review_groups_repeated_advice(self):
        b = eng.run_tool(self.ctx(), {"tool": "review_form"})
        ranges = [i for i in b["issues"] if "minimum or maximum" in i["text"]]
        self.assertEqual(len(ranges), 1)                      # one grouped line, not one per question
        self.assertFalse([i for i in b["issues"] if "Do you agree" in i["text"] and "Other" in i["text"]])

    def test_dashboard_rows_have_no_holes(self):
        tiles = eng.layout_tiles([{"kind": "kpi"}, {"kind": "kpi"}, {"kind": "kpi"},
                                  {"kind": "timeseries"}, {"kind": "pie"}, {"kind": "hbar"}])
        rows = {}
        for t in tiles:
            rows.setdefault(t["y"], []).append(t)
        for row in rows.values():
            self.assertEqual(sum(t["w"] for t in row), 12)
            self.assertEqual(len({t["h"] for t in row}), 1)

    def test_whole_number_histogram_bands(self):
        b = eng.run_tool(self.ctx(), {"tool": "chart", "kind": "histogram", "x": "age"})
        self.assertRegex(b["labels"][0], r"^\d+–\d+$")

    def test_clean_blank_share_ignores_marker_columns(self):
        b = eng.run_tool(self.ctx(), {"tool": "clean", "auto": True})
        self.assertLessEqual(b["after"]["missing_pct"], b["before"]["missing_pct"] + 0.5)

    def test_tool_errors_are_friendly(self):
        b = eng.run_tool(self.ctx(), {"tool": "chart", "x": "no_such_column"})
        self.assertEqual(b["type"], "error")
        self.assertIn("no_such_column", b["text"])
        self.assertEqual(eng.run_tool(self.ctx(), {"tool": "launch_rockets"})["type"], "error")


class BuiltinPlannerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("owner2", password="pw")
        cls.survey = make_survey(cls.owner, n=20)

    def plan(self, msg, code=True, page="data"):
        from .agent_views import build_context
        ctx = build_context(self.owner, self.survey.code if code else None, page)
        return agent_ai.normalise_plan(agent_ai.builtin_plan(ctx, msg)), ctx

    def tools(self, msg, **kw):
        p, _ctx = self.plan(msg, **kw)
        return [a["tool"] for a in p["actions"]]

    def test_intents(self):
        self.assertEqual(self.tools("make me a dashboard"), ["dashboard"])
        self.assertEqual(self.tools("clean my data"), ["clean"])
        self.assertEqual(self.tools("make a privacy safe copy to share"), ["privacy"])
        self.assertEqual(self.tools("any data problems?"), ["profile"])
        self.assertIn("overview", self.tools("how is collection going today?"))
        self.assertEqual(self.tools("map the responses by water source"), ["map"])
        self.assertEqual(self.tools("draft a questionnaire about clinic waiting times"), ["questionnaire"])
        self.assertEqual(self.tools("key numbers as cards"), ["cards"])
        self.assertEqual(self.tools("review my form", page="builder"), ["review_form"])

    def test_chart_picks_the_right_column(self):
        p, _ = self.plan("pie chart of water source")
        a = p["actions"][0]
        self.assertEqual((a["tool"], a["kind"], a["x"]), ("chart", "pie", "water"))
        p, _ = self.plan("chart region by sex")
        self.assertEqual(p["actions"][0].get("group_by"), "sex")
        p, _ = self.plan("table of region by sex in percent")
        self.assertEqual(p["actions"][0]["mode"], "crosstab")

    def test_no_survey(self):
        p, _ = self.plan("chart something", code=False, page="list")
        self.assertEqual(p["actions"], [])
        self.assertEqual(self.tools("show my surveys", code=False, page="list"), ["surveys"])

    def test_template_skips_questions_the_form_already_has(self):
        p, _ = self.plan("draft a questionnaire about household water", page="builder")
        names = [q["name"] for q in p["actions"][0]["questions"]]
        for already in ("consent", "age", "sex", "region"):
            self.assertNotIn(already, names)
        # every skip rule still points at a real question: the form's own consent, or one in the template
        known = set(names) | {q["name"] for q in SCHEMA["questions"]}
        rules = [r for q in p["actions"][0]["questions"] for r in (q.get("relevant") or {}).get("rules", [])]
        self.assertTrue(rules)
        self.assertTrue(all(r["q"] in known for r in rules))
        self.assertIn("consent", {r["q"] for r in rules})

    def test_templates(self):
        for topic, title in [("household", "Household survey"), ("school", "School and learning survey"),
                             ("water and sanitation", "WASH survey"), ("farming", "Farm and harvest survey")]:
            q = agent_ai.template_questionnaire(f"draft a survey about {topic}")
            self.assertEqual(q["title"], title)
            qs = eng.sanitize_questions(q["questions"])
            self.assertEqual(qs[1]["name"], "consent")
            self.assertTrue(all(x["relevant"] for x in qs[2:]))     # gated on consent


class AgentViewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("own", password="pw", first_name="Baboucarr")
        cls.outsider = User.objects.create_user("out", password="pw")
        cls.viewer = User.objects.create_user("viewer", password="pw")
        cls.survey = make_survey(cls.owner, n=25)
        from .models_team import SurveyCollaborator
        SurveyCollaborator.objects.create(survey=cls.survey, user=cls.viewer, role="viewer")

    def setUp(self):
        cache.clear()

    def post(self, url, data, user=None):
        self.client.force_login(user or self.owner)
        return self.client.post(url, json.dumps(data), content_type="application/json")

    def test_status(self):
        self.client.force_login(self.owner)
        r = self.client.get("/kura/agent/status/", {"code": self.survey.code, "page": "data"})
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertTrue(j["can"]["export"])
        self.assertEqual(j["survey"]["code"], self.survey.code)
        self.client.force_login(self.outsider)
        r = self.client.get("/kura/agent/status/", {"code": self.survey.code})
        self.assertEqual(r.status_code, 404)

    def test_chat_builtin_when_ai_off(self):
        with mock.patch.object(agent_ai, "ai_enabled", return_value=False):
            r = self.post("/kura/agent/chat/", {"message": "pie chart of water source", "code": self.survey.code, "page": "data"})
        j = r.json()
        self.assertEqual(r.status_code, 200, j)
        self.assertEqual(j["model"], "foon-builtin")
        self.assertIn("built-in", j["notice"])
        self.assertEqual(j["blocks"][0]["type"], "chart")
        self.assertEqual(j["blocks"][0]["chart"], "pie")

    def test_chat_with_ai_plan(self):
        fake = {"say": "Here is your **breakdown**.", "mood": "proud", "suggestions": ["Split by sex"],
                "actions": [{"tool": "chart", "kind": "donut", "x": "region"},
                            {"tool": "table", "mode": "crosstab", "x": "water", "group_by": "sex"},
                            {"tool": "not_a_tool"}]}
        from hanns import ai as hai
        with mock.patch.object(hai, "is_enabled", return_value=True), \
                mock.patch.object(hai, "ai_json", return_value=(fake, "gemini-flash-latest")) as m:
            r = self.post("/kura/agent/chat/", {"message": "regions please", "code": self.survey.code, "page": "data",
                                                "history": [{"role": "user", "text": "hi"}]})
        j = r.json()
        self.assertEqual(j["model"], "gemini-flash-latest")
        self.assertEqual([b["type"] for b in j["blocks"]], ["chart", "table"])
        self.assertIsNone(j["notice"])
        sent_prompt = m.call_args[0][1]
        for name in SECRET_NAMES:
            self.assertNotIn(name, sent_prompt)
        self.assertLess(j["quotaLeft"], agent_ai.hourly_limit())

    def test_chat_falls_back_when_gemini_fails(self):
        from hanns import ai as hai
        with mock.patch.object(hai, "is_enabled", return_value=True), \
                mock.patch.object(hai, "ai_json", side_effect=hai.AIError("quota used up", status=429)):
            r = self.post("/kura/agent/chat/", {"message": "make a dashboard", "code": self.survey.code, "page": "data"})
        j = r.json()
        self.assertEqual(j["model"], "foon-builtin")
        self.assertIn("quota used up", j["notice"])
        self.assertEqual(j["blocks"][0]["type"], "dashboard")

    def test_chat_denied_for_outsider(self):
        r = self.post("/kura/agent/chat/", {"message": "hi", "code": self.survey.code}, user=self.outsider)
        self.assertEqual(r.status_code, 404)

    def test_exports(self):
        spec = {"tool": "chart", "kind": "bar", "x": "region"}
        for fmt, ctype in [("csv", "text/csv"), ("xlsx", "spreadsheetml"), ("html", "text/html")]:
            r = self.post("/kura/agent/export/", {"code": self.survey.code, "spec": spec, "format": fmt})
            self.assertEqual(r.status_code, 200, (fmt, r.content[:200]))
            self.assertIn(ctype, r["Content-Type"])
            self.assertIn(self.survey.code, r["X-Foon-Filename"])
        html = self.post("/kura/agent/export/", {"code": self.survey.code, "format": "html",
                                                 "spec": {"tool": "dashboard", "auto": True}}).content.decode()
        self.assertIn("foon-export", html)
        self.assertIn("chart.umd.min.js", html)
        self.assertIn("leaflet", html)
        geo = self.post("/kura/agent/export/", {"code": self.survey.code, "format": "geojson", "spec": {"tool": "map"}})
        self.assertEqual(json.loads(geo.content)["type"], "FeatureCollection")

    def test_row_level_export_has_every_row_and_no_names(self):
        r = self.post("/kura/agent/export/", {"code": self.survey.code, "format": "csv", "spec": {"tool": "privacy"}})
        body = r.content.decode("utf-8-sig")
        self.assertEqual(body.count("\n"), 25 + 1 + 1)   # header + 25 + the duplicate
        for name in SECRET_NAMES:
            self.assertNotIn(name, body)
        x = self.post("/kura/agent/export/", {"code": self.survey.code, "format": "xlsx", "spec": {"tool": "privacy"}})
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(x.content))
        self.assertEqual(wb.sheetnames, ["Safe data", "Privacy report", "Re-identification check"])

    def test_viewer_cannot_download_rows(self):
        r = self.post("/kura/agent/export/", {"code": self.survey.code, "format": "csv", "spec": {"tool": "clean", "auto": True}},
                      user=self.viewer)
        self.assertEqual(r.status_code, 400)
        self.assertIn("permission", r.json()["error"])
        ok = self.post("/kura/agent/export/", {"code": self.survey.code, "format": "csv",
                                               "spec": {"tool": "chart", "x": "sex"}}, user=self.viewer)
        self.assertEqual(ok.status_code, 200)

    def test_kura_form_round_trip_shape(self):
        q = agent_ai.template_questionnaire("survey about a health clinic")
        r = self.post("/kura/agent/export/", {"format": "kuraform", "spec": {"tool": "questionnaire", **q}})
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        self.assertIn("Questions", wb.sheetnames)
        rows = list(wb["Questions"].iter_rows(values_only=True))
        self.assertEqual(rows[0][0], "Type")
        self.assertIn("Choose one", [r_[0] for r_ in rows])
        show = [r_[6] for r_ in rows if r_[6]]
        self.assertIn("consent = yes", show)

    def test_apply_actions(self):
        q = agent_ai.template_questionnaire("event feedback for a workshop")
        r = self.post("/kura/agent/apply/", {"action": "create_survey", **q})
        j = r.json()
        self.assertTrue(j["ok"], j)
        new = Survey.objects.get(code=j["code"])
        self.assertEqual(new.owner, self.owner)
        self.assertEqual(new.draft_schema["questions"][1]["name"], "consent")

        r = self.post("/kura/agent/apply/", {"action": "add_questions", "code": self.survey.code,
                                             "questions": [{"type": "text", "label": "Extra", "name": "age"}]})
        self.assertTrue(r.json()["ok"])
        self.survey.refresh_from_db()
        names = [x["name"] for x in self.survey.draft_schema["questions"]]
        self.assertEqual(len(names), len(set(names)))

        dash = eng.run_tool(_ctx(self.owner, self.survey), {"tool": "dashboard", "auto": True})
        r = self.post("/kura/agent/apply/", {"action": "create_dashboard", "code": self.survey.code,
                                             "title": dash["title"], "theme": "forest", "tiles": dash["spec"]["tiles"]})
        j = r.json()
        self.assertTrue(j["ok"], j)
        from .models_dashboard import LiveDashboard
        board = LiveDashboard.objects.get(survey=self.survey)
        self.assertEqual(board.tiles.count(), len(dash["spec"]["tiles"]))
        self.assertTrue(j["url"].endswith(f"/dash/{board.id}/"))

        cl = eng.run_tool(_ctx(self.owner, self.survey), {"tool": "clean", "auto": True})
        r = self.post("/kura/agent/apply/", {"action": "save_pipeline", "code": self.survey.code,
                                             "name": "Foon test", "steps": cl["spec"]["steps"]})
        self.assertTrue(r.json()["ok"], r.json())
        pipe = self.survey.pipelines.get(name="Foon test")
        self.assertEqual(pipe.steps.count(), len(cl["spec"]["steps"]))
        # and it runs in the real studio executor
        from .models import CleaningRun
        from .pipeline_engine import PipelineExecutor
        run = CleaningRun.objects.create(pipeline=pipe)
        PipelineExecutor(run).execute()
        run.refresh_from_db()
        self.assertEqual(run.status, "complete")

        r = self.post("/kura/agent/apply/", {"action": "save_dataset", "code": self.survey.code, "spec": {}})
        self.assertTrue(r.json()["ok"], r.json())
        ds = self.survey.datasets.latest("id")
        self.assertNotIn("full_name", ds.columns)

        r = self.post("/kura/agent/apply/", {"action": "set_state", "code": self.survey.code, "state": "paused"})
        self.assertTrue(r.json()["ok"])
        self.survey.refresh_from_db()
        self.assertEqual(self.survey.state, "paused")

    def test_viewer_cannot_apply(self):
        for action in ("add_questions", "save_pipeline", "save_dataset", "set_state", "create_dashboard"):
            r = self.post("/kura/agent/apply/", {"action": action, "code": self.survey.code,
                                                 "questions": [{"type": "text", "label": "x"}],
                                                 "steps": [{"operation": "trim_text", "config": {"field": "village"}}],
                                                 "state": "closed", "tiles": [{"kind": "kpi", "spec": {}}]},
                          user=self.viewer)
            self.assertEqual(r.status_code, 403, action)


def _ctx(user, survey, page="data"):
    from .agent_views import build_context
    return build_context(user, survey.code, page)


@override_settings(STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
class AgentMiddlewareTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("mw", password="pw")
        cls.outsider = User.objects.create_user("mw2", password="pw")
        cls.survey = make_survey(cls.owner, n=3)

    def test_injected_on_owner_pages(self):
        self.client.force_login(self.owner)
        for url in (f"/kura/{self.survey.code}/build/", f"/kura/{self.survey.code}/data/", "/kura/"):
            r = self.client.get(url)
            self.assertEqual(r.status_code, 200, url)
            body = r.content.decode()
            self.assertIn('id="foon-config"', body, url)
            self.assertIn("kura/agent/foon.js", body)
            self.assertLess(body.index("foon-config"), body.rindex("</body>"))

    def test_config_is_safe_json(self):
        self.survey.title = '</script><script>alert(1)</script>'
        self.survey.save()
        self.client.force_login(self.owner)
        body = self.client.get(f"/kura/{self.survey.code}/data/").content.decode()
        start = body.index('id="foon-config"')
        chunk = body[start:start + 2000]
        self.assertNotIn("<script>alert(1)", chunk)

    def test_not_on_public_runner_or_for_anonymous(self):
        r = self.client.get(f"/kura/{self.survey.code}/")
        self.assertNotIn(b"foon-config", r.content)
        self.client.force_login(self.owner)
        r = self.client.get(f"/kura/{self.survey.code}/")
        self.assertNotIn(b"foon-config", r.content)

    def test_opt_out_and_switch(self):
        self.client.force_login(self.owner)
        r = self.client.get(f"/kura/{self.survey.code}/data/?foon=0")
        self.assertNotIn(b"foon-config", r.content)
        with override_settings(KURA_AGENT_ENABLED=False):
            r = self.client.get(f"/kura/{self.survey.code}/data/")
            self.assertNotIn(b"foon-config", r.content)


# ─────────────────────────────────────────────────────────────────────
#  Studios: Foon editing the Dashboard Studio and the Data Studio
# ─────────────────────────────────────────────────────────────────────

def dash_snapshot(tiles=None):
    return {"kind": "dashboard", "rev": "123",
            "board": {"id": 1, "name": "Field board", "theme": "studio", "theme_config": {}, "filters": [],
                      "filter_match": "all", "source": "submissions", "refresh_seconds": 0, "is_live": True},
            "tiles": tiles if tiles is not None else [
                {"id": 11, "kind": "kpi", "title": "Responses", "x": 0, "y": 0, "w": 3, "h": 2, "spec": {"agg": "count"}},
                {"id": 12, "kind": "hbar", "title": "Region", "x": 0, "y": 2, "w": 6, "h": 4, "spec": {"x": "region"}},
                {"id": 13, "kind": "table", "title": "Latest responses", "x": 6, "y": 2, "w": 6, "h": 4, "spec": {"limit": 25}},
            ],
            "fields": [{"name": "region", "label": "Region", "kind": "categorical", "unique": 7},
                       {"name": "water", "label": "Main water source", "kind": "categorical", "unique": 3},
                       {"name": "sex", "label": "Sex", "kind": "categorical", "unique": 2},
                       {"name": "age", "label": "How old are you?", "kind": "numeric"},
                       {"name": "_received_at", "label": "Received at", "kind": "datetime", "meta": True}],
            "pipelines": [{"id": 5, "name": "Main clean"}], "datasets": []}


def flow_snapshot(steps=None):
    return {"kind": "flow", "rev": "abc",
            "pipeline": {"id": 9, "name": "Main clean", "is_active": True, "source": "submissions",
                         "steps": steps if steps is not None else [
                             {"operation": "trim_text", "name": "Tidy village", "config": {"field": "village", "_ui": {"x": 1}}},
                             {"operation": "deduplicate", "name": "Remove repeats", "config": {"fields": [], "keep": "first"}},
                         ]},
            "pipelines": [{"id": 9, "name": "Main clean", "step_count": 2}, {"id": 10, "name": "Second pass", "step_count": 1}],
            "columns": ["consent", "full_name", "phone", "age", "sex", "region", "water", "village", "income"],
            "datasets": [], "op_defaults": {"trim_text": {"field": "consent"}, "fill_missing": {"field": "consent", "method": "median"}}}


class StudioEngineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("studio", password="pw")
        cls.survey = make_survey(cls.owner, n=30)

    def ctx(self, page, snap):
        from .agent_views import build_context
        return build_context(self.owner, self.survey.code, page, studio=snap)

    def test_snapshot_parsing(self):
        from .agent_studio import parse_snapshot
        snap = parse_snapshot(dash_snapshot(), "dashboard")
        self.assertEqual(len(snap["tiles"]), 3)
        self.assertIsNone(parse_snapshot(dash_snapshot(), "studio"))          # wrong page → ignored
        bad = dash_snapshot([{"id": 1, "kind": "rocket", "x": 0, "y": 0, "w": 3, "h": 2}])
        self.assertEqual(parse_snapshot(bad, "dashboard")["tiles"], [])
        flow = parse_snapshot(flow_snapshot(), "studio")
        self.assertNotIn("_ui", flow["pipeline"]["steps"][0]["config"])        # canvas positions stay client-side

    def test_dashboard_plan(self):
        from .agent_studio import plan_dashboard, parse_snapshot
        snap = parse_snapshot(dash_snapshot(), "dashboard")
        b = plan_dashboard(snap, [
            {"op": "add", "kind": "donut", "title": "Water", "spec": {"x": "Main water source"}},
            {"op": "update", "card": "#2", "title": "Regions", "spec": {"group_by": "sex", "limit": None}},
            {"op": "remove", "card": "latest responses"},
            {"op": "theme", "theme": "ocean", "accent": "#FF8A1F", "card": "glass", "density": "nonsense"},
            {"op": "filters", "filters": [{"field": "sex", "operator": "eq", "value": "f"}, {"field": "nope", "value": 1}]},
            {"op": "source", "source": "pipeline", "id": 5},
            {"op": "add", "kind": "bar", "spec": {"x": "no_such"}},
        ], "Makeover")
        tiles = {str(t["id"]): t for t in b["after"]["tiles"]}
        self.assertIn("new-1", tiles)
        self.assertEqual(tiles["new-1"]["spec"]["x"], "water")                 # label resolved to the column
        self.assertEqual(tiles["12"]["title"], "Regions")
        self.assertEqual(tiles["12"]["spec"]["group_by"], "sex")
        self.assertNotIn("13", tiles)
        cfg = b["after"]["board"]["theme_config"]
        self.assertEqual((b["after"]["board"]["theme"], cfg["accent"], cfg["card"]), ("ocean", "#ff8a1f", "glass"))
        self.assertNotIn("density", cfg)
        self.assertEqual([f["field"] for f in b["after"]["board"]["filters"]], ["sex"])
        self.assertTrue(b["flags"]["source_changed"])
        self.assertEqual(b["after"]["board"]["pipeline_id"], 5)
        self.assertTrue(any("no_such" in w for w in b["warnings"]))
        self.assertFalse(b["needs_confirm"])
        for t in b["after"]["tiles"]:                                            # no overlaps after placing
            for u in b["after"]["tiles"]:
                if t is not u:
                    self.assertFalse(t["x"] < u["x"] + u["w"] and u["x"] < t["x"] + t["w"] and
                                     t["y"] < u["y"] + u["h"] and u["y"] < t["y"] + t["h"], (t, u))

    def test_dashboard_big_rewrite_asks_first(self):
        from .agent_studio import plan_dashboard, parse_snapshot
        b = plan_dashboard(parse_snapshot(dash_snapshot(), "dashboard"),
                           [{"op": "clear"}, {"op": "add", "kind": "kpi", "title": "Total"}, {"op": "tidy"}])
        self.assertTrue(b["needs_confirm"])
        self.assertEqual(len(b["after"]["tiles"]), 1)
        self.assertEqual(b["after"]["tiles"][0]["y"], 0)

    def test_flow_plan_and_dry_run(self):
        snap = flow_snapshot()
        ctx = self.ctx("studio", snap)
        b = eng.run_tool(ctx, {"tool": "studio_flow", "ops": [
            {"op": "add", "step": {"operation": "fill_missing", "name": "Fill income", "config": {"field": "income", "method": "median"}}, "at": 1},
            {"op": "update", "step": "Remove repeats", "config": {"keep": "last"}},
            {"op": "move", "step": "#3", "to": 2},
            {"op": "add", "step": {"operation": "warp_drive"}},
            {"op": "add", "step": {"operation": "trim_text", "name": "Tidy ghost", "config": {"field": "ghost_column"}}},
            {"op": "rename", "name": "Field fixes"},
            {"op": "run"},
        ]})
        self.assertEqual(b["type"], "studio", b)
        steps = b["after"]["pipeline"]["steps"]
        self.assertEqual([s["name"] for s in steps], ["Fill income", "Remove repeats", "Tidy village", "Tidy ghost"])
        self.assertEqual(steps[1]["config"]["keep"], "last")
        self.assertEqual(steps[2]["origin"], 0)                                 # the old node keeps its identity
        self.assertEqual(b["after"]["pipeline"]["name"], "Field fixes")
        self.assertTrue(b["flags"]["run"])
        self.assertTrue(any("warp_drive" in w for w in b["warnings"]))
        self.assertTrue(any("ghost_column" in w for w in b["warnings"]))
        pv = b["preview"]
        self.assertEqual(pv["source_rows"], 31)
        self.assertLess(pv["result_rows"], pv["source_rows"])                   # the duplicate was removed
        self.assertEqual(len(pv["steps"]), 4)
        self.assertIn(0, b["touched"])

    def test_flow_new_and_switch(self):
        ctx = self.ctx("studio", flow_snapshot())
        b = eng.run_tool(ctx, {"tool": "studio_flow", "ops": [{"op": "new_flow", "name": "Fresh", "steps": [
            {"operation": "trim_text", "config": {"field": "village"}}]}]})
        self.assertTrue(b["flags"]["new_flow"])
        self.assertIsNone(b["after"]["pipeline"]["id"])
        self.assertEqual(b["touched"], [0])
        sw = eng.run_tool(ctx, {"tool": "studio_flow", "ops": [{"op": "switch", "flow": "second pass"}]})
        self.assertEqual(sw["flags"]["switch"], 10)

    def test_studio_tools_need_the_right_page_and_rights(self):
        ctx = self.ctx("data", None)
        self.assertEqual(eng.run_tool(ctx, {"tool": "studio_dashboard", "ops": []})["type"], "error")
        viewer = User.objects.create_user("v_studio", password="pw")
        from .models_team import SurveyCollaborator
        SurveyCollaborator.objects.create(survey=self.survey, user=viewer, role="viewer")
        from .agent_views import build_context
        vctx = build_context(viewer, self.survey.code, "dashboard", studio=dash_snapshot())
        r = eng.run_tool(vctx, {"tool": "studio_dashboard", "ops": [{"op": "tidy"}]})
        self.assertEqual(r["type"], "error")
        fctx = build_context(viewer, self.survey.code, "studio", studio=flow_snapshot())
        self.assertIn("owner", eng.run_tool(fctx, {"tool": "studio_flow", "ops": [{"op": "layout"}]})["text"])

    def test_prompt_and_system_carry_the_studio(self):
        ctx = self.ctx("dashboard", dash_snapshot())
        prompt = agent_ai.build_user_prompt(ctx, "make it nicer", [])
        self.assertIn("STUDIO: Dashboard Studio", prompt)
        self.assertIn("#2 id=12 hbar", prompt)
        self.assertIn("STUDIO MODE", agent_ai.system_prompt(ctx))
        fctx = self.ctx("studio", flow_snapshot())
        self.assertIn("ALL OPERATIONS", agent_ai.build_user_prompt(fctx, "x", []))
        self.assertIn("studio_flow", agent_ai.system_prompt(fctx))
        self.assertNotIn("STUDIO MODE", agent_ai.system_prompt(self.ctx("data", None)))


class StudioBuiltinTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("studio2", password="pw")
        cls.survey = make_survey(cls.owner, n=12)

    def plan(self, msg, page="dashboard", snap=None):
        from .agent_views import build_context
        snap = snap or (dash_snapshot() if page == "dashboard" else flow_snapshot())
        ctx = build_context(self.owner, self.survey.code, page, studio=snap)
        p = agent_ai.normalise_plan(agent_ai.builtin_plan(ctx, msg))
        return p, ctx

    def ops(self, msg, **kw):
        p, _ = self.plan(msg, **kw)
        self.assertTrue(p["actions"], msg)
        return p["actions"][0]["ops"]

    def test_dashboard_phrases(self):
        ops = self.ops("use the ocean theme with an orange accent")
        self.assertIn({"op": "theme", "theme": "ocean"}, ops)
        self.assertIn({"op": "theme", "accent": "#ff8a1f"}, ops)
        add = self.ops("add a donut of water source")[0]
        self.assertEqual((add["op"], add["kind"], add["spec"]["x"]), ("add", "donut", "water"))
        self.assertEqual(self.ops("remove the table")[0], {"op": "remove", "card": 13})
        self.assertEqual(self.ops("tidy the layout"), [{"op": "tidy"}])
        grow = self.ops("make Region bigger")[0]
        self.assertEqual((grow["card"], grow["w"]), (12, 9))
        self.assertEqual(self.ops("rename the board to Gambia WASH 2026")[0]["name"], "Gambia WASH 2026")
        knobs = self.ops("glass cards and compact")
        self.assertIn({"op": "theme", "card": "glass"}, knobs)
        self.assertIn({"op": "theme", "density": "compact"}, knobs)

    def test_flow_phrases(self):
        add = self.ops("trim spaces in village", page="studio")[0]
        self.assertEqual((add["step"]["operation"], add["step"]["config"]), ("trim_text", {"field": "village"}))
        fill = self.ops("fill missing income with median", page="studio")[0]["step"]
        self.assertEqual(fill["config"], {"field": "income", "method": "median"})
        ops = self.ops("remove duplicates and run it", page="studio")
        self.assertEqual([o["op"] for o in ops], ["add", "run"])
        self.assertEqual(self.ops("remove step 2", page="studio"), [{"op": "remove", "step": "#2"}])
        self.assertEqual(self.ops("move step 2 up", page="studio"), [{"op": "move", "step": "#2", "to": 1}])
        new = self.ops("build a cleaning flow", page="studio")[0]
        self.assertEqual(new["op"], "new_flow")
        self.assertTrue(new["steps"])

    def test_falls_back_to_normal_skills(self):
        p, _ = self.plan("how is collection going?")
        self.assertIn("overview", [a["tool"] for a in p["actions"]])


class StudioChatTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("studio3", password="pw")
        cls.survey = make_survey(cls.owner, n=10)

    def setUp(self):
        cache.clear()
        self.client.force_login(self.owner)

    def chat(self, message, page, snap):
        return self.client.post("/kura/agent/chat/", json.dumps({"message": message, "code": self.survey.code,
                                                                 "page": page, "studio": snap}),
                                content_type="application/json").json()

    def test_builtin_dashboard_edit(self):
        with mock.patch.object(agent_ai, "ai_enabled", return_value=False):
            j = self.chat("add a pie of sex and use the sunset theme", "dashboard", dash_snapshot())
        b = j["blocks"][0]
        self.assertEqual((b["type"], b["studio"]), ("studio", "dashboard"))
        self.assertEqual(b["after"]["board"]["theme"], "sunset")
        self.assertEqual(b["base_rev"], "123")

    def test_ai_flow_edit(self):
        fake = {"say": "Added a step and ran it.", "mood": "proud",
                "actions": [{"tool": "studio_flow", "note": "Fill blanks", "ops": [
                    {"op": "add", "step": {"operation": "fill_missing", "name": "Fill age", "config": {"field": "age", "method": "median"}}},
                    {"op": "run"}]}]}
        from hanns import ai as hai
        with mock.patch.object(hai, "is_enabled", return_value=True), \
                mock.patch.object(hai, "ai_json", return_value=(fake, "gemini-flash-latest")) as m:
            j = self.chat("fill blanks in age and run", "studio", flow_snapshot())
        self.assertIn("STUDIO MODE", m.call_args[0][0])
        b = j["blocks"][0]
        self.assertEqual(b["studio"], "flow")
        self.assertEqual(b["after"]["pipeline"]["steps"][-1]["name"], "Fill age")
        self.assertTrue(b["flags"]["run"])
        self.assertEqual(b["title"], "Fill blanks")


class StudioWelcomeSkillsTests(TestCase):
    """Every skill button on the studio welcome screens works without a Gemini key."""

    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("studio4", password="pw")
        cls.survey = make_survey(cls.owner, n=20)

    def plan(self, msg, page, snap):
        from .agent_views import build_context
        ctx = build_context(self.owner, self.survey.code, page, studio=snap)
        return agent_ai.normalise_plan(agent_ai.builtin_plan(ctx, msg)), ctx

    def test_remix_rebuilds_and_waits_for_ok(self):
        p, ctx = self.plan("Redesign this board so it looks great and tells the story clearly", "dashboard", dash_snapshot())
        self.assertEqual(p["actions"][0]["tool"], "studio_dashboard")
        b = eng.run_tool(ctx, p["actions"][0])
        self.assertEqual(b["type"], "studio", b)
        self.assertTrue(b["needs_confirm"])                       # it replaces the cards
        kinds = [t["kind"] for t in b["after"]["tiles"]]
        self.assertIn("kpi", kinds)
        self.assertGreaterEqual(len(kinds), 4)

    def test_explain_board_and_flow(self):
        p, _ = self.plan("What does this board tell me?", "dashboard", dash_snapshot())
        self.assertEqual(p["actions"], [])
        self.assertIn("3 cards", p["say"])
        p, _ = self.plan("Explain what this flow does, step by step", "studio", flow_snapshot())
        self.assertIn("1. Tidy village", p["say"])
        self.assertIn("rows in", p["say"])

    def test_first_chart_wider_and_split(self):
        p, _ = self.plan("Make the first chart wider and split it by sex", "dashboard", dash_snapshot())
        op = p["actions"][0]["ops"][0]
        self.assertEqual((op["card"], op["w"], op["spec"]), (12, 9, {"group_by": "sex"}))

    def test_best_order(self):
        snap = flow_snapshot([
            {"operation": "deduplicate", "name": "Remove repeats", "config": {"fields": []}},
            {"operation": "fill_missing", "name": "Fill income", "config": {"field": "income", "method": "median"}},
            {"operation": "trim_text", "name": "Tidy village", "config": {"field": "village"}},
        ])
        p, ctx = self.plan("Put the steps in the best order and tidy the canvas", "studio", snap)
        b = eng.run_tool(ctx, p["actions"][0])
        self.assertEqual([s["name"] for s in b["after"]["pipeline"]["steps"]],
                         ["Tidy village", "Remove repeats", "Fill income"])
        self.assertTrue(b["flags"]["layout"])


# ─────────────────────────────────────────────────────────────────────
#  Excel questionnaires: Kura Form template, checker, fixer, XLSForm
# ─────────────────────────────────────────────────────────────────────

def kura_form_bytes(rows, extra_sheets=None, headers=None):
    from openpyxl import Workbook
    from . import kura_form as kf
    wb = Workbook()
    ws = wb.active
    ws.title = "Questions"
    ws.append(headers or kf.KF_HEADERS)
    for r in rows:
        ws.append(r)
    for name, data in (extra_sheets or {}).items():
        sh = wb.create_sheet(name)
        for r in data:
            sh.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


BROKEN_ROWS = [
    ["Chose one", "Do you agree to take part?", "consent", "yes", "yes = Yes; no = No"],
    ["Whole number", "Age", "age", "Yes", "", "", "consent = Yes", "", "120", "0"],
    ["Short text", "Your phone number", "Phone Number!", "", "", "", "consnt = yes"],
    ["Choose one", "Water source", "water", "", "", "", "age > 18 and consent = yes or age < 5"],
    ["Short text", "Village", "age"],
    ["Calculated (hidden)", "Double age", "dbl", "", "", "", "", "", "", "", "", "", "", "", "", "${age} * 2"],
    ["Short text", "ID", "nid", "", "", "", "", "", "", "", "[0-9{7}"],
    ["Short text", "Later dependency", "dep", "", "", "", "follow_up is answered"],
    ["Short text", "Follow up", "follow_up"],
    ["Likert scale", "I feel safe", "safe"],
]


class KuraFormTests(TestCase):
    def test_template_round_trips_exactly(self):
        from . import kura_form as kf
        data = kf.build_workbook("My survey", "Desc", kf.STARTER, kf.STARTER_INDICATORS)
        res = kf.check_file(data, "template.xlsx")
        self.assertEqual(res["summary"]["counts"]["error"], 0)
        self.assertEqual(res["summary"]["counts"]["warning"], 0)
        self.assertEqual(res["form"]["title"], "My survey")
        keys = ("name", "type", "label", "required", "relevant", "choices", "validate")
        got = [{k: q.get(k) for k in keys} for q in kf.to_schema_questions(res["form"])]
        want = [{k: q.get(k) for k in keys} for q in kf.to_schema_questions({"questions": kf.STARTER})]
        self.assertEqual(got, want)
        self.assertEqual(res["form"]["questions"][3]["children"][0]["name"], "mname")
        self.assertEqual(res["form"]["questions"][3].get("indicator"), None)

    def test_template_extras_dont_break_import(self):
        from openpyxl import load_workbook
        from . import kura_form as kf
        wb = load_workbook(io.BytesIO(kf.build_workbook("", "", [], [], blank_rows=10)))
        self.assertEqual(wb.sheetnames[:3], ["📖 Read me", "Form", "Questions"])
        self.assertEqual(wb["Lists"].sheet_state, "hidden")
        self.assertTrue(wb["Questions"]["A1"].comment)                     # column help
        self.assertTrue(wb["Questions"].data_validations.dataValidation)  # type dropdown
        # the builder finds sheets by name fragments: no extra sheet may contain them
        for n in wb.sheetnames:
            if n not in ("Form", "Questions"):
                for frag in ("questions", "choices", "form", "indicators"):
                    self.assertNotIn(frag, kf.norm_key(n), n)

    def test_checker_finds_planted_problems(self):
        from . import kura_form as kf
        res = kf.check_file(kura_form_bytes(BROKEN_ROWS), "broken.xlsx")
        by = {(i.cell, i.level) for i in res["issues"]}
        text = " | ".join(f"{i.cell}:{i.msg}" for i in res["issues"])
        self.assertIn(("A2", "error"), by)                                 # “Chose one”
        self.assertIn(("C6", "error"), by)                                 # duplicate name “age”
        self.assertIn(("G4", "error"), by)                                 # consnt
        self.assertIn("mixes and with or", text)
        self.assertIn(("I3", "error"), by)                                 # min > max
        self.assertIn("${name}", text)
        self.assertIn(("K8", "error"), by)                                 # broken regex
        self.assertIn("comes later in the form", text)
        self.assertIn(("E11", "warning"), by)                              # likert without choices
        self.assertFalse(res["summary"]["ready"])
        self.assertGreaterEqual(res["summary"]["fixable"], 6)
        grid = res["grid"]
        self.assertEqual(grid["columns"][0]["letter"], "A")
        self.assertEqual(grid["rows"][0]["cells"][0]["s"], "error")

    def test_fix_rounds_and_recheck(self):
        from . import kura_form as kf
        res = kf.check_file(kura_form_bytes(BROKEN_ROWS), "broken.xlsx")
        fixed, applied, remaining = kf.fix_all(res["form"], res["issues"])
        msgs = " | ".join(a.msg for a in applied)
        self.assertIn("Choose one", msgs)
        self.assertIn("age_2", msgs)
        self.assertIn("“consent”", msgs)                                    # consnt → consent
        self.assertIn("“yes” instead of “Yes”", msgs)                       # found only in round 2
        self.assertIn("swapped Min and Max", msgs)
        q = {x["name"]: x for x, _p in kf.iter_questions(fixed["questions"])}
        self.assertEqual(q["age"]["relevant"]["rules"][0]["value"], "yes")
        self.assertEqual(q["dbl"]["calc"], "age * 2")
        left = {i.msg.split("—")[0][:30] for i in remaining if i.level == "error"}
        self.assertTrue(any("mixes" in m or "age > 18" in m for m in left) or
                        any("mixes and with or" in i.msg for i in remaining))

    def test_duplicate_names_keep_logic_on_the_first(self):
        from . import kura_form as kf
        rows = [["Choose one", "Consent", "consent", "", "yes = Yes; no = No"],
                ["Short text", "Other consent text", "consent"],
                ["Short text", "Why", "why", "", "", "", "consent = no"]]
        res = kf.check_file(kura_form_bytes(rows), "d.xlsx")
        fixed, applied, remaining = kf.fix_all(res["form"], res["issues"])
        names = [q["name"] for q in kf.to_schema_questions(fixed)]
        self.assertEqual(names, ["consent", "consent_2", "why"])
        self.assertEqual(kf.to_schema_questions(fixed)[2]["relevant"]["rules"][0]["q"], "consent")
        self.assertFalse([i for i in remaining if i.level == "error"])

    def test_markup_keeps_the_users_workbook(self):
        from openpyxl import load_workbook
        from . import kura_form as kf
        data = kura_form_bytes(BROKEN_ROWS, {"My notes": [["keep me"]]})
        res = kf.check_file(data, "b.xlsx")
        wb = load_workbook(io.BytesIO(kf.markup_original(data, res["issues"])))
        self.assertEqual(wb.sheetnames[0], "Foon check")
        self.assertIn("My notes", wb.sheetnames)
        self.assertEqual(wb["My notes"]["A1"].value, "keep me")
        self.assertIn("isn't a question type", wb["Questions"]["A2"].comment.text)
        links = [c.hyperlink.location if c.hyperlink and c.hyperlink.location else (c.hyperlink.target if c.hyperlink else None)
                 for c in wb["Foon check"]["C"] if c.hyperlink]
        self.assertTrue(links)

    def test_choices_sheet_cascade_and_indicators(self):
        from . import kura_form as kf
        rows = [["Choose one", "Region", "region", "", "wcr = West Coast; nbr = North Bank"],
                ["Choose one", "District", "district", "", "(see the Choices sheet)", "", "", "region"],
                ["Whole number", "Children", "kids", "", "", "", "", "", "0", "20", "", "", "", "", "", "", "IND-9"]]
        sheets = {"Choices": [["Question name", "Value", "Label", "Parent value"],
                              ["district", "brikama", "Brikama", "wcr"], ["district", "kerewan", "Kerewan", "nbx"]],
                  "Indicators": [["Code", "Name", "Target"], ["IND-1", "Kids in school", 100]]}
        res = kf.check_file(kura_form_bytes(rows, sheets), "c.xlsx")
        text = " | ".join(i.msg for i in res["issues"])
        self.assertIn("nbx", text)                                         # parent value not an option
        self.assertIn("IND-9", text)                                       # unknown indicator
        q = {x["name"]: x for x, _p in kf.iter_questions(res["form"]["questions"])}
        self.assertEqual(q["district"]["cascade"], {"parent": "region"})
        self.assertEqual(len(q["district"]["choices"]), 2)

    def test_xlsform_conversion(self):
        from openpyxl import Workbook
        from . import kura_form as kf
        wb = Workbook()
        s = wb.active
        s.title = "survey"
        s.append(["type", "name", "label::English (en)", "required", "relevant", "constraint", "calculation", "choice_filter"])
        for r in [["start", "start", "", "", "", "", "", ""],
                  ["select_one yn", "consent", "Consent?", "yes", "", "", "", ""],
                  ["integer", "age", "Age", "yes", "${consent} = 'yes'", ". >= 0 and . <= 120", "", ""],
                  ["select_multiple sym", "sym", "Symptoms", "", "selected(${consent}, 'yes')", "", "", ""],
                  ["select_one region", "region", "Region", "", "", "", "", ""],
                  ["select_one district", "district", "District", "", "", "", "", "region=${region}"],
                  ["begin_repeat", "kids", "Children", "", "${age} > 18", "", "", ""],
                  ["text", "kname", "Child name", "", "", "", "", ""],
                  ["end_repeat", "", "", "", "", "", "", ""],
                  ["calculate", "dbl", "", "", "", "", "${age} * 2", ""]]:
            s.append(r)
        c = wb.create_sheet("choices")
        c.append(["list_name", "name", "label", "region"])
        for r in [["yn", "yes", "Yes", ""], ["yn", "no", "No", ""], ["sym", "fever", "Fever", ""], ["sym", "cough", "Cough", ""],
                  ["region", "wcr", "West Coast", ""], ["district", "brikama", "Brikama", "wcr"]]:
            c.append(r)
        buf = io.BytesIO()
        wb.save(buf)
        res = kf.check_file(buf.getvalue(), "kobo.xlsx")
        self.assertEqual(res["kind"], "xlsform")
        self.assertEqual(res["summary"]["counts"]["error"], 0, [i.msg for i in res["issues"]])
        qs = {q["name"]: q for q in kf.to_schema_questions(res["form"])}
        self.assertNotIn("start", qs)
        self.assertEqual(qs["age"]["validate"], {"min": 0, "max": 120})
        self.assertEqual(qs["age"]["relevant"]["rules"][0], {"q": "consent", "cmp": "eq", "value": "yes"})
        self.assertEqual(qs["sym"]["relevant"]["rules"][0]["cmp"], "selected")
        self.assertEqual(qs["district"]["cascade"], {"parent": "region"})
        self.assertEqual(qs["district"]["choices"][0]["parent"], "wcr")
        self.assertEqual([c["name"] for c in qs["kids"]["children"]], ["kname"])
        self.assertEqual(qs["dbl"]["calc"], "age * 2")

    def test_csv_and_bad_files(self):
        from . import kura_form as kf
        csv_data = ("Type,Question,Name\nChoose one,Do you agree?,consent\nShort text,Name,nm\n").encode()
        res = kf.check_file(csv_data, "q.csv")
        self.assertEqual(res["kind"], "csv")
        self.assertTrue(any("needs answer options" in i.msg for i in res["issues"]))
        for data, name, words in [(b"not excel", "x.xlsx", "could not be read"), (b"x", "old.xls", ".xlsx"),
                                  (kura_form_bytes([], headers=["Foo", "Bar"]), "h.xlsx", "Type"),
                                  (b"", "e.xlsx", "empty")]:
            with self.assertRaises(kf.FormFileError) as cm:
                kf.check_file(data, name)
            self.assertIn(words, str(cm.exception))

    def test_foon_drafts_pass_their_own_check(self):
        from . import kura_form as kf
        for topic in ("household", "health clinic", "school", "water and sanitation", "farm", "workshop", "customer", "staff"):
            q = agent_ai.template_questionnaire(f"draft a survey about {topic}")
            qs = eng.sanitize_questions(q["questions"])
            res = kf.check_file(kf.build_workbook(q["title"], "", qs, []), "draft.xlsx")
            self.assertEqual(res["summary"]["counts"]["error"], 0, (topic, [i.msg for i in res["issues"] if i.level == "error"]))

    def test_expression_checks(self):
        from . import kura_form as kf
        probs, _ = kf.check_expression("if(age > 5, 1, 0)", {"age"})
        self.assertTrue(any("if_" in p[2] for p in probs))
        probs, _ = kf.check_expression("age = 5", {"age"})
        self.assertEqual(probs[0][3], "age == 5")
        probs, _ = kf.check_expression("value <= age", {"age"}, allow_value=True)
        self.assertEqual(probs, [])
        probs, _ = kf.check_expression("sum_of(members, 'age') / count(members)", {"members"})
        self.assertEqual(probs, [])
        probs, _ = kf.check_expression("__import__('os')", set())
        self.assertEqual(probs[0][0], "error")


class FormCheckEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("fc_owner", password="pw")
        cls.other = User.objects.create_user("fc_other", password="pw")

    def setUp(self):
        cache.clear()
        self.client.force_login(self.owner)

    def upload(self, data, name="form.xlsx"):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return self.client.post("/kura/agent/form-check/", {"file": SimpleUploadedFile(name, data)}).json()

    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type="application/json")

    def test_upload_fix_and_create(self):
        rows = [["Chose one", "Do you agree to take part?", "consent", "yes", "yes = Yes; no = No"],
                ["Whole number", "Age", "age", "Yes", "", "", "consent = Yes", "", "120", "0"],
                ["Likert scale", "I feel safe", "safe"]]
        j = self.upload(kura_form_bytes(rows))
        b = j["block"]
        self.assertEqual(b["type"], "formcheck")
        self.assertFalse(b["summary"]["ready"])
        r = self.post("/kura/agent/apply/", {"action": "create_from_check", "token": b["token"], "variant": "original"})
        self.assertEqual(r.status_code, 400)                              # gate: errors first
        self.assertIn("Fix the", r.json()["error"])
        f = self.post("/kura/agent/form-check/", {"token": b["token"], "action": "fix"}).json()
        fb = f["block"]
        self.assertEqual(fb["variant"], "fixed")
        self.assertTrue(fb["summary"]["ready"], fb["issues"])
        self.assertGreaterEqual(len(fb["applied"]), 3)
        self.assertTrue(any(c["s"] == "fixed" for row in fb["grid"]["rows"] for c in row["cells"]))
        r = self.post("/kura/agent/apply/", {"action": "create_from_check", "token": b["token"], "variant": "fixed"}).json()
        self.assertTrue(r["ok"], r)
        survey = Survey.objects.get(code=r["code"])
        qs = survey.draft_schema["questions"]
        self.assertEqual([q["type"] for q in qs], ["select_one", "integer", "likert"])
        self.assertEqual(qs[1]["relevant"]["rules"][0]["value"], "yes")
        self.assertEqual(len(qs[2]["choices"]), 5)

    def test_downloads(self):
        from openpyxl import load_workbook
        j = self.upload(kura_form_bytes(BROKEN_ROWS))
        tok = j["block"]["token"]
        for variant, sheet in (("marked", "Foon check"), ("fixed", "Foon check"), ("clean", "Questions")):
            r = self.post("/kura/agent/export/", {"format": "xlsx", "spec": {"tool": "formcheck", "token": tok, "variant": variant}})
            self.assertEqual(r.status_code, 200, (variant, r.content[:200]))
            wb = load_workbook(io.BytesIO(r.content))
            self.assertIn(sheet, wb.sheetnames, variant)
        for kind in ("starter", "blank"):
            r = self.post("/kura/agent/export/", {"format": "kuraform", "spec": {"tool": "form_template", "kind": kind}})
            self.assertEqual(r.status_code, 200)
            self.assertIn("kura_form", r["X-Foon-Filename"])

    def test_tokens_are_private(self):
        j = self.upload(kura_form_bytes(BROKEN_ROWS))
        tok = j["block"]["token"]
        self.client.force_login(self.other)
        r = self.post("/kura/agent/form-check/", {"token": tok, "action": "fix"})
        self.assertEqual(r.status_code, 404)
        r = self.post("/kura/agent/apply/", {"action": "create_from_check", "token": tok})
        self.assertEqual(r.status_code, 404)
        r = self.post("/kura/agent/export/", {"format": "xlsx", "spec": {"tool": "formcheck", "token": tok, "variant": "marked"}})
        self.assertEqual(r.status_code, 400)

    def test_self_check_and_chat_context(self):
        q = agent_ai.template_questionnaire("draft a survey about a health clinic")
        j = self.post("/kura/agent/form-check/", {"questions": q["questions"], "title": q["title"]}).json()
        self.assertEqual(j["block"]["kind"], "draft")
        self.assertTrue(j["block"]["summary"]["ready"], j["block"]["issues"])
        from hanns import ai as hai
        fake = {"say": "Simplified.", "actions": []}
        with mock.patch.object(hai, "is_enabled", return_value=True), \
                mock.patch.object(hai, "ai_json", return_value=(fake, "gemini")) as m:
            self.post("/kura/agent/chat/", {"message": "make the wording simpler", "page": "list",
                                            "form_token": j["block"]["token"]})
        self.assertIn("UPLOADED QUESTIONNAIRE", m.call_args[0][1])
        self.assertIn("EXCEL QUESTIONNAIRES", m.call_args[0][0])

    def test_builtin_template_and_check_intents(self):
        with mock.patch.object(agent_ai, "ai_enabled", return_value=False):
            j = self.post("/kura/agent/chat/", {"message": "give me the excel template", "page": "list"}).json()
            self.assertEqual(j["blocks"][0]["type"], "template")
            j = self.post("/kura/agent/chat/", {"message": "can you check my excel file?", "page": "list"}).json()
            self.assertIn("📎", j["say"])
            j = self.post("/kura/agent/chat/", {"message": "draft a household survey in excel", "page": "list"}).json()
            self.assertEqual(j["blocks"][0]["type"], "questionnaire")
            self.assertIn("Excel", j["say"])


# ─────────────────────────────────────────────────────────────────────
#  Photos, gallery, reports and Hanns story decks
# ─────────────────────────────────────────────────────────────────────

import shutil
import tempfile
import zipfile

TMP_MEDIA = tempfile.mkdtemp(prefix="kura_media_test_")


def photo_bytes(color=(40, 120, 200), w=640, h=360, orientation=1, gps=True):
    from PIL import Image
    img = Image.new("RGB", (w, h), color)
    exif = Image.Exif()
    exif[274] = orientation
    exif[36867] = "2026:10:20 09:15:00"
    if gps:
        exif[0x8825] = {1: "N", 2: (13.0, 27.0, 11.0), 3: "W", 4: (16.0, 34.0, 40.0)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def add_photo_question(survey):
    for holder in [survey] + list(survey.versions.all()):
        sch = holder.draft_schema if holder is survey else holder.schema
        sch = json.loads(json.dumps(sch))
        sch["questions"].append({"name": "wp_photo", "type": "photo", "label": "Photo of the water point"})
        if holder is survey:
            survey.draft_schema = sch
            survey.save()
        else:
            holder.schema = sch
            holder.save()


def attach_photos(survey, n=5, star=(0,)):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from . import media
    out = []
    for i, sub in enumerate(Submission.objects.filter(survey=survey).order_by("id")[:n]):
        m, _how = media.save_upload(survey, sub.client_uuid, "wp_photo",
                                    SimpleUploadedFile(f"p{i}.jpg", photo_bytes((20 * i, 100, 200)), "image/jpeg"))
        m.starred = i in star
        m.caption = f"Water point {i}"
        m.save()
        out.append(m)
    return out


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class MediaPipelineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from .models import Device, SurveyDeviceAccess
        cls.owner = User.objects.create_user("ph_owner", password="pw")
        cls.survey = make_survey(cls.owner, n=8)
        add_photo_question(cls.survey)
        cls.device = Device.issue(cls.owner, "Phone")
        SurveyDeviceAccess.objects.create(survey=cls.survey, device=cls.device, allowed=True)

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def upload(self, uuid_, question="wp_photo", data=None, token=None):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return self.client.post(f"/kura/api/forms/{self.survey.code}/media/",
                                {"uuid": str(uuid_), "question": question,
                                 "file": SimpleUploadedFile("p.jpg", data or photo_bytes(orientation=6), "application/octet-stream")},
                                HTTP_AUTHORIZATION=f"Token {token or self.device.token}")

    def test_phone_upload_dedupe_exif_and_link(self):
        import uuid as uuidlib
        from PIL import Image
        from .models_media import SubmissionMedia
        cu = uuidlib.uuid4()
        r = self.upload(cu)
        self.assertEqual(r.json()["result"], "created", r.content)
        self.assertEqual(self.upload(cu).json()["result"], "duplicate")
        m = SubmissionMedia.objects.get(client_uuid=cu)
        self.assertEqual((m.width, m.height), (360, 640))                     # orientation applied
        self.assertAlmostEqual(m.gps_lat, 13.453, places=2)
        self.assertAlmostEqual(m.gps_lng, -16.578, places=2)
        self.assertIsNotNone(m.captured_at)
        self.assertEqual(dict(Image.open(m.web.open("rb")).getexif()), {})   # no EXIF on shared copies
        self.assertIsNone(m.submission)
        Submission.objects.create(survey=self.survey, client_uuid=cu, answers={"consent": "yes"})
        from . import media
        media.link_pending(self.survey)
        m.refresh_from_db()
        self.assertIsNotNone(m.submission)
        chk = self.client.post(f"/kura/api/forms/{self.survey.code}/media/check/",
                               json.dumps({"items": [{"uuid": str(cu), "question": "wp_photo", "size": m.size},
                                                     {"uuid": str(cu), "question": "wp_photo", "size": 1}]}),
                               content_type="application/json", HTTP_AUTHORIZATION=f"Token {self.device.token}")
        self.assertEqual(chk.json()["missing"], [1])

    def test_phone_upload_follows_sync_gates(self):
        import uuid as uuidlib
        from .models import Device
        other = Device.issue(self.owner, "Unscanned phone")
        self.assertEqual(self.upload(uuidlib.uuid4(), token=other.token).status_code, 403)   # never scanned the form
        self.assertEqual(self.upload(uuidlib.uuid4(), token="nope").status_code, 401)
        self.survey.state = "paused"
        self.survey.save()
        self.assertEqual(self.upload(uuidlib.uuid4()).status_code, 409)
        self.survey.state = "collecting"
        self.survey.save()
        self.assertEqual(self.upload(uuidlib.uuid4(), question="consent").status_code, 400)   # not a photo question
        self.assertEqual(self.upload(uuidlib.uuid4(), data=b"not an image").status_code, 400)

    def test_web_runner_upload_rules(self):
        import uuid as uuidlib
        from django.core.files.uploadedfile import SimpleUploadedFile
        url = f"/kura/{self.survey.code}/media/"
        cu = uuidlib.uuid4()
        ok = self.client.post(url, {"uuid": str(cu), "question": "wp_photo", "file": SimpleUploadedFile("a.jpg", photo_bytes())})
        self.assertTrue(ok.json()["ok"], ok.content)
        done = Submission.objects.filter(survey=self.survey).first()
        late = self.client.post(url, {"uuid": str(done.client_uuid), "question": "wp_photo",
                                      "file": SimpleUploadedFile("a.jpg", photo_bytes())})
        self.assertEqual(late.status_code, 409)                               # response already submitted
        self.survey.state = "closed"
        self.survey.save()
        self.assertEqual(self.client.post(url, {"uuid": str(uuidlib.uuid4()), "question": "wp_photo",
                                                "file": SimpleUploadedFile("a.jpg", photo_bytes())}).status_code, 409)
        self.survey.state = "collecting"
        self.survey.save()

    def test_gallery_permissions_edits_and_zip(self):
        from .models_team import SurveyCollaborator
        photos = attach_photos(self.survey, n=4, star=(2,))
        viewer = User.objects.create_user("ph_viewer", password="pw")
        SurveyCollaborator.objects.create(survey=self.survey, user=viewer, role="viewer")
        outsider = User.objects.create_user("ph_out", password="pw")
        base = f"/kura/{self.survey.code}"
        self.client.force_login(outsider)
        self.assertEqual(self.client.get(f"{base}/gallery/").status_code, 404)
        self.assertEqual(self.client.get(f"{base}/media/{photos[0].id}/").status_code, 404)
        self.client.force_login(viewer)
        self.assertEqual(self.client.get(f"{base}/gallery/").status_code, 200)
        self.assertEqual(self.client.get(f"{base}/media/{photos[0].id}/?v=web").status_code, 200)
        r = self.client.post(f"{base}/media/{photos[0].id}/update/", json.dumps({"caption": "x"}), content_type="application/json")
        self.assertEqual(r.status_code, 403)
        self.client.force_login(self.owner)
        r = self.client.post(f"{base}/media/{photos[0].id}/update/", json.dumps({"caption": "Borehole", "starred": True}),
                             content_type="application/json").json()
        self.assertEqual((r["caption"], r["starred"]), ("Borehole", True))
        data = self.client.get(f"{base}/gallery/data/?starred=1").json()
        self.assertEqual({i["id"] for i in data["items"]}, {photos[0].id, photos[2].id})
        self.assertEqual(data["items"][0]["answers"][0]["label"], "Do you agree?")
        sub0 = photos[0].submission
        sex = sub0.answers["sex"]
        filt = self.client.get(f"{base}/gallery/data/?field=sex&value={sex}").json()
        self.assertTrue(all(i["submission_id"] for i in filt["items"]))
        self.assertIn(photos[0].id, {i["id"] for i in filt["items"]})
        self.client.post(f"{base}/gallery/bulk/", json.dumps({"ids": [photos[1].id], "hidden": True}), content_type="application/json")
        self.assertNotIn(photos[1].id, {i["id"] for i in self.client.get(f"{base}/gallery/data/").json()["items"]})
        z = zipfile.ZipFile(io.BytesIO(self.client.get(f"{base}/gallery/zip/?ids={photos[0].id},{photos[2].id}").content))
        self.assertIn("index.csv", z.namelist())
        self.assertEqual(len([n for n in z.namelist() if n.startswith("photos/")]), 2)


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class ReportAndStoryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("rs_owner", password="pw")
        cls.survey = make_survey(cls.owner, n=40)
        add_photo_question(cls.survey)
        cls.photos = attach_photos(cls.survey, n=6, star=(1, 4))

    def setUp(self):
        cache.clear()
        self.client.force_login(self.owner)

    def ctx(self):
        from .agent_views import build_context
        return build_context(self.owner, self.survey.code, "data")

    def test_report_all_formats_with_photos(self):
        from .agent_report import builtin_report
        spec = builtin_report(self.ctx())
        block = eng.run_tool(self.ctx(), spec)
        self.assertEqual(block["type"], "report", block)
        self.assertGreaterEqual(block["stats"]["charts"], 3)
        self.assertGreaterEqual(block["stats"]["photos"], 1)
        for fmt, magic in (("docx", b"PK"), ("pdf", b"%PDF"), ("html", b"<!doctype")):
            r = self.client.post("/kura/agent/export/", json.dumps({"code": self.survey.code, "page": "data",
                                                                   "spec": block["spec"], "format": fmt}),
                                 content_type="application/json")
            self.assertEqual(r.status_code, 200, (fmt, r.content[:200]))
            self.assertTrue(r.content.startswith(magic), fmt)
            if fmt == "docx":
                names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
                self.assertGreaterEqual(len([n for n in names if n.startswith("word/media/")]), 4)   # charts + photos
            if fmt == "html":
                self.assertGreaterEqual(r.content.count(b"data:image/jpeg"), 1)
                self.assertNotIn(b"Fatou Ceesay", r.content)

    def test_report_from_ai_spec_uses_computed_numbers(self):
        spec = {"tool": "report", "title": "Water access", "summary": "Most homes use taps.",
                "sections": [{"heading": "Sources", "text": "Taps lead.", "chart": {"kind": "bar", "x": "water"},
                              "photos": {"count": 2}},
                             {"heading": "Bad", "chart": {"kind": "bar", "x": "nope"}}],
                "recommendations": ["Fix the pumps"]}
        block = eng.run_tool(self.ctx(), spec)
        self.assertEqual(block["sections"][0]["chart"]["labels"][:3] and len(block["sections"][0]["photos"]), 2)
        self.assertTrue(any("nope" in p for p in block["problems"]))
        starred = {m.id for m in self.photos if m.starred}
        from .agent_report import build_report
        rep = build_report(self.ctx(), spec)
        self.assertEqual({p["media"].id for p in rep["sections"][0]["photos"]}, starred)       # starred first

    def test_story_deck_spec_and_hanns_deck(self):
        spec = {"tool": "story_deck", "title": "Water, told", "theme": "atlantic", "scenes": [
            {"type": "title", "headline": "Every drop counts"},
            {"type": "bignumber", "headline": "Women answered most", "number": {"format": "percent",
                "filters": [{"field": "sex", "operator": "eq", "value": "Female"}]}, "notes": "Pause here."},
            {"type": "chart", "headline": "Taps lead", "chart": {"kind": "donut", "x": "water"}},
            {"type": "compare", "headline": "Women vs men", "items": [
                {"label": "Women", "filters": [{"field": "sex", "operator": "eq", "value": "f"}]},
                {"label": "Men", "filters": [{"field": "sex", "operator": "eq", "value": "m"}]}]},
            {"type": "photo", "headline": "A morning at the tap"},
            {"type": "gallery", "headline": "Voices", "photo": {"count": 3}},
            {"type": "chart", "headline": "Broken", "chart": {"x": "missing_column"}},
            {"type": "takeaways", "points": ["One", "Two", "Three"]}]}
        block = eng.run_tool(self.ctx(), spec)
        self.assertEqual(block["type"], "story", block)
        types = [s["type"] for s in block["scenes"]]
        self.assertEqual(types, ["title", "bignumber", "chart", "compare", "photo", "gallery", "takeaways", "closing"])
        self.assertTrue(any("missing_column" in p for p in block["problems"]))
        df = self.ctx().frame
        want = round((df["sex"] == "f").mean() * 100, 1)
        self.assertEqual(block["scenes"][1]["value"], f"{eng.fmt_num(want)}%")
        photo_ids = set()
        r = self.client.post("/kura/agent/apply/", json.dumps({"action": "create_story_deck", "code": self.survey.code,
                                                              "page": "data", "spec": block["spec"], "theme": "forest"}),
                             content_type="application/json").json()
        self.assertTrue(r["ok"], r)
        from hanns.models import Deck
        deck = Deck.objects.get(code=r["code"])
        self.assertEqual(deck.owner, self.owner)
        slides = list(deck.slides.all())
        self.assertEqual(len(slides), 8)
        for sl in slides:
            for el in sl.data["els"]:
                if el["type"] == "text":
                    self.assertIn("lh", el)
                    self.assertIn("weight", el)                                  # Hanns' font shorthand needs both
                if el["type"] == "chart":
                    self.assertIn(el["chartKind"], ("bar", "donut", "pie", "line", "area"))
                    self.assertTrue(el["chartData"])
                if el["type"] == "image":
                    self.assertTrue(el["src"].startswith(f"/media/hanns/decks/{deck.code}/images/"), el["src"])
                    photo_ids.add(el["src"])
        self.assertEqual(slides[1].data["notes"], "Pause here.")
        self.assertEqual(slides[0].data["bg"], "linear-gradient(135deg,#06140e 0%,#0e3a27 58%,#1d6142 100%)")   # forest
        self.assertGreaterEqual(len(photo_ids), 4)                               # title + photo + 3 in the gallery, no repeats

    def test_builtin_intents_and_gallery_block(self):
        with mock.patch.object(agent_ai, "ai_enabled", return_value=False):
            for msg, kind in (("show me the photos", "gallery"), ("write a report about this data", "report"),
                              ("make a presentation about the survey", "story")):
                j = self.client.post("/kura/agent/chat/", json.dumps({"message": msg, "code": self.survey.code, "page": "data"}),
                                     content_type="application/json").json()
                self.assertEqual(j["blocks"][0]["type"], kind, (msg, j["blocks"][0]))
        prompt = agent_ai.build_user_prompt(self.ctx(), "hi", [])
        self.assertIn("PHOTOS: 6 photo(s), 2 starred", prompt)

    def test_histogram_ignores_extreme_values(self):
        b = eng.run_tool(self.ctx(), {"tool": "chart", "kind": "histogram", "x": "income"})
        self.assertIn("extreme value", b["caption"])
        self.assertTrue(b["histogram"])
        self.assertLess(int(b["labels"][-1].split("–")[-1].replace(",", "").split(".")[0]), 9_000_000)

    def test_existing_results_deck_charts_render(self):
        from .hanns_export import _chart
        el = _chart("donut", [("a", 1), ("b", 2)], 0, 0, 100, 100)
        self.assertEqual(el["chartKind"], "donut")
