from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import render

from .games import GAMES, get_game


@login_required
def catalog(request):
    """Grid of available icebreaker games."""
    return render(request, "icebreakers/catalog.html", {
        "games": GAMES,
    })


@login_required
def play(request, game_id):
    """Full-screen runner for one game."""
    game = get_game(game_id)
    if game is None:
        raise Http404("Icebreaker not found.")

    return render(request, "icebreakers/play.html", {
        "game": game,
    })
