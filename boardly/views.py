"""
boardly/views.py — HTTP views for the Boardly board.

Adds PDF-style linked board flows: one project can generate multiple
BoardSession pages/modules from a default template, then the presenter
moves through them with Previous / Next navigation.
"""

import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile
from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from .models import BoardFlow, BoardGroup, BoardSession


BOARD_TEMPLATES = {
    "innovation": {
        "name": "Innovation Lab",
        "icon": "bi-lightbulb",
        "description": "Explore the problem, create solutions, then evaluate what can work.",
        "modules": [
            {
                "key": "explore",
                "label": "EXPLORE",
                "prompt": "What do we know about {project}? Add facts, users, pain points and opportunities.",
                "description": "Understand the context before jumping into solutions.",
                "columns": ["Pain Points", "Users", "Opportunities", "Evidence"],
            },
            {
                "key": "create",
                "label": "CREATE",
                "prompt": "What solutions, concepts or prototypes can move {project} forward?",
                "description": "Generate many possible solutions and design directions.",
                "columns": ["Ideas", "Concepts", "Prototype", "Support Needed"],
            },
            {
                "key": "evaluate",
                "label": "EVALUATE",
                "prompt": "Which ideas for {project} are feasible, valuable and ready for action?",
                "description": "Compare options and decide what should move forward.",
                "columns": ["Impact", "Feasibility", "Risks", "Next Actions"],
            },
        ],
    },
    "ideation": {
        "name": "Ideation Sprint",
        "icon": "bi-stars",
        "description": "Move from challenge framing to idea generation and prioritisation.",
        "modules": [
            {
                "key": "challenge",
                "label": "CHALLENGE",
                "prompt": "What challenge are we solving in {project}?",
                "description": "Frame the problem clearly.",
                "columns": ["Problem", "Who Is Affected", "Why It Matters", "Constraints"],
            },
            {
                "key": "ideas",
                "label": "IDEAS",
                "prompt": "What ideas can solve or improve {project}?",
                "description": "Collect many ideas without judging too early.",
                "columns": ["Quick Wins", "Bold Ideas", "Digital Ideas", "Partnerships"],
            },
            {
                "key": "prioritize",
                "label": "PRIORITIZE",
                "prompt": "Which ideas for {project} should be selected first?",
                "description": "Rank the ideas and agree on what to do next.",
                "columns": ["High Impact", "Low Effort", "Needs Budget", "Selected"],
            },
        ],
    },
    "logistics": {
        "name": "Logistics Flow",
        "icon": "bi-truck",
        "description": "Map movement, bottlenecks, resources and operational actions.",
        "modules": [
            {
                "key": "map",
                "label": "MAP",
                "prompt": "How does logistics currently move for {project}?",
                "description": "Capture the real movement flow.",
                "columns": ["Origin", "Storage", "Transport", "Destination"],
            },
            {
                "key": "bottlenecks",
                "label": "BOTTLENECKS",
                "prompt": "Where are the delays, costs or risks in {project}?",
                "description": "Identify the weak points in the logistics chain.",
                "columns": ["Delays", "Cost Drivers", "Risks", "Missing Resources"],
            },
            {
                "key": "optimize",
                "label": "OPTIMIZE",
                "prompt": "What improvements can make {project} logistics faster and safer?",
                "description": "Design practical improvements.",
                "columns": ["Route Fixes", "Warehouse Fixes", "People/Tools", "Action Plan"],
            },
        ],
    },
    "business": {
        "name": "Business Design",
        "icon": "bi-briefcase",
        "description": "Develop the model, market, operations and finance view.",
        "modules": [
            {
                "key": "model",
                "label": "MODEL",
                "prompt": "What is the business model for {project}?",
                "description": "Clarify how the business creates and captures value.",
                "columns": ["Customers", "Value Offer", "Channels", "Revenue"],
            },
            {
                "key": "market",
                "label": "MARKET",
                "prompt": "What does the market need from {project}?",
                "description": "Understand customers, competitors and demand.",
                "columns": ["Customer Needs", "Competitors", "Pricing", "Demand Signals"],
            },
            {
                "key": "operations",
                "label": "OPERATIONS",
                "prompt": "What people, tools and processes does {project} need?",
                "description": "Design the operating plan.",
                "columns": ["Team", "Systems", "Suppliers", "Risks"],
            },
            {
                "key": "finance",
                "label": "FINANCE",
                "prompt": "What costs, revenue and funding does {project} require?",
                "description": "Build the financial view.",
                "columns": ["Startup Cost", "Monthly Cost", "Revenue", "Funding"],
            },
        ],
    },
    "value_chain": {
        "name": "Value Chain",
        "icon": "bi-diagram-3",
        "description": "Map inputs, production, processing, market and value capture.",
        "modules": [
            {
                "key": "inputs",
                "label": "INPUTS",
                "prompt": "What inputs and resources are needed for {project}?",
                "description": "Capture what must enter the chain.",
                "columns": ["Materials", "People", "Finance", "Information"],
            },
            {
                "key": "production",
                "label": "PRODUCTION",
                "prompt": "How is value created during production for {project}?",
                "description": "Understand the production stage.",
                "columns": ["Activities", "Tools", "Quality", "Challenges"],
            },
            {
                "key": "processing",
                "label": "PROCESSING",
                "prompt": "How is {project} transformed, packaged or improved?",
                "description": "Map processing and value addition.",
                "columns": ["Processing", "Packaging", "Standards", "Waste/Loss"],
            },
            {
                "key": "market",
                "label": "MARKET",
                "prompt": "How does {project} reach buyers and users?",
                "description": "Map access to market.",
                "columns": ["Buyers", "Channels", "Pricing", "Promotion"],
            },
            {
                "key": "capture",
                "label": "VALUE CAPTURE",
                "prompt": "Where is value captured or lost in {project}?",
                "description": "Identify who benefits and where improvement is needed.",
                "columns": ["Margins", "Leakages", "Power Gaps", "Improvement"],
            },
        ],
    },
}


