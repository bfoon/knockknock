"""
kura/logic.py — the form logic engine (server side), v2.

Evaluates the same structured logic the builder produces and the JS runner
executes, so a submission is validated on the server with byte-identical
semantics to what the respondent saw.

  evaluate_condition(cond, answers)          → bool   (skip logic)
  evaluate_expression(expr, answers)         → number (calculated questions)
  point_in_zone(lat, lng, zone)              → bool   (geofencing)
  geo_relevant(question, gps, zones)         → bool
  allowed_choice_values(q, ctx, gps, zones)  → list   (cascade + geo filter)
  validate_submission(schema, answers, gps=None)
      → (clean_answers, calcs, score, errors)

── Conditions ────────────────────────────────────────────────────────
    {"op": "and"|"or", "rules": [ <rule|group>, … ]}      nestable
    rule = {"q": name, "cmp": comparator, "value": any}
Comparators: eq ne gt gte lt lte contains not_contains selected
    not_selected answered not_answered in not_in between matches

── Geofence zones (survey level, schema["zones"]) ────────────────────
    {"id":"z1","name":"Banjul area","kind":"circle",
     "lat":13.4531,"lng":-16.579,"radius_km":25}
    {"id":"z2","name":"North Bank","kind":"polygon",
     "points":[[13.5,-16.7],[13.6,-16.4],[13.4,-16.3]]}

Question-level geofence:
    "geofence": {"zones":["z1","z2"], "mode":"inside"|"outside",
                 "fallback":"show"|"hide"}      # when no GPS available
A geofenced question is only relevant when the respondent's location
matches; irrelevant answers are dropped exactly like skip logic.

── Cascading selects (with optional geo-filtered choice lists) ───────
    {"name":"district","type":"select_one",
     "cascade":{"parent":"region"},
     "geo_choice_fallback":"all"|"none",       # choices w/ zones, no GPS
     "choices":[
        {"value":"bakau","label":"Bakau","parent":"kmc","zones":["z1"]},
        …]}
A choice is offered only if (a) its "parent" equals the parent question's
current answer, and (b) it has no "zones" OR the respondent's GPS is
inside one of them. The server enforces both, so a tampered client cannot
submit a value the respondent could not legitimately see.

── Repeat groups ─────────────────────────────────────────────────────
    {"name":"members","type":"repeat","label":"Household members",
     "repeat":{"min":1,"max":15,"item_label":"Member ${index}"},
     "children":[ …ordinary questions… ]}
Answer shape: answers["members"] = [ {child_name: value, …}, … ].
Child skip logic sees the current item's answers first, then the outer
answers — so a child can depend on a sibling ("relationship") or on an
outer question ("region"). Child "calculate" questions are evaluated per
item; scored children accumulate into the overall response score. Errors
are keyed "members.<index>.<child>".
"""

from __future__ import annotations

import ast
import math
import operator
import re


# ── condition evaluation ─────────────────────────────────────────────

def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rule(rule, answers):
    q = rule.get("q")
    cmp_ = rule.get("cmp", "eq")
    want = rule.get("value")
    have = answers.get(q)

    if cmp_ == "answered":
        return have not in (None, "", [], {})
    if cmp_ == "not_answered":
        return have in (None, "", [], {})

    if cmp_ in ("selected", "not_selected"):
        sel = have if isinstance(have, list) else ([have] if have not in (None, "") else [])
        hit = str(want) in [str(x) for x in sel]
        return hit if cmp_ == "selected" else not hit

    if cmp_ in ("in", "not_in"):
        opts = want if isinstance(want, list) else [want]
        hit = str(have) in [str(o) for o in opts]
        return hit if cmp_ == "in" else not hit

    if cmp_ == "contains":
        return want is not None and have is not None and str(want).lower() in str(have).lower()
    if cmp_ == "not_contains":
        return not (want is not None and have is not None and str(want).lower() in str(have).lower())

    if cmp_ == "matches":
        try:
            return bool(re.search(str(want), str(have or "")))
        except re.error:
            return False

    if cmp_ == "between":
        n = _num(have)
        if n is None or not isinstance(want, (list, tuple)) or len(want) != 2:
            return False
        lo, hi = _num(want[0]), _num(want[1])
        return lo is not None and hi is not None and lo <= n <= hi

    if cmp_ in ("gt", "gte", "lt", "lte"):
        a, b = _num(have), _num(want)
        if a is None or b is None:
            return False
        return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[cmp_]

    a, b = _num(have), _num(want)
    if a is not None and b is not None:
        hit = a == b
    else:
        hit = str(have) == str(want) if have is not None else want in (None, "")
    return hit if cmp_ == "eq" else not hit


