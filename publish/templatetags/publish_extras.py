import re

from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe

register = template.Library()

INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<strong>\1</strong>"),
    (re.compile(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)"), r"<em>\1</em>"),
    (re.compile(r"`(.+?)`"), r"<code>\1</code>"),
    (re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)"), r'<a href="\2" rel="noopener">\1</a>'),
]


@register.filter
def richtext(value):
    """
    Small, deliberately limited inline markup for article paragraphs: bold,
    italic, code, links. Everything is escaped first, so a paste from Word
    cannot inject anything.
    """
    if not value:
        return ""
    out = escape(value)
    for pattern, repl in INLINE:
        out = pattern.sub(repl, out)
    out = out.replace("\n\n", "</p><p>").replace("\n", "<br>")
    return mark_safe("<p>%s</p>" % out)


@register.filter
def reading_time(seconds):
    minutes = max(1, round((seconds or 0) / 60))
    return "%d min read" % minutes


@register.filter
def compact(number):
    try:
        n = int(number)
    except (TypeError, ValueError):
        return number
    if n < 1000:
        return str(n)
    if n < 1000000:
        return ("%.1fk" % (n / 1000.0)).replace(".0k", "k")
    return ("%.1fm" % (n / 1000000.0)).replace(".0m", "m")


@register.filter
def kind_icon(kind):
    return {
        "article": "bi-file-text", "dataset": "bi-table", "deck": "bi-easel",
        "board": "bi-easel2", "card": "bi-card-heading", "show": "bi-broadcast",
    }.get(kind, "bi-file-earmark")


@register.simple_tag
def querystring(request, **kwargs):
    params = request.GET.copy()
    for key, value in kwargs.items():
        if value in (None, ""):
            params.pop(key, None)
        else:
            params[key] = value
    params.pop("page", None)
    encoded = params.urlencode()
    return "?%s" % encoded if encoded else ""


@register.filter
def tsv_rows(value):
    """
    Table blocks are stored as plain text: one row per line, cells separated by
    a tab or a pipe. That keeps them editable by hand and pasteable from a
    spreadsheet without a table widget.
    """
    rows = []
    for line in (value or "").splitlines():
        if not line.strip():
            continue
        sep = "\t" if "\t" in line else ("|" if "|" in line else None)
        cells = [c.strip() for c in line.split(sep)] if sep else [line.strip()]
        rows.append([c for c in cells if c != ""] or [""])
    return rows
