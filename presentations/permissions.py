"""
Who may present (control) a live session.

The session's owner, or anyone who can edit the game / Wenti behind it —
so a colleague with edit rights can run the game for the owner, from
their own device, and the owner can take it back from theirs.
"""


def can_present(user, session):
    if not user or not getattr(user, "is_authenticated", False) or session is None:
        return False
    if session.owner_id == user.id:
        return True
    content = session.quiz if session.kind == "game" else session.questionnaire
    return bool(content and content.can_edit(user))
