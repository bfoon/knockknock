"""
boardly/views.py — HTTP views for the Boardly board.

Adds PDF-style linked board flows: one project can generate multiple
BoardSession pages/modules from a default template, then the presenter
moves through them with Previous / Next navigation.
"""

import json

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile
from django.db.models import Count, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from .models import (
    BoardCollaborator,
    BoardFlow,
    BoardGroup,
    BoardMessage,
    BoardSession,
)


# Each template carries a visual ``style`` key (consumed by the stage as a
# CSS class kk-board-template-<key> / data-style) plus per-module columns.
# A column may be a plain string (neutral styling) OR a dict
# {name, icon, color}; _normalize_columns handles both. Icons are
# Bootstrap-Icons names (without the bi- prefix); colours are the named
# tokens defined on BoardGroup.COLOR_CHOICES.
#
# To keep the definitions short, _col() builds the styled column dicts.
def _col(name, icon="none", color="slate"):
    return {"name": name, "icon": icon, "color": color}


BOARD_TEMPLATES = {
    "innovation": {
        "name": "Innovation Lab",
        "icon": "bi-lightbulb",
        "style": "aurora",
        "accent": "#6366f1",
        "description": "Explore the problem, create solutions, then evaluate what can work.",
        "modules": [
            {
                "key": "explore", "label": "EXPLORE",
                "prompt": "What do we know about {project}? Add facts, users, pain points and opportunities.",
                "description": "Understand the context before jumping into solutions.",
                "columns": [
                    _col("Pain Points", "exclamation-triangle", "rose"),
                    _col("Users", "people", "sky"),
                    _col("Opportunities", "lightbulb", "amber"),
                    _col("Evidence", "shield-check", "violet"),
                ],
            },
            {
                "key": "create", "label": "CREATE",
                "prompt": "What solutions, concepts or prototypes can move {project} forward?",
                "description": "Generate many possible solutions and design directions.",
                "columns": [
                    _col("Ideas", "lightbulb", "amber"),
                    _col("Concepts", "diagram-3", "sky"),
                    _col("Prototype", "rocket-takeoff", "violet"),
                    _col("Support Needed", "people", "teal"),
                ],
            },
            {
                "key": "evaluate", "label": "EVALUATE",
                "prompt": "Which ideas for {project} are feasible, valuable and ready for action?",
                "description": "Compare options and decide what should move forward.",
                "columns": [
                    _col("Impact", "graph-up-arrow", "green"),
                    _col("Feasibility", "bullseye", "sky"),
                    _col("Risks", "exclamation-triangle", "rose"),
                    _col("Next Actions", "flag", "indigo"),
                ],
            },
        ],
    },
    "ideation": {
        "name": "Ideation Sprint",
        "icon": "bi-stars",
        "style": "sunrise",
        "accent": "#f59e0b",
        "description": "Move from challenge framing to idea generation and prioritisation.",
        "modules": [
            {
                "key": "challenge", "label": "CHALLENGE",
                "prompt": "What challenge are we solving in {project}?",
                "description": "Frame the problem clearly.",
                "columns": [
                    _col("Problem", "exclamation-triangle", "rose"),
                    _col("Who Is Affected", "people", "sky"),
                    _col("Why It Matters", "heart", "pink"),
                    _col("Constraints", "gear", "slate"),
                ],
            },
            {
                "key": "ideas", "label": "IDEAS",
                "prompt": "What ideas can solve or improve {project}?",
                "description": "Collect many ideas without judging too early.",
                "columns": [
                    _col("Quick Wins", "clipboard-check", "green"),
                    _col("Bold Ideas", "rocket-takeoff", "orange"),
                    _col("Digital Ideas", "lightbulb", "sky"),
                    _col("Partnerships", "people", "violet"),
                ],
            },
            {
                "key": "prioritize", "label": "PRIORITIZE",
                "prompt": "Which ideas for {project} should be selected first?",
                "description": "Rank the ideas and agree on what to do next.",
                "columns": [
                    _col("High Impact", "graph-up-arrow", "green"),
                    _col("Low Effort", "bullseye", "amber"),
                    _col("Needs Budget", "cash-coin", "rose"),
                    _col("Selected", "star", "indigo"),
                ],
            },
        ],
    },
    "logistics": {
        "name": "Logistics Flow",
        "icon": "bi-truck",
        "style": "blueprint",
        "accent": "#0ea5e9",
        "description": "Map movement, bottlenecks, resources and operational actions.",
        "modules": [
            {
                "key": "map", "label": "MAP",
                "prompt": "How does logistics currently move for {project}?",
                "description": "Capture the real movement flow.",
                "columns": [
                    _col("Origin", "flag", "teal"),
                    _col("Storage", "gear", "slate"),
                    _col("Transport", "truck", "sky"),
                    _col("Destination", "bullseye", "indigo"),
                ],
            },
            {
                "key": "bottlenecks", "label": "BOTTLENECKS",
                "prompt": "Where are the delays, costs or risks in {project}?",
                "description": "Identify the weak points in the logistics chain.",
                "columns": [
                    _col("Delays", "exclamation-triangle", "amber"),
                    _col("Cost Drivers", "cash-coin", "rose"),
                    _col("Risks", "shield-check", "orange"),
                    _col("Missing Resources", "gear", "slate"),
                ],
            },
            {
                "key": "optimize", "label": "OPTIMIZE",
                "prompt": "What improvements can make {project} logistics faster and safer?",
                "description": "Design practical improvements.",
                "columns": [
                    _col("Route Fixes", "diagram-3", "sky"),
                    _col("Warehouse Fixes", "gear", "teal"),
                    _col("People/Tools", "people", "violet"),
                    _col("Action Plan", "clipboard-check", "green"),
                ],
            },
        ],
    },
    "business": {
        "name": "Business Design",
        "icon": "bi-briefcase",
        "style": "boardroom",
        "accent": "#0f766e",
        "description": "Develop the model, market, operations and finance view.",
        "modules": [
            {
                "key": "model", "label": "MODEL",
                "prompt": "What is the business model for {project}?",
                "description": "Clarify how the business creates and captures value.",
                "columns": [
                    _col("Customers", "people", "sky"),
                    _col("Value Offer", "gem", "violet"),
                    _col("Channels", "diagram-3", "teal"),
                    _col("Revenue", "cash-coin", "green"),
                ],
            },
            {
                "key": "market", "label": "MARKET",
                "prompt": "What does the market need from {project}?",
                "description": "Understand customers, competitors and demand.",
                "columns": [
                    _col("Customer Needs", "heart", "pink"),
                    _col("Competitors", "shield-check", "rose"),
                    _col("Pricing", "cash-coin", "amber"),
                    _col("Demand Signals", "graph-up-arrow", "green"),
                ],
            },
            {
                "key": "operations", "label": "OPERATIONS",
                "prompt": "What people, tools and processes does {project} need?",
                "description": "Design the operating plan.",
                "columns": [
                    _col("Team", "people", "sky"),
                    _col("Systems", "gear", "slate"),
                    _col("Suppliers", "truck", "teal"),
                    _col("Risks", "exclamation-triangle", "orange"),
                ],
            },
            {
                "key": "finance", "label": "FINANCE",
                "prompt": "What costs, revenue and funding does {project} require?",
                "description": "Build the financial view.",
                "columns": [
                    _col("Startup Cost", "cash-coin", "rose"),
                    _col("Monthly Cost", "cash-coin", "amber"),
                    _col("Revenue", "graph-up-arrow", "green"),
                    _col("Funding", "gem", "indigo"),
                ],
            },
        ],
    },
    "value_chain": {
        "name": "Value Chain",
        "icon": "bi-diagram-3",
        "style": "harvest",
        "accent": "#65a30d",
        "description": "Map inputs, production, processing, market and value capture.",
        "modules": [
            {
                "key": "inputs", "label": "INPUTS",
                "prompt": "What inputs and resources are needed for {project}?",
                "description": "Capture what must enter the chain.",
                "columns": [
                    _col("Materials", "gear", "slate"),
                    _col("People", "people", "sky"),
                    _col("Finance", "cash-coin", "green"),
                    _col("Information", "lightbulb", "amber"),
                ],
            },
            {
                "key": "production", "label": "PRODUCTION",
                "prompt": "How is value created during production for {project}?",
                "description": "Understand the production stage.",
                "columns": [
                    _col("Activities", "clipboard-check", "teal"),
                    _col("Tools", "gear", "slate"),
                    _col("Quality", "shield-check", "violet"),
                    _col("Challenges", "exclamation-triangle", "rose"),
                ],
            },
            {
                "key": "processing", "label": "PROCESSING",
                "prompt": "How is {project} transformed, packaged or improved?",
                "description": "Map processing and value addition.",
                "columns": [
                    _col("Processing", "gear", "sky"),
                    _col("Packaging", "gem", "violet"),
                    _col("Standards", "shield-check", "indigo"),
                    _col("Waste/Loss", "exclamation-triangle", "orange"),
                ],
            },
            {
                "key": "market", "label": "MARKET",
                "prompt": "How does {project} reach buyers and users?",
                "description": "Map access to market.",
                "columns": [
                    _col("Buyers", "people", "sky"),
                    _col("Channels", "diagram-3", "teal"),
                    _col("Pricing", "cash-coin", "amber"),
                    _col("Promotion", "star", "pink"),
                ],
            },
            {
                "key": "capture", "label": "VALUE CAPTURE",
                "prompt": "Where is value captured or lost in {project}?",
                "description": "Identify who benefits and where improvement is needed.",
                "columns": [
                    _col("Margins", "graph-up-arrow", "green"),
                    _col("Leakages", "exclamation-triangle", "rose"),
                    _col("Power Gaps", "shield-check", "orange"),
                    _col("Improvement", "flag", "indigo"),
                ],
            },
        ],
    },
    "design_thinking": {
        "name": "Design Thinking",
        "icon": "bi-pencil-square",
        "style": "studio",
        "accent": "#db2777",
        "description": "The classic five-stage human-centred design journey.",
        "modules": [
            {
                "key": "empathize", "label": "EMPATHIZE",
                "prompt": "Who are we designing {project} for, and what do they experience?",
                "description": "Build deep understanding of real people.",
                "columns": [
                    _col("People", "people", "sky"),
                    _col("Needs", "heart", "pink"),
                    _col("Pains", "exclamation-triangle", "rose"),
                    _col("Quotes", "chat-dots", "violet"),
                ],
            },
            {
                "key": "define", "label": "DEFINE",
                "prompt": "What is the core problem in {project} worth solving?",
                "description": "Sharpen the problem into a clear statement.",
                "columns": [
                    _col("Insights", "lightbulb", "amber"),
                    _col("Problem Statement", "bullseye", "indigo"),
                    _col("Success Looks Like", "star", "green"),
                ],
            },
            {
                "key": "ideate", "label": "IDEATE",
                "prompt": "How might we solve {project}? Go wide.",
                "description": "Diverge — many ideas, no judging yet.",
                "columns": [
                    _col("Wild Ideas", "rocket-takeoff", "orange"),
                    _col("Practical Ideas", "clipboard-check", "teal"),
                    _col("Combine & Build", "diagram-3", "violet"),
                ],
            },
            {
                "key": "prototype", "label": "PROTOTYPE",
                "prompt": "What can we build to make {project} tangible?",
                "description": "Make ideas real enough to test.",
                "columns": [
                    _col("Sketches", "lightbulb", "sky"),
                    _col("Mockups", "gem", "violet"),
                    _col("What To Test", "bullseye", "amber"),
                ],
            },
            {
                "key": "test", "label": "TEST",
                "prompt": "What did people think of the {project} prototype?",
                "description": "Learn from real feedback.",
                "columns": [
                    _col("What Worked", "clipboard-check", "green"),
                    _col("What Failed", "exclamation-triangle", "rose"),
                    _col("Next Iteration", "flag", "indigo"),
                ],
            },
        ],
    },
    "retro": {
        "name": "Team Retrospective",
        "icon": "bi-arrow-repeat",
        "style": "calm",
        "accent": "#0d9488",
        "description": "Reflect on how the team is working and agree improvements.",
        "modules": [
            {
                "key": "reflect", "label": "REFLECT",
                "prompt": "Looking back at {project}, what should we keep, drop or change?",
                "description": "An honest, blameless look back.",
                "columns": [
                    _col("Start", "rocket-takeoff", "green"),
                    _col("Stop", "exclamation-triangle", "rose"),
                    _col("Continue", "clipboard-check", "sky"),
                    _col("Appreciations", "heart", "pink"),
                ],
            },
            {
                "key": "actions", "label": "ACTIONS",
                "prompt": "What will the team actually do differently on {project}?",
                "description": "Turn reflection into owned commitments.",
                "columns": [
                    _col("Action", "flag", "indigo"),
                    _col("Owner", "people", "violet"),
                    _col("By When", "bullseye", "amber"),
                ],
            },
        ],
    },
    "swot": {
        "name": "SWOT Analysis",
        "icon": "bi-grid-3x3",
        "style": "quadrant",
        "accent": "#7c3aed",
        "description": "Weigh internal strengths and weaknesses against external forces.",
        "modules": [
            {
                "key": "swot", "label": "SWOT",
                "prompt": "What are the strengths, weaknesses, opportunities and threats for {project}?",
                "description": "Map the four quadrants together.",
                "columns": [
                    _col("Strengths", "graph-up-arrow", "green"),
                    _col("Weaknesses", "exclamation-triangle", "rose"),
                    _col("Opportunities", "lightbulb", "amber"),
                    _col("Threats", "shield-check", "orange"),
                ],
            },
            {
                "key": "strategy", "label": "STRATEGY",
                "prompt": "Given the SWOT, what should {project} do?",
                "description": "Turn the analysis into moves.",
                "columns": [
                    _col("Build On", "star", "green"),
                    _col("Fix", "gear", "rose"),
                    _col("Pursue", "rocket-takeoff", "indigo"),
                    _col("Defend", "shield-check", "violet"),
                ],
            },
        ],
    },
    "okr": {
        "name": "Goals & OKRs",
        "icon": "bi-bullseye",
        "style": "focus",
        "accent": "#2563eb",
        "description": "Set ambitious objectives and the key results that prove progress.",
        "modules": [
            {
                "key": "objectives", "label": "OBJECTIVES",
                "prompt": "What do we want to achieve with {project} this cycle?",
                "description": "Ambitious, qualitative goals.",
                "columns": [
                    _col("Objectives", "bullseye", "indigo"),
                    _col("Why It Matters", "heart", "pink"),
                    _col("Owners", "people", "sky"),
                ],
            },
            {
                "key": "results", "label": "KEY RESULTS",
                "prompt": "How will we measure progress on {project}?",
                "description": "Concrete, measurable outcomes.",
                "columns": [
                    _col("Metrics", "graph-up-arrow", "green"),
                    _col("Targets", "flag", "amber"),
                    _col("Risks", "exclamation-triangle", "rose"),
                ],
            },
            {
                "key": "checkin", "label": "CHECK-IN",
                "prompt": "Where does {project} stand right now?",
                "description": "Track and adjust mid-cycle.",
                "columns": [
                    _col("On Track", "clipboard-check", "green"),
                    _col("At Risk", "exclamation-triangle", "amber"),
                    _col("Blocked", "shield-check", "rose"),
                ],
            },
        ],
    },
    "research": {
        "name": "Research & Synthesis",
        "icon": "bi-search",
        "style": "scholar",
        "accent": "#475569",
        "description": "Gather findings, cluster patterns and draw conclusions.",
        "modules": [
            {
                "key": "gather", "label": "GATHER",
                "prompt": "What have we found out about {project}?",
                "description": "Raw observations and data points.",
                "columns": [
                    _col("Interviews", "chat-dots", "sky"),
                    _col("Data", "graph-up-arrow", "violet"),
                    _col("Desk Research", "shield-check", "slate"),
                    _col("Surprises", "lightbulb", "amber"),
                ],
            },
            {
                "key": "synthesize", "label": "SYNTHESIZE",
                "prompt": "What patterns and themes emerge for {project}?",
                "description": "Cluster findings into meaning.",
                "columns": [
                    _col("Themes", "diagram-3", "indigo"),
                    _col("Tensions", "exclamation-triangle", "rose"),
                    _col("Implications", "flag", "teal"),
                ],
            },
            {
                "key": "conclude", "label": "CONCLUDE",
                "prompt": "What do we now believe and recommend for {project}?",
                "description": "Land the so-what.",
                "columns": [
                    _col("Findings", "clipboard-check", "green"),
                    _col("Recommendations", "star", "indigo"),
                    _col("Open Questions", "chat-dots", "amber"),
                ],
            },
        ],
    },
    "event": {
        "name": "Event Planning",
        "icon": "bi-calendar-event",
        "style": "festive",
        "accent": "#e11d48",
        "description": "Plan an event end-to-end, from concept to run-of-show.",
        "modules": [
            {
                "key": "concept", "label": "CONCEPT",
                "prompt": "What is the {project} event and who is it for?",
                "description": "Shape the purpose and audience.",
                "columns": [
                    _col("Goal", "bullseye", "indigo"),
                    _col("Audience", "people", "sky"),
                    _col("Theme", "star", "pink"),
                    _col("Budget", "cash-coin", "green"),
                ],
            },
            {
                "key": "logistics", "label": "LOGISTICS",
                "prompt": "What needs to be arranged for {project}?",
                "description": "Venue, suppliers and timing.",
                "columns": [
                    _col("Venue", "flag", "teal"),
                    _col("Suppliers", "truck", "amber"),
                    _col("Schedule", "clipboard-check", "sky"),
                    _col("Risks", "exclamation-triangle", "rose"),
                ],
            },
            {
                "key": "promo", "label": "PROMOTION",
                "prompt": "How will people hear about {project}?",
                "description": "Get the word out.",
                "columns": [
                    _col("Channels", "diagram-3", "violet"),
                    _col("Messages", "chat-dots", "pink"),
                    _col("Partners", "people", "teal"),
                ],
            },
        ],
    },
    "lean_canvas": {
        "name": "Lean Startup Canvas",
        "icon": "bi-rocket-takeoff",
        "style": "neon",
        "accent": "#9333ea",
        "description": "Pressure-test a new venture across problem, solution and economics.",
        "modules": [
            {
                "key": "problem", "label": "PROBLEM",
                "prompt": "What problem does {project} solve, and for whom?",
                "description": "Validate the pain is real.",
                "columns": [
                    _col("Problem", "exclamation-triangle", "rose"),
                    _col("Customer Segments", "people", "sky"),
                    _col("Existing Alternatives", "shield-check", "slate"),
                ],
            },
            {
                "key": "solution", "label": "SOLUTION",
                "prompt": "How does {project} solve it uniquely?",
                "description": "Solution and unfair advantage.",
                "columns": [
                    _col("Solution", "lightbulb", "amber"),
                    _col("Unique Value", "gem", "violet"),
                    _col("Unfair Advantage", "star", "indigo"),
                ],
            },
            {
                "key": "economics", "label": "ECONOMICS",
                "prompt": "How does {project} make money and reach people?",
                "description": "Channels, revenue and cost.",
                "columns": [
                    _col("Channels", "diagram-3", "teal"),
                    _col("Revenue", "cash-coin", "green"),
                    _col("Costs", "cash-coin", "rose"),
                    _col("Key Metrics", "graph-up-arrow", "sky"),
                ],
            },
        ],
    },

    # ── Climate Action ──────────────────────────────────────────────────
    # A ready-made, fully-designed board that mirrors the Explore → Create
    # → Evaluate flow. The "climate" style paints a soft sky-and-meadow
    # backdrop so the board looks finished the moment it opens — no photo
    # upload needed.
    "climate": {
        "name": "Climate Action",
        "icon": "bi-globe-americas",
        "style": "climate",
        "accent": "#16a34a",
        "description": "Rally a team around a sustainability challenge — from pain points to real actions.",
        "modules": [
            {
                "key": "explore", "label": "EXPLORE",
                "prompt": "What do we know about {project}? Add pain points, communities, ideas and evidence.",
                "description": "Understand the challenge.",
                "columns": [
                    _col("Pain Points", "exclamation-triangle", "rose"),
                    _col("Communities", "people", "teal"),
                    _col("Ideas", "lightbulb", "sky"),
                    _col("Evidence", "shield-check", "violet"),
                    _col("Actions", "flag", "green"),
                ],
            },
            {
                "key": "create", "label": "CREATE",
                "prompt": "What bold solutions could move {project} forward?",
                "description": "Generate bold solutions.",
                "columns": [
                    _col("Quick Wins", "rocket-takeoff", "amber"),
                    _col("Big Bets", "star", "violet"),
                    _col("Partners", "people", "teal"),
                    _col("Resources", "gem", "sky"),
                ],
            },
            {
                "key": "evaluate", "label": "EVALUATE",
                "prompt": "Which actions for {project} have the most impact and are most feasible?",
                "description": "Prioritise impact & feasibility.",
                "columns": [
                    _col("High Impact", "graph-up-arrow", "green"),
                    _col("Feasible Now", "bullseye", "sky"),
                    _col("Needs Funding", "cash-coin", "amber"),
                    _col("Commit To", "flag", "indigo"),
                ],
            },
        ],
    },

    # ── Inspiration Wall (free / anonymous message board) ────────────────
    # A column-free board: participants post a message that lands on the
    # wall with its date and NO name — everyone is anonymous. The "wall"
    # style is what the play + stage screens read to switch out of
    # sticky-note mode. Empty ``columns`` means no groups are seeded.
    "inspiration": {
        "name": "Inspiration Wall",
        "icon": "bi-chat-quote",
        "style": "wall",
        "accent": "#0ea5e9",
        "description": "A free, anonymous wall — people post a message and it appears with the date. No sticky notes, no names.",
        "modules": [
            {
                "key": "wall", "label": "WALL",
                "prompt": "Share an inspiring message, a thought, or a thank-you…",
                "description": "Anonymous messages with the date — no names.",
                "columns": [],
            },
        ],
    },
}