def _join_url(request, session):
    """Absolute URL a phone hits when it scans the QR code."""
    return request.build_absolute_uri(f"/board/{session.code}/")


def _split_groups(raw):
    """Return clean column names from a comma-separated string."""
    return [g.strip()[:60] for g in (raw or "").split(",") if g.strip()]


def _seed_groups(session, names):
    """Create topic columns for a board session."""
    for i, name in enumerate(names or []):
        BoardGroup.objects.create(session=session, name=name[:60], position=i)


def _safe_limit(value):
    try:
        limit = int(value or 0)
    except (TypeError, ValueError):
        limit = 0
    return max(0, min(limit, 999))


def _make_module_title(module_label, project_name):
    # Matches the user's requested PDF/page naming:
    # EXPLORE-MODULE PROJECT NAME, CREATE-MODULE PROJECT NAME, etc.
    return f"{module_label.upper()}-MODULE {project_name}"[:140]


def _create_session_from_module(
    *,
    request,
    flow,
    template_key,
    project_name,
    module,
    module_order,
    mode,
    layout,
    per_participant_limit,
    lock_columns,
    group_override=None,
    background_image=None,
):
    """Create one BoardSession page inside a linked BoardFlow."""
    prompt = module["prompt"].format(project=project_name)[:200]
    if background_image:
        try:
            background_image.seek(0)
        except Exception:
            pass
    session = BoardSession.objects.create(
        owner=request.user,
        flow=flow,
        template_key=template_key,
        module_key=module["key"],
        module_label=module["label"],
        module_order=module_order,
        module_description=module.get("description", "")[:240],
        title=_make_module_title(module["label"], project_name),
        prompt=prompt,
        mode=mode,
        layout=layout,
        background_image=background_image,
        per_participant_limit=per_participant_limit,
        lock_columns=lock_columns,
        state="open",
    )
    _seed_groups(session, group_override or module.get("columns", []))
    return session


def board_play(request, code):
    """Participant view — the phone/tablet sticky pad."""
    session = get_object_or_404(
        BoardSession.objects.select_related("owner", "flow"),
        code=code.upper(),
    )
    return render(request, "boardly/play_board.html", {
        "session": session,
        "logo_url": getattr(session.owner, "logo_url", None)
        if session.owner_id else None,
    })


