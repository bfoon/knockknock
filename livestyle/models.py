"""How a Menti poll draws its live charts.

  theme  bars painted with the theme's accent gradients, straight on the
         theme background — exactly like the Theme Studio preview (default)
  panel  the chart sits on its own separate card: glass, dark or light
  classic  the original rainbow bars on a dark vignette

Kept in its own app: polls / presentations have migrations generated on the
server that aren't in the repository, so a new field there would clash.
This table refers to the questionnaire by id and depends on nothing.
"""

from django.db import models

STYLES = ("theme", "panel", "classic")
PANELS = ("glass", "dark", "light")
DEFAULT = {"style": "theme", "panel": "glass"}


class PollChartStyle(models.Model):
    questionnaire_id = models.PositiveIntegerField(unique=True)
    style = models.CharField(max_length=10, default="theme")
    panel = models.CharField(max_length=10, default="glass")
    updated_at = models.DateTimeField(auto_now=True)

    def as_dict(self):
        return {"style": self.style if self.style in STYLES else "theme",
                "panel": self.panel if self.panel in PANELS else "glass"}


def style_for(questionnaire_id):
    if not questionnaire_id:
        return dict(DEFAULT)
    row = PollChartStyle.objects.filter(questionnaire_id=questionnaire_id).first()
    return row.as_dict() if row else dict(DEFAULT)
