from channels.db import database_sync_to_async
from django.db import transaction

from presentations.models import LiveSession
from .models import Question, Choice, Response


@database_sync_to_async
def autosave_poll_response(
    *,
    session_code,
    participant_id,
    question_id,
    choice_id=None,
    text_value="",
    numeric_value=None,
):
    """
    Save or update one participant's answer for one question.

    This makes poll results permanent in the database while the live chart
    can still use Redis/WebSocket for fast display.
    """
    if not session_code or not participant_id or not question_id:
        return {
            "ok": False,
            "error": "Missing session_code, participant_id, or question_id.",
        }

    try:
        session = (
            LiveSession.objects
            .select_related("questionnaire")
            .get(code=session_code, kind="poll")
        )
    except LiveSession.DoesNotExist:
        return {
            "ok": False,
            "error": "Live poll session not found.",
        }

    questionnaire = getattr(session, "questionnaire", None)

    if questionnaire is None:
        return {
            "ok": False,
            "error": "Live session is not linked to a questionnaire.",
        }

    try:
        question = Question.objects.get(
            pk=question_id,
            questionnaire=questionnaire,
        )
    except Question.DoesNotExist:
        return {
            "ok": False,
            "error": "Question not found for this session.",
        }

    choice = None

    if choice_id not in (None, "", "null", "undefined"):
        try:
            choice = Choice.objects.get(
                pk=choice_id,
                question=question,
            )
        except Choice.DoesNotExist:
            choice = None

    clean_text = str(text_value or "").strip()

    clean_numeric = None
    if numeric_value not in (None, "", "null", "undefined"):
        try:
            clean_numeric = float(numeric_value)
        except Exception:
            clean_numeric = None

    # Scale fallback: sometimes the value comes as text.
    if question.type == "scale" and clean_numeric is None and clean_text:
        try:
            clean_numeric = float(clean_text)
        except Exception:
            clean_numeric = None

    with transaction.atomic():
        response = (
            Response.objects
            .select_for_update()
            .filter(
                session=session,
                question=question,
                participant_id=str(participant_id),
            )
            .order_by("-id")
            .first()
        )

        if response is None:
            response = Response(
                session=session,
                question=question,
                participant_id=str(participant_id),
            )

        response.choice = choice
        response.text_value = clean_text
        response.numeric_value = clean_numeric
        response.save()

    return {
        "ok": True,
        "response_id": response.id,
        "question_id": question.id,
        "choice_id": choice.id if choice else None,
    }