def evaluate_condition(cond, answers) -> bool:
    """Empty/None condition means 'always relevant'."""
    if not cond:
        return True
    if "rules" in cond:
        rules = cond.get("rules") or []
        if not rules:
            return True
        results = (evaluate_condition(r, answers) for r in rules)
        return any(results) if cond.get("op") == "or" else all(results)
    return _rule(cond, answers)


# ── safe expression evaluation ───────────────────────────────────────

_BIN = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: lambda a, b: a / b if b else 0.0,
    ast.FloorDiv: lambda a, b: a // b if b else 0.0,
    ast.Mod: lambda a, b: a % b if b else 0.0,
    ast.Pow: operator.pow,
}
_CMPOPS = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Gt: operator.gt,
    ast.GtE: operator.ge, ast.Lt: operator.lt, ast.LtE: operator.le,
}
_FUNCS = {
    "abs": abs, "min": min, "max": max, "round": round,
    "int": lambda v: int(float(v)), "float": float, "pow": pow,
    "sqrt": math.sqrt,
    "coalesce": lambda *a: next((x for x in a if x not in (None, "", [])), 0),
    "if_": lambda c, a, b: a if c else b,
    "count": lambda v: len(v) if isinstance(v, (list, tuple)) else (0 if v in (None, "") else 1),
    # repeat-group aggregates: sum_of(members, "age") etc. — the first arg is
    # a repeat answer (list of dicts), the second the child column name.
    "sum_of": lambda items, col: sum(_num(i.get(col)) or 0
                                     for i in items if isinstance(i, dict))
              if isinstance(items, list) else 0,
    "avg_of": lambda items, col: (
        (lambda vals: sum(vals) / len(vals) if vals else 0)
        ([_num(i.get(col)) for i in items
          if isinstance(i, dict) and _num(i.get(col)) is not None])
        if isinstance(items, list) else 0),
    "min_of": lambda items, col: (
        (lambda vals: min(vals) if vals else 0)
        ([_num(i.get(col)) for i in items
          if isinstance(i, dict) and _num(i.get(col)) is not None])
        if isinstance(items, list) else 0),
    "max_of": lambda items, col: (
        (lambda vals: max(vals) if vals else 0)
        ([_num(i.get(col)) for i in items
          if isinstance(i, dict) and _num(i.get(col)) is not None])
        if isinstance(items, list) else 0),
    "count_if": lambda items, col, cmp, ref: sum(
        1 for i in items if isinstance(i, dict)
        and _num(i.get(col)) is not None and _num(ref) is not None
        and {"eq": _num(i.get(col)) == _num(ref),
             "ne": _num(i.get(col)) != _num(ref),
             "gt": _num(i.get(col)) > _num(ref),
             "gte": _num(i.get(col)) >= _num(ref),
             "lt": _num(i.get(col)) < _num(ref),
             "lte": _num(i.get(col)) <= _num(ref)}.get(cmp, False))
              if isinstance(items, list) else 0,
}


def expr_number(expr, ctx):
    """Evaluate an expression to a number, or None (blank / broken expr)."""
    if expr in (None, "") or not str(expr).strip():
        return None
    out = evaluate_expression(expr, ctx)
    return _num(out) if not isinstance(out, bool) else (1.0 if out else 0.0)


def expr_holds(expr, ctx):
    """Evaluate a constraint expression to True/False.
    Blank or broken expressions never block (return True)."""
    if expr in (None, "") or not str(expr).strip():
        return True
    out = evaluate_expression(expr, ctx)
    if out is None:
        return True
    return bool(out)