_AVATAR_PALETTE = [
    "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9",
    "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#3b82f6",
]


def _display_name(user):
    """Best human-readable name for a user."""
    if not user:
        return "Someone"
    full = (getattr(user, "get_full_name", lambda: "")() or "").strip()
    return full or getattr(user, "username", None) or getattr(user, "email", "") or "Someone"


def _initials(name):
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _avatar_for(user, is_owner=False):
    """A presentable avatar dict: photo URL if any, else initials + colour."""
    name = _display_name(user)
    # Try a few common profile-photo attribute names without hard-coding
    # your user model; falls back to initials when none resolve.
    photo = None
    for attr in ("avatar_url", "photo_url", "profile_image_url", "logo_url"):
        val = getattr(user, attr, None)
        if val:
            photo = str(val)
            break
    uid = getattr(user, "id", 0) or 0
    return {
        "id": uid,
        "name": name,
        "initials": _initials(name),
        "photo": photo,
        "color": _AVATAR_PALETTE[uid % len(_AVATAR_PALETTE)],
        "is_owner": bool(is_owner),
    }


def _collaborators_for(session):
    """
    Ordered avatar list for a board: owner first (flagged), then invited
    collaborators. Collaborators are scoped to the flow when the board is
    part of one, else to the single session.
    """
    out = []
    seen = set()
    if session.owner_id:
        out.append(_avatar_for(session.owner, is_owner=True))
        seen.add(session.owner_id)

    qs = BoardCollaborator.objects.select_related("user")
    if session.flow_id:
        qs = qs.filter(flow_id=session.flow_id)
    else:
        qs = qs.filter(session_id=session.id)
    for collab in qs:
        if collab.user_id in seen:
            continue
        seen.add(collab.user_id)
        out.append(_avatar_for(collab.user, is_owner=False))
    return out


