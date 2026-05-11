import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from presentations.models import LiveSession

from .charts import ALL_CHARTS, curated_charts_for
from .forms import (
    CollaboratorInviteForm,
    ChoiceFormSet,
    CONFIG_FORM_BY_TYPE,
    MatrixRowFormSet,
    QuestionForm,
    QuestionnaireForm,
)
from .models import (
    Choice,
    MatrixRow,
    Question,
    Questionnaire,
    QuestionnaireCollaborator,
)
from .question_types import QUESTION_TYPE_REGISTRY

import logging
logger = logging.getLogger(__name__)

def _seed_default_choices(question):
    """Seed a couple of starter choices for choice-storage types."""
    meta = QUESTION_TYPE_REGISTRY.get(question.type, {})
    if not meta.get("has_choices"):
        return
    auto = meta.get("auto_choices")
    if auto:
        for i, label in enumerate(auto):
            Choice.objects.create(question=question, text=label, order=i)
    else:
        for i, t in enumerate(["Option 1", "Option 2"]):
            Choice.objects.create(question=question, text=t, order=i)


# ── List / create / edit (questionnaire-level) ─────────────────────────
@login_required
def list_view(request):
    qs = Questionnaire.objects.filter(owner=request.user)
    return render(request, "polls/list.html", {"questionnaires": qs})


@login_required
def create(request):
    if request.method == "POST":
        form = QuestionnaireForm(request.POST, request.FILES)
        if form.is_valid():
            q = form.save(commit=False)
            q.owner = request.user
            if request.POST.get("template_id"):
                q.template_id = request.POST["template_id"]
            q.save()
            messages.success(request, "Questionnaire created.")
            return redirect("polls:edit", pk=q.pk)
    else:
        form = QuestionnaireForm()
    return render(request, "polls/create.html", {"form": form, "templates": TEMPLATES})


