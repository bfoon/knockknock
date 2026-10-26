import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from .models import PANELS, STYLES, PollChartStyle


@login_required
@require_POST
def poll_charts(request, pk):
    """Save a poll's chart style and restyle every open live screen."""
    from polls.models import Questionnaire
    from polls.views import _broadcast_to_live_sessions

    q = get_object_or_404(Questionnaire, pk=pk)
    if not q.can_edit(request.user):
        return JsonResponse({"ok": False, "error": "You don't have access to this questionnaire."}, status=403)
    try:
        data = json.loads(request.body or "{}")
    except ValueError:
        return JsonResponse({"ok": False, "error": "That request was malformed."}, status=400)
    row, _ = PollChartStyle.objects.get_or_create(questionnaire_id=q.pk)
    if data.get("style") in STYLES:
        row.style = data["style"]
    if data.get("panel") in PANELS:
        row.panel = data["panel"]
    row.save()
    out = row.as_dict()
    _broadcast_to_live_sessions(q, dict(out, type="chart_style"))
    return JsonResponse(dict(out, ok=True))