def _join_url(request, session):
    """Absolute URL a phone hits when it scans the QR code."""
    return request.build_absolute_uri(f"/board/{session.code}/")


def _split_groups(raw):
    """
    Return clean column specs from a comma-separated string.

    Each entry may carry an optional icon/colour using a compact inline
    syntax so the create form's single text field still works:

        "Keep, Start, Stop"                      → names only
        "Keep|star|green, Start|rocket|amber"    → name|icon|colour

    Always returns a list of dicts {name, icon, colour}; missing pieces
    fall back to the neutral default so a bare name behaves as before.
    """
    specs = []
    for chunk in (raw or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split("|")]
        name = parts[0][:60]
        if not name:
            continue
        icon = parts[1] if len(parts) > 1 and parts[1] else "none"
        color = parts[2] if len(parts) > 2 and parts[2] else "slate"
        specs.append({"name": name, "icon": icon[:30], "color": color[:12]})
    return specs


def _normalize_columns(columns):
    """
    Accept a template's ``columns`` (list of str or dict) and return a
    uniform list of {name, icon, colour} dicts. Plain strings get the
    neutral default styling so older/blank templates still work.
    """
    out = []
    for col in columns or []:
        if isinstance(col, dict):
            out.append({
                "name": str(col.get("name", ""))[:60],
                "icon": str(col.get("icon", "none"))[:30] or "none",
                "color": str(col.get("color", "slate"))[:12] or "slate",
            })
        else:
            out.append({"name": str(col)[:60], "icon": "none", "color": "slate"})
    return [c for c in out if c["name"]]