def board_stage(request, code):
    """Presenter view — the live projector board with QR code."""
    session = get_object_or_404(
        BoardSession.objects.select_related("owner", "flow"),
        code=code.upper(),
    )

    flow_pages = []
    previous_page = None
    next_page = None
    page_number = 1
    page_total = 1

    if session.flow_id:
        flow_pages = list(
            session.flow.pages.all().order_by("module_order", "id")
        )
        page_total = len(flow_pages) or 1
        for index, page in enumerate(flow_pages):
            if page.id == session.id:
                page_number = index + 1
                previous_page = flow_pages[index - 1] if index > 0 else None
                next_page = flow_pages[index + 1] if index + 1 < len(flow_pages) else None
                break

    return render(request, "boardly/stage_board.html", {
        "session": session,
        "join_url": _join_url(request, session),
        "logo_url": getattr(session.owner, "logo_url", None)
        if session.owner_id else None,
        "flow_pages": flow_pages,
        "previous_page": previous_page,
        "next_page": next_page,
        "page_number": page_number,
        "page_total": page_total,
        "can_edit_board": request.user.is_authenticated and session.owner_id == request.user.id,
    })


@login_required
def board_create(request):
    """Create one board or a linked PDF-style board flow."""
    if request.method == "POST":
        mode = request.POST.get("mode", "open")
        layout = request.POST.get("layout", "grid")
        limit = _safe_limit(request.POST.get("per_participant_limit", "0"))
        lock_columns = bool(request.POST.get("lock_columns"))
        template_key = request.POST.get("template_key", "blank")
        project_name = (
            request.POST.get("project_name", "").strip()
            or request.POST.get("title", "").strip()
            or "Board Project"
        )[:120]
        custom_groups = _split_groups(request.POST.get("groups", ""))
        create_linked_flow = bool(request.POST.get("create_linked_flow"))
        background_image = request.FILES.get("background_image")

        if template_key in BOARD_TEMPLATES and create_linked_flow:
            template = BOARD_TEMPLATES[template_key]
            flow = BoardFlow.objects.create(
                owner=request.user,
                name=project_name,
                template_key=template_key,
                description=template.get("description", "")[:240],
            )

            first_session = None
            for i, module in enumerate(template["modules"]):
                session = _create_session_from_module(
                    request=request,
                    flow=flow,
                    template_key=template_key,
                    project_name=project_name,
                    module=module,
                    module_order=i,
                    mode=mode,
                    layout=layout,
                    per_participant_limit=limit,
                    lock_columns=lock_columns,
                    # If the user entered manual groups, apply them to every
                    # generated page; otherwise use each template's columns.
                    group_override=custom_groups or None,
                    background_image=background_image,
                )
                if first_session is None:
                    first_session = session

            messages.success(
                request,
                f"Created {len(template['modules'])} linked pages for “{project_name}”.",
            )
            return redirect("boardly:stage", code=first_session.code)

        # Blank/custom single board, or template selected without linked flow.
        if template_key in BOARD_TEMPLATES:
            module = BOARD_TEMPLATES[template_key]["modules"][0]
            title = _make_module_title(module["label"], project_name)
            prompt = module["prompt"].format(project=project_name)[:200]
            groups = custom_groups or module.get("columns", [])
            module_key = module["key"]
            module_label = module["label"]
            module_description = module.get("description", "")[:240]
        else:
            title = request.POST.get("title", "Idea Board")[:140] or "Idea Board"
            prompt = request.POST.get("prompt", "Share your idea")[:200]
            groups = custom_groups
            module_key = ""
            module_label = ""
            module_description = ""

        session = BoardSession.objects.create(
            owner=request.user,
            title=title,
            prompt=prompt,
            mode=mode,
            layout=layout,
            background_image=background_image,
            per_participant_limit=limit,
            lock_columns=lock_columns,
            state="open",
            template_key=template_key if template_key != "blank" else "custom",
            module_key=module_key,
            module_label=module_label,
            module_order=0,
            module_description=module_description,
        )
        _seed_groups(session, groups)
        return redirect("boardly:stage", code=session.code)

    template_cards = [
        {"key": key, **value, "page_count": len(value["modules"])}
        for key, value in BOARD_TEMPLATES.items()
    ]
    return render(request, "boardly/create_board.html", {
        "template_cards": template_cards,
    })


