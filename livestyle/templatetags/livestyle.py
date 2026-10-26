"""{% poll_chart_style questionnaire_id as cs %} → {"style": …, "panel": …}

Lets the poll editor and the live presenter page read the chart style
without changing the polls / presentations views."""

from django import template

from ..models import style_for

register = template.Library()


@register.simple_tag
def poll_chart_style(questionnaire_id):
    try:
        return style_for(int(questionnaire_id or 0))
    except (TypeError, ValueError):
        return style_for(0)