def _seed_groups(session, columns):
    """Create styled topic columns for a board session."""
    for i, col in enumerate(_normalize_columns(columns)):
        BoardGroup.objects.create(
            session=session,
            name=col["name"],
            icon=col["icon"],
            color=col["color"],
            position=i,
        )


def _safe_limit(value):
    try:
        limit = int(value or 0)
    except (TypeError, ValueError):
        limit = 0
    return max(0, min(limit, 999))


def _make_module_title(module_label, project_name):
    # Matches the user's requested PDF/page naming:
    # EXPLORE-MODULE PROJECT NAME, CREATE-MODULE PROJECT NAME, etc.
    # The free message wall isn't a "module", so it gets a plain title.
    if (module_label or "").upper() == "WALL":
        return (project_name or "Inspiration Wall")[:140]
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
    # Resolve the template style so the phone screen can theme itself and,
    # for the "wall" style, switch into anonymous message-wall mode (no
    # nickname, no colour/icon pickers — just a message + date).
    tmpl = BOARD_TEMPLATES.get(session.template_key, {})
    board_style = tmpl.get("style", "custom")
    board_format = "wall" if board_style == "wall" else "sticky"
    return render(request, "boardly/play_board.html", {
        "session": session,
        "board_style": board_style,
        "board_format": board_format,
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

    # Resolve the template's visual style + accent (used to theme the
    # stage). Falls back to a neutral style for blank/custom boards.
    tmpl = BOARD_TEMPLATES.get(session.template_key, {})
    board_style = tmpl.get("style", "custom")
    board_accent = tmpl.get("accent", "")

    # Collaborators (logged-in teammates) for the avatar rail + chat. The
    # owner is always shown first and distinctly; invited collaborators
    # follow. Anonymous participants are NOT listed here — they show only
    # as the live "online" count.
    collaborators = _collaborators_for(session)
    me = request.user if request.user.is_authenticated else None

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
        "board_style": board_style,
        "board_accent": board_accent,
        "collaborators": collaborators,
        "me": me,
        "me_is_owner": bool(me and session.owner_id == me.id),
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


# ════════════════════════════════════════════════════════════════════
#  Collaborator management — invite logged-in teammates to co-run a board
#  (flow-scoped when the board is part of a flow, else session-scoped).
#  Only the board owner may view or change the collaborator list.
# ════════════════════════════════════════════════════════════════════

def _owned_session(request, code):
    """Fetch a board the current user owns, or 404/redirect upstream."""
    return get_object_or_404(
        BoardSession.objects.select_related("flow", "owner"),
        code=code.upper(),
        owner=request.user,
    )


@login_required
def board_collaborators(request, code):
    """Owner-only page: list collaborators and the invite form."""
    session = _owned_session(request, code)

    if session.flow_id:
        collaborators = BoardCollaborator.objects.select_related(
            "user", "invited_by").filter(flow_id=session.flow_id)
    else:
        collaborators = BoardCollaborator.objects.select_related(
            "user", "invited_by").filter(session_id=session.id)

    rows = []
    for c in collaborators:
        av = _avatar_for(c.user, is_owner=False)
        rows.append({"obj": c, "avatar": av, "role": c.get_role_display()})

    return render(request, "boardly/collaborators.html", {
        "session": session,
        "owner_avatar": _avatar_for(session.owner, is_owner=True),
        "collaborators": rows,
        "is_flow": bool(session.flow_id),
        "scope_label": session.flow.name if session.flow_id else session.title,
    })


@login_required
@require_POST
def board_collaborator_add(request, code):
    """
    Owner-only: invite a user by username or email.

    The query is matched case-insensitively against username/email. The
    owner can't add themselves, and a user already invited is reported as
    such rather than duplicated (the model's unique constraint also guards
    this at the DB level).
    """
    session = _owned_session(request, code)
    query = (request.POST.get("identifier") or "").strip()
    role = request.POST.get("role", "editor")
    if role not in {"editor", "viewer"}:
        role = "editor"

    if not query:
        messages.error(request, "Enter a username or email to invite.")
        return redirect("boardly:collaborators", code=session.code)

    User = get_user_model()
    user = (
        User.objects
        .filter(Q(username__iexact=query) | Q(email__iexact=query))
        .first()
    )
    if user is None:
        messages.error(request, f"No user found matching “{query}”.")
        return redirect("boardly:collaborators", code=session.code)

    if user.id == session.owner_id:
        messages.info(request, "You're the owner — you're already on every page.")
        return redirect("boardly:collaborators", code=session.code)

    scope = {"flow": session.flow} if session.flow_id else {"session": session}
    existing = BoardCollaborator.objects.filter(
        user=user,
        **({"flow_id": session.flow_id} if session.flow_id else {"session_id": session.id}),
    ).first()
    if existing:
        if existing.role != role:
            existing.role = role
            existing.save(update_fields=["role"])
            messages.success(request, f"Updated {_display_name(user)}'s role.")
        else:
            messages.info(request, f"{_display_name(user)} is already a collaborator.")
        return redirect("boardly:collaborators", code=session.code)

    BoardCollaborator.objects.create(
        user=user, role=role, invited_by=request.user, **scope,
    )
    messages.success(
        request,
        f"Added {_display_name(user)} as a collaborator"
        + (" on this whole flow." if session.flow_id else "."),
    )
    return redirect("boardly:collaborators", code=session.code)


@login_required
@require_POST
def board_collaborator_remove(request, code, collab_id):
    """Owner-only: remove a collaborator from this board / flow."""
    session = _owned_session(request, code)
    collab = get_object_or_404(
        BoardCollaborator,
        id=collab_id,
        **({"flow_id": session.flow_id} if session.flow_id else {"session_id": session.id}),
    )
    name = _display_name(collab.user)
    collab.delete()
    messages.success(request, f"Removed {name} from collaborators.")
    return redirect("boardly:collaborators", code=session.code)