def evaluate_expression(expr: str, answers: dict):
    """Evaluate a calc expression; returns a number (or None on failure)."""
    if not expr or not str(expr).strip():
        return None
    src = str(expr).replace("^", "**")
    try:
        tree = ast.parse(src, mode="eval")
    except SyntaxError:
        return None

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, str)):
            return node.value
        if isinstance(node, ast.Name):
            v = answers.get(node.id)
            n = _num(v)
            return n if n is not None else (len(v) if isinstance(v, list) else 0.0)
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return _BIN[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = walk(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in _CMPOPS:
            return _CMPOPS[type(node.ops[0])](walk(node.left), walk(node.comparators[0]))
        if isinstance(node, ast.BoolOp):
            vals = [walk(v) for v in node.values]
            return all(vals) if isinstance(node.op, ast.And) else any(vals)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
            args = []
            for a in node.args:
                if isinstance(a, ast.Name):
                    raw = answers.get(a.id)
                    args.append(raw if isinstance(raw, list) else walk(a))
                else:
                    args.append(walk(a))
            return _FUNCS[node.func.id](*args)
        raise ValueError(f"disallowed expression node: {type(node).__name__}")

    try:
        out = walk(tree)
        return round(out, 6) if isinstance(out, float) else out
    except Exception:
        return None


# ── piping ───────────────────────────────────────────────────────────

_PIPE_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def pipe(text: str, answers: dict) -> str:
    def sub(m):
        v = answers.get(m.group(1))
        if isinstance(v, list):
            return ", ".join(str(x) for x in v)
        return "" if v in (None, "") else str(v)
    return _PIPE_RE.sub(sub, str(text or ""))


# ── geofencing ───────────────────────────────────────────────────────

def _haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _point_in_polygon(lat, lng, points):
    """Ray casting; points = [[lat,lng], …], at least a triangle."""
    if not points or len(points) < 3:
        return False
    inside = False
    j = len(points) - 1
    for i in range(len(points)):
        yi, xi = float(points[i][0]), float(points[i][1])
        yj, xj = float(points[j][0]), float(points[j][1])
        if ((yi > lat) != (yj > lat)) and \
           (lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def point_in_zone(lat, lng, zone) -> bool:
    try:
        if (zone or {}).get("kind") == "polygon":
            return _point_in_polygon(float(lat), float(lng), zone.get("points") or [])
        return _haversine_km(float(lat), float(lng),
                             float(zone["lat"]), float(zone["lng"])) \
            <= float(zone.get("radius_km", 1))
    except (KeyError, TypeError, ValueError):
        return False


def zones_by_id(schema: dict) -> dict:
    return {str(z.get("id")): z for z in ((schema or {}).get("zones") or []) if z.get("id")}


def gps_in_any(gps, zone_ids, zones: dict) -> bool:
    if not gps:
        return False
    lat, lng = gps[0], gps[1]
    return any(point_in_zone(lat, lng, zones.get(str(zid)))
               for zid in (zone_ids or []) if zones.get(str(zid)))


def geo_relevant(question: dict, gps, zones: dict) -> bool:
    """Question-level geofence. gps = [lat, lng] or None."""
    gf = (question or {}).get("geofence") or {}
    ids = gf.get("zones") or []
    if not ids:
        return True
    if gps is None:
        return gf.get("fallback", "show") != "hide"
    inside = gps_in_any(gps, ids, zones)
    return inside if gf.get("mode", "inside") == "inside" else not inside


# ── choice filtering: cascade + geo ─────────────────────────────────

def allowed_choice_values(q: dict, ctx: dict, gps, zones: dict):
    """The values a respondent could legitimately pick right now.
    Returns None when the question has no choice list at all."""
    choices = q.get("choices")
    if choices is None:
        return None
    parent_name = ((q.get("cascade") or {}).get("parent") or "").strip()
    parent_val = ctx.get(parent_name) if parent_name else None
    out = []
    for c in choices:
        if parent_name:
            if parent_val in (None, "", []):
                continue  # no parent answer yet → nothing offered
            if str(c.get("parent")) != str(parent_val):
                continue
        cz = c.get("zones") or []
        if cz:
            if gps is None:
                if q.get("geo_choice_fallback", "all") == "none":
                    continue
            elif not gps_in_any(gps, cz, zones):
                continue
        out.append(str(c.get("value")))
    return out


# ── full submission validation ───────────────────────────────────────

def _check_value(q, val, ctx, gps, zones):
    """Validate ONE answered question's value. Returns (value, error|None).

    validate = {min, max,                # static bounds
                min_expr, max_expr,      # expression bounds (other answers!)
                expr,                    # constraint: must evaluate truthy;
                                         #   `value` (and the question's own
                                         #   name) hold the current answer
                regex, message}"""
    qtype = q.get("type")
    v = q.get("validate") or {}
    name = q.get("name")

    def _constraint(final_val):
        expr = v.get("expr")
        if not expr:
            return None
        ctx2 = {**ctx, "value": final_val}
        if name:
            ctx2[name] = final_val
        if not expr_holds(expr, ctx2):
            return v.get("message") or "This answer fails the form's constraint."
        return None

    if qtype in ("integer", "decimal", "rating"):
        n = _num(val)
        if n is None:
            return val, "Enter a number."
        if qtype == "integer" and n != int(n):
            return val, "Enter a whole number."
        lo = _num(v.get("min"))
        dyn_lo = expr_number(v.get("min_expr"), ctx)
        if dyn_lo is not None:
            lo = dyn_lo if lo is None else max(lo, dyn_lo)
        hi = _num(v.get("max"))
        dyn_hi = expr_number(v.get("max_expr"), ctx)
        if dyn_hi is not None:
            hi = dyn_hi if hi is None else min(hi, dyn_hi)
        if lo is not None and n < lo:
            return val, v.get("message") or f"Must be at least {lo:g}."
        if hi is not None and n > hi:
            return val, v.get("message") or f"Must be at most {hi:g}."
        final = int(n) if qtype == "integer" else n
        err = _constraint(final)
        return final, err

    if qtype in ("text", "long_text", "barcode") and v.get("regex"):
        try:
            if not re.search(v["regex"], str(val)):
                return val, v.get("message") or "Answer format is not valid."
        except re.error:
            pass

    if qtype in ("select_one", "likert"):
        allowed = allowed_choice_values(q, ctx, gps, zones)
        if allowed is not None and str(val) not in allowed:
            return val, "Choose one of the options available to you."

    if qtype in ("select_multiple", "rank"):
        vals = val if isinstance(val, list) else [val]
        allowed = allowed_choice_values(q, ctx, gps, zones)
        if allowed is not None and any(str(x) not in allowed for x in vals):
            return vals, "One of the selected options is not available to you."
        if v.get("min") is not None and len(vals) < int(v["min"]):
            return vals, v.get("message") or f"Select at least {v['min']}."
        if v.get("max") is not None and len(vals) > int(v["max"]):
            return vals, v.get("message") or f"Select at most {v['max']}."
        err = _constraint(vals)
        return vals, err

    err = _constraint(val)
    return val, err


def _score_of(q, val):
    sc = q.get("score") or {}
    if not sc:
        return None
    if isinstance(val, list):
        return sum(float(sc.get(str(x), 0) or 0) for x in val)
    return float(sc.get(str(val), 0) or 0)


def validate_submission(schema: dict, answers: dict, gps=None):
    """Server-side truth for a submission.

    Returns (clean_answers, calculations, score, errors).
    - Skip logic AND geofencing decide relevance; irrelevant answers drop.
    - Cascading/geo-filtered choice lists are enforced (a client cannot
      submit an option its location or parent answer would have hidden).
    - Repeat groups validate each item's children with per-item context;
      errors are keyed "group.<index>.<child>".
    - Calculated fields (top level and inside repeat items) are computed
      server-side; client-sent values are ignored.
    """
    questions = (schema or {}).get("questions") or []
    zones = zones_by_id(schema)
    answers = dict(answers or {})
    clean, calcs, errors = {}, {}, {}
    score_total = 0.0
    score_used = False

    # Pass 1: top-level calcs feed later relevance conditions.
    ctx = dict(answers)
    for q in questions:
        if q.get("type") == "calculate":
            ctx[q.get("name")] = evaluate_expression(q.get("calc"), ctx)

    for q in questions:
        name = q.get("name")
        qtype = q.get("type")
        if not name or qtype == "section":
            continue

        if not (evaluate_condition(q.get("relevant"), ctx)
                and geo_relevant(q, gps, zones)):
            continue  # drop answers to hidden questions

        if qtype == "calculate":
            calcs[name] = ctx.get(name)
            continue

        val = answers.get(name)
        empty = val in (None, "", [], {})

        # ── repeat groups ────────────────────────────────────────────
        if qtype == "repeat":
            items = val if isinstance(val, list) else ([] if empty else [val])
            rp = q.get("repeat") or {}
            # expression-driven counts: count_expr fixes the exact number of
            # items (e.g. hh_size); min_expr/max_expr set dynamic bounds.
            exact = expr_number(rp.get("count_expr"), ctx)
            if exact is not None:
                exact = max(0, min(int(exact), 500))
                if len(items) != exact:
                    errors[name] = f"Exactly {exact} item(s) required (from {rp.get('count_expr')})."
                    continue
            lo = _num(rp.get("min"))
            dyn_lo = expr_number(rp.get("min_expr"), ctx)
            if dyn_lo is not None:
                lo = dyn_lo if lo is None else max(lo, dyn_lo)
            hi = _num(rp.get("max"))
            dyn_hi = expr_number(rp.get("max_expr"), ctx)
            if dyn_hi is not None:
                hi = dyn_hi if hi is None else min(hi, dyn_hi)
            if exact is None and lo is not None and len(items) < lo:
                errors[name] = f"Add at least {int(lo)} item(s)."
                continue
            if exact is None and hi is not None and len(items) > hi:
                errors[name] = f"No more than {int(hi)} item(s) allowed."
                continue
            children = q.get("children") or []
            clean_items = []
            for idx, raw_item in enumerate(items):
                item = dict(raw_item) if isinstance(raw_item, dict) else {}
                # per-item calc pass (sibling calcs usable in sibling logic)
                item_ctx = {**ctx, **item}
                for ch in children:
                    if ch.get("type") == "calculate":
                        item_ctx[ch.get("name")] = evaluate_expression(ch.get("calc"), item_ctx)
                clean_item = {}
                for ch in children:
                    cname, ctype_ = ch.get("name"), ch.get("type")
                    if not cname or ctype_ == "section":
                        continue
                    if not (evaluate_condition(ch.get("relevant"), item_ctx)
                            and geo_relevant(ch, gps, zones)):
                        continue
                    if ctype_ == "calculate":
                        clean_item[cname] = item_ctx.get(cname)
                        continue
                    cval = item.get(cname)
                    cempty = cval in (None, "", [], {})
                    key = f"{name}.{idx}.{cname}"
                    if ch.get("required") and cempty:
                        errors[key] = (ch.get("validate") or {}).get("message") \
                            or "This answer is required."
                        continue
                    if cempty:
                        continue
                    cval, err = _check_value(ch, cval, item_ctx, gps, zones)
                    if err:
                        errors[key] = err
                        continue
                    s = _score_of(ch, cval)
                    if s is not None:
                        score_used = True
                        score_total += s
                    clean_item[cname] = cval
                clean_items.append(clean_item)
            if q.get("required") and not clean_items:
                errors[name] = "Add at least one item."
                continue
            clean[name] = clean_items
            continue

        # ── ordinary questions ───────────────────────────────────────
        if q.get("required") and empty:
            errors[name] = (q.get("validate") or {}).get("message") \
                or "This answer is required."
            continue
        if empty:
            continue

        val, err = _check_value(q, val, ctx, gps, zones)
        if err:
            errors[name] = err
            continue

        s = _score_of(q, val)
        if s is not None:
            score_used = True
            score_total += s

        clean[name] = val

    # Second calc pass: aggregates like sum_of(members, "age") should see the
    # CLEANED repeat items (irrelevant children dropped, per-item calcs added).
    ctx2 = {**ctx, **clean}
    for q in questions:
        if q.get("type") == "calculate" and q.get("name") in calcs:
            calcs[q["name"]] = evaluate_expression(q.get("calc"), ctx2)

    return clean, calcs, (score_total if score_used else None), errors