@login_required
def board_list(request):
    """All boards owned by the current user — grouped by linked flows."""
    flows = (
        BoardFlow.objects
        .filter(owner=request.user)
        .prefetch_related("pages")
        .order_by("-created_at")
    )

    flow_cards = []
    for flow in flows:
        pages = list(
            flow.pages.all()
            .annotate(note_total=Count("notes"))
            .order_by("module_order", "id")
        )
        if not pages:
            continue
        flow_cards.append({
            "flow": flow,
            "pages": pages,
            "first_page": pages[0],
            "page_count": len(pages),
            "notes_total": sum(getattr(page, "note_total", 0) for page in pages),
        })

    boards = (
        BoardSession.objects
        .filter(owner=request.user, flow__isnull=True)
        .annotate(note_total=Count("notes"))
        .order_by("-created_at")
    )
    return render(request, "boardly/board_list.html", {
        "flow_cards": flow_cards,
        "boards": boards,
        "boards_total": boards.count() + len(flow_cards),
    })


@login_required
@require_POST
def board_columns_reorder(request, code):
    """Persist presenter drag-and-drop column ordering for one board."""
    session = get_object_or_404(
        BoardSession, code=code.upper(), owner=request.user,
    )
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {}

    raw_order = payload.get("order") or request.POST.getlist("order[]")
    try:
        ordered_ids = [int(x) for x in raw_order]
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "Invalid column order."}, status=400)

    existing = {g.id: g for g in session.groups.all()}
    # Keep only ids that belong to this board, preserving the client order.
    clean_order = [gid for gid in ordered_ids if gid in existing]
    if not clean_order:
        return JsonResponse({"ok": False, "error": "No matching columns found."}, status=400)

    # Append any missing columns so a stale client cannot accidentally hide them.
    for gid in sorted(existing, key=lambda pk: existing[pk].position):
        if gid not in clean_order:
            clean_order.append(gid)

    for pos, gid in enumerate(clean_order):
        group = existing[gid]
        if group.position != pos:
            group.position = pos
            group.save(update_fields=["position"])

    return JsonResponse({
        "ok": True,
        "groups": [
            {"id": gid, "name": existing[gid].name, "position": pos}
            for pos, gid in enumerate(clean_order)
        ],
    })


@login_required
@require_POST
def board_background(request, code):
    """Upload or clear the photo background for a board page."""
    session = get_object_or_404(
        BoardSession.objects.select_related("flow"),
        code=code.upper(),
        owner=request.user,
    )
    apply_to_flow = bool(request.POST.get("apply_to_flow")) and session.flow_id
    targets = list(session.flow.pages.all()) if apply_to_flow else [session]

    if request.POST.get("action") == "clear":
        for target in targets:
            if target.background_image:
                target.background_image.delete(save=False)
            target.background_image = None
            target.save(update_fields=["background_image", "updated_at"])
        messages.success(request, "Board background removed.")
        return redirect("boardly:stage", code=session.code)

    uploaded = request.FILES.get("background_image")
    if not uploaded:
        messages.error(request, "Please select a photo to use as the board background.")
        return redirect("boardly:stage", code=session.code)

    # If applying one upload across all pages, copy the bytes so every page
    # gets its own saved image reference and the uploaded stream is not reused.
    data = uploaded.read()
    for target in targets:
        if target.background_image:
            target.background_image.delete(save=False)
        target.background_image.save(uploaded.name, ContentFile(data), save=False)
        target.save(update_fields=["background_image", "updated_at"])

    messages.success(
        request,
        "Board background updated for the whole flow." if apply_to_flow else "Board background updated.",
    )
    return redirect("boardly:stage", code=session.code)


@login_required
@require_POST
def board_delete(request, code):
    """Delete a board the current user owns, then return to `next`."""
    session = get_object_or_404(
        BoardSession, code=code.upper(), owner=request.user,
    )
    flow = session.flow
    title = session.title
    session.delete()

    if flow and not flow.pages.exists():
        flow.delete()

    messages.success(request, f"Deleted “{title}”.")
    nxt = request.POST.get("next") or request.GET.get("next")
    return redirect(nxt or reverse("boardly:list"))
