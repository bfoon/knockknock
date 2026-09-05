"""Template helpers for the attendance app."""

import json

from django import template
from django.utils.safestring import mark_safe

from ..models import AGENDA_TEMPLATE_KEYS, DEFAULT_AGENDA_TEMPLATE

register = template.Library()

_STYLE_DIR = "attendance/_agenda_styles"


@register.filter
def agenda_style_path(key):
    """Resolve an agenda template key to its partial path.

    Replaces the ten-branch if/elif chain that _agenda.html carried twice.

    The key comes from a `CharField(max_length=32)`, so it is whatever was
    last written to that row — not necessarily one of the ten. Building a
    template path out of it unchecked would let a bad value reach
    `{% include %}`, so anything not in AGENDA_TEMPLATE_KEYS falls back to
    the default, exactly as the old `{% else %}` branch did.
    """
    key = (key or "").strip()
    if key not in AGENDA_TEMPLATE_KEYS:
        key = DEFAULT_AGENDA_TEMPLATE
    return f"{_STYLE_DIR}/{key}.html"


@register.filter
def jsonattr(value):
    """Serialise a value for a data-* attribute so JS can JSON.parse it.

    `{{ field.options|escape }}` put a Python repr in the attribute —
    `[&#x27;Small&#x27;, &#x27;Large&#x27;]` — which no JSON parser reads back.
    Django auto-escapes the result of this filter into the attribute, and
    `JSON.parse(el.dataset.options)` gets it out again.
    """
    try:
        return json.dumps(value if value is not None else [])
    except (TypeError, ValueError):
        return "[]"


@register.filter
def dom_id(value, prefix=""):
    """`{{ field.pk|dom_id:"kk-fb-options-" }}` → "kk-fb-options-5".

    The obvious `"prefix"|add:field.pk` does not work: Django's `add` tries
    int(value) + int(arg) first, and on the TypeError from concatenating a
    str and an int it returns an empty string rather than raising.
    """
    return mark_safe(f"{prefix}{value}")