@login_required
def edit(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    is_owner = questionnaire.owner_id == request.user.id

    if request.method == "POST":
        form = QuestionnaireForm(request.POST, request.FILES, instance=questionnaire)
        if form.is_valid():
            form.save()
            messages.success(request, "Saved.")
            return redirect("polls:edit", pk=pk)
    else:
        form = QuestionnaireForm(instance=questionnaire)

    return render(request, "polls/edit.html", {
        "questionnaire": questionnaire,
        "form": form,
        "templates": TEMPLATES,
        "selected_template": get_template(questionnaire.template_id),
        "is_owner": is_owner,
        "collaborators": questionnaire.collaborators.select_related("user"),
        "invite_form": CollaboratorInviteForm(),
    })


@login_required
@require_POST
def set_template(request, pk):
    q = get_object_or_404(Questionnaire, pk=pk)
    if not q.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    q.template_id = request.POST.get("template_id", q.template_id)
    q.save(update_fields=["template_id"])
    return JsonResponse({"ok": True})


# ── Questions ─────────────────────────────────────────────────────────
@login_required
def question_create(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")

    q = Question.objects.create(
        questionnaire=questionnaire,
        text="New question",
        order=questionnaire.questions.count(),
        type="mcq",
        chart_type="bar",
    )
    # Seed default choices for MCQ
    for i, t in enumerate(["Option 1", "Option 2"]):
        Choice.objects.create(question=q, text=t, order=i)
    return redirect("polls:question_edit", pk=questionnaire.pk, qpk=q.pk)


@login_required
def question_edit(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    question = get_object_or_404(Question, pk=qpk, questionnaire=questionnaire)
    meta = QUESTION_TYPE_REGISTRY.get(question.type, {})

    ConfigFormClass = CONFIG_FORM_BY_TYPE.get(question.type)

    if request.method == "POST":
        form = QuestionForm(request.POST, request.FILES, instance=question)
        formset = ChoiceFormSet(request.POST, request.FILES, instance=question) \
            if meta.get("has_choices") else None
        matrix_rows = MatrixRowFormSet(request.POST, instance=question) \
            if question.type == "matrix" else None
        config_form = ConfigFormClass(request.POST, prefix="cfg") \
            if ConfigFormClass else None
        skip_rules_json = request.POST.get("skip_rules_json", "")

        # ── Validate everything BEFORE branching, so we collect all errors ──
        form_ok = form.is_valid()
        formset_ok = formset.is_valid() if formset is not None else True
        matrix_ok = matrix_rows.is_valid() if matrix_rows is not None else True
        config_ok = config_form.is_valid() if config_form is not None else True

        # ── DEBUG: dump every error to the terminal ──
        if not form_ok:
            print("\n=== QuestionForm errors ===")
            for field, errs in form.errors.items():
                print(f"  {field}: {errs}")
            print(f"  non_field_errors: {form.non_field_errors()}")
            messages.error(request, f"Question form errors: {form.errors.as_text()}")

        if formset is not None and not formset_ok:
            print("\n=== ChoiceFormSet errors ===")
            print(f"  non_form_errors: {formset.non_form_errors()}")
            for i, f in enumerate(formset.forms):
                if f.errors:
                    print(f"  Choice form #{i} (empty_permitted={f.empty_permitted}): {f.errors}")
            messages.error(request, f"Choice errors: {formset.errors}")

        if matrix_rows is not None and not matrix_ok:
            print("\n=== MatrixRowFormSet errors ===")
            for i, f in enumerate(matrix_rows.forms):
                if f.errors:
                    print(f"  Matrix row #{i}: {f.errors}")
            messages.error(request, f"Matrix errors: {matrix_rows.errors}")

        if config_form is not None and not config_ok:
            print("\n=== Config form errors ===")
            print(f"  {config_form.errors}")
            messages.error(request, f"Config errors: {config_form.errors.as_text()}")

        skip_rules = []
        if skip_rules_json.strip():
            try:
                skip_rules = json.loads(skip_rules_json)
                if not isinstance(skip_rules, list):
                    raise ValueError("skip_rules must be a list")
            except (ValueError, json.JSONDecodeError) as e:
                print(f"\n=== Skip rules JSON error: {e} ===")
                form_ok = False
                messages.error(request, f"Invalid skip rules JSON: {e}")

        forms_ok = form_ok and formset_ok and matrix_ok and config_ok

        if forms_ok:
            q = form.save(commit=False)
            q.skip_rules = skip_rules
            if config_form is not None:
                q.config = config_form.cleaned_data
            q.save()
            if formset is not None:
                formset.save()
            if matrix_rows is not None:
                matrix_rows.save()
            _auto_seed_choices_if_empty(q)
            messages.success(request, "Question saved.")
            return redirect("polls:edit", pk=questionnaire.pk)
        else:
            print(f"\n=== Save BLOCKED. form_ok={form_ok} formset_ok={formset_ok} "
                  f"matrix_ok={matrix_ok} config_ok={config_ok} ===\n")
    else:
        form = QuestionForm(instance=question)
        formset = ChoiceFormSet(instance=question) if meta.get("has_choices") else None
        matrix_rows = MatrixRowFormSet(instance=question) if question.type == "matrix" else None
        config_form = ConfigFormClass(initial=question.config, prefix="cfg") \
            if ConfigFormClass else None

    curated = curated_charts_for(question.type)
    curated_ids = {cid for cid, _ in curated}

    from .question_types import grouped_for_picker

    return render(request, "polls/question_edit.html", {
        "questionnaire": questionnaire,
        "question": question,
        "form": form,
        "formset": formset,
        "matrix_rows": matrix_rows,
        "config_form": config_form,
        "meta": meta,
        "curated_charts": curated,
        "curated_chart_ids": curated_ids,
        "all_charts": list(ALL_CHARTS.items()),
        "grouped_qtypes": grouped_for_picker(),
        "skip_rules_json": json.dumps(question.skip_rules or []),
        "siblings": list(questionnaire.questions.exclude(pk=question.pk).order_by("order")),
    })

def _auto_seed_choices_if_empty(question):
    """If a type has `auto_choices` in its registry entry and no choices exist, seed them."""
    meta = QUESTION_TYPE_REGISTRY.get(question.type, {})
    auto = meta.get("auto_choices")
    if not auto or not meta.get("has_choices"):
        return
    if question.choices.exists():
        return
    for i, label in enumerate(auto):
        Choice.objects.create(question=question, text=label, order=i)


@login_required
@require_POST
def change_type(request, pk, qpk):
    """
    Handle changing a question's type. Resets chart_type to the new type's
    default, optionally seeds auto_choices, and clears stale type-specific
    storage (matrix_rows, points allocations) when switching away.
    """
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    question = get_object_or_404(Question, pk=qpk, questionnaire=questionnaire)

    new_type = request.POST.get("type")
    if new_type not in QUESTION_TYPE_REGISTRY:
        return HttpResponseBadRequest("Unknown type.")
    meta = QUESTION_TYPE_REGISTRY[new_type]

    old_type = question.type
    question.type = new_type
    question.chart_type = meta.get("default_chart", "bar")
    question.config = {}  # reset type-specific config
    question.save(update_fields=["type", "chart_type", "config"])

    # Clean up: if switching away from a type that uses unique storage,
    # drop the now-stale rows.
    if old_type == "matrix" and new_type != "matrix":
        question.matrix_rows.all().delete()

    # Auto-choice types such as yes/no, likert, and reaction must replace
    # stale placeholder choices like "Option 1" / "Option 2". Without this,
    # the participant side can show the wrong buttons or no useful emoji
    # answers after changing an existing question into a reaction question.
    auto_choices = meta.get("auto_choices") or []
    if auto_choices:
        question.choices.all().delete()
        for i, label in enumerate(auto_choices):
            Choice.objects.create(question=question, text=label, order=i)
    elif not meta.get("has_choices"):
        question.choices.all().delete()
    else:
        _auto_seed_choices_if_empty(question)

    return redirect("polls:question_edit", pk=questionnaire.pk, qpk=question.pk)


@login_required
@require_POST
def question_delete(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    Question.objects.filter(pk=qpk, questionnaire=questionnaire).delete()
    return redirect("polls:edit", pk=pk)


@login_required
@require_POST
def reorder_questions(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
        ids = [int(x) for x in payload.get("order", [])]
    except (ValueError, json.JSONDecodeError):
        return HttpResponseBadRequest("Invalid payload.")

    existing = {q.pk for q in questionnaire.questions.all()}
    if set(ids) != existing:
        return HttpResponseBadRequest("ID set mismatch.")

    by_id = {q.pk: q for q in questionnaire.questions.all()}
    for new_order, qpk in enumerate(ids):
        q = by_id[qpk]
        if q.order != new_order:
            q.order = new_order
            q.save(update_fields=["order"])
    return JsonResponse({"ok": True})


# ── Live session ──────────────────────────────────────────────────────
@login_required
@require_POST
def start_session(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    session = LiveSession.objects.create(
        owner=request.user, kind="poll",
        questionnaire=questionnaire, mode=questionnaire.mode,
    )
    return redirect("presentations:present", code=session.code)


# ── Collaboration (unchanged from before) ─────────────────────────────
@login_required
@require_POST
def invite_collaborator(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    form = CollaboratorInviteForm(request.POST)
    if form.is_valid():
        user = form.find_user()
        if not user:
            messages.error(request, "No user found by that username or email.")
        elif user == request.user:
            messages.error(request, "You can't invite yourself.")
        else:
            QuestionnaireCollaborator.objects.get_or_create(
                questionnaire=questionnaire, user=user,
                defaults={"role": form.cleaned_data["role"], "invited_by": request.user},
            )
            messages.success(request, f"{user.username} can now {form.cleaned_data['role']}.")
    return redirect("polls:edit", pk=pk)


@login_required
@require_POST
def remove_collaborator(request, pk, cpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    QuestionnaireCollaborator.objects.filter(pk=cpk, questionnaire=questionnaire).delete()
    return redirect("polls:edit", pk=pk)


# ── Stubs for results/export — kept for URL compatibility ─────────────
# (Your existing implementation should keep working with the new fields;
# I haven't rewritten these because they're outside the scope of this drop.)
@login_required
def questionnaire_results(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    return render(request, "polls/results.html", {"questionnaire": questionnaire})


@login_required
def download_results_excel(request, pk):
    from django.http import HttpResponse
    return HttpResponse("TODO: re-wire Excel export against new Response fields.",
                        content_type="text/plain")


@login_required
def download_results_word(request, pk):
    from django.http import HttpResponse
    return HttpResponse("TODO: re-wire Word export against new Response fields.",
                        content_type="text/plain")


@login_required
@require_POST
def quick_add_question(request, pk):
    """Create a question with an optional initial text + type from the list page."""
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")

    text = (request.POST.get("text") or "").strip() or "New question"
    qtype = request.POST.get("type") or "mcq"
    if qtype not in QUESTION_TYPE_REGISTRY:
        qtype = "mcq"

    meta = QUESTION_TYPE_REGISTRY[qtype]
    q = Question.objects.create(
        questionnaire=questionnaire,
        text=text,
        order=questionnaire.questions.count(),
        type=qtype,
        chart_type=meta.get("default_chart", "bar"),
    )
    _seed_default_choices(q)

    # Fetch returns JSON; regular form POST redirects back.
    if request.headers.get("X-Requested-With") == "fetch":
        return JsonResponse({
            "ok": True,
            "pk": q.pk,
            "text": q.text,
            "type": q.type,
            "type_label": meta["label"],
            "chart_type": q.chart_type,
            "edit_url": f"/polls/{questionnaire.pk}/q/{q.pk}/",
        })
    messages.success(request, f"Added “{text}”.")
    return redirect("polls:edit", pk=questionnaire.pk)


@login_required
@require_POST
def quick_delete_question(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseBadRequest("No access.")
    Question.objects.filter(pk=qpk, questionnaire=questionnaire).delete()
    if request.headers.get("X-Requested-With") == "fetch":
        return JsonResponse({"ok": True})
    messages.info(request, "Question deleted.")
    return redirect("polls:edit", pk=questionnaire.pk)

