"""
Template tag library: register an inclusion tag the dashboard can use to
drop a top-3 leaderboard widget next to any quiz, without the dashboard
having to know how to query Participants.

Setup (one-time):
1. Create the file `games/templatetags/__init__.py` (empty).
2. Save this file as `games/templatetags/games_extras.py`.
3. In any template, `{% load games_extras %}` then call
   `{% game_top_three quiz %}`.
"""
from django import template

from games.leaderboards import top_three_for_quiz

register = template.Library()


@register.inclusion_tag("games/partials/_top_three.html")
def game_top_three(quiz):
    """Render the top-3 podium for a quiz across all its sessions."""
    return {"top_three": top_three_for_quiz(quiz), "quiz": quiz}
