from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from polls.models import Questionnaire
from games.models import Quiz
from presentations.models import LiveSession


def home(request):
    if request.user.is_authenticated:
        from django.shortcuts import redirect
        return redirect("core:dashboard")
    return render(request, "core/home.html")


@login_required
def dashboard(request):
    questionnaires = Questionnaire.objects.filter(owner=request.user).order_by("-updated_at")[:10]
    quizzes = Quiz.objects.filter(owner=request.user).order_by("-updated_at")[:10]
    recent_sessions = LiveSession.objects.filter(owner=request.user).order_by("-created_at")[:5]
    return render(request, "core/dashboard.html", {
        "questionnaires": questionnaires,
        "quizzes": quizzes,
        "recent_sessions": recent_sessions,
    })


def join(request):
    """Landing page where participants enter a session code."""
    return render(request, "core/join.html")
