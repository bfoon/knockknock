import json

from django import template
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter
def json_attr(value):
    """Serialise a dict to JSON safe for use inside a single-quoted HTML
    attribute (e.g. data-palette='{...}'). We escape any single quotes and
    HTML-significant characters so the attribute can't break out."""
    text = json.dumps(value, separators=(",", ":"))
    text = (
        text.replace("&", "&amp;")
        .replace("'", "&#39;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return mark_safe(text)
