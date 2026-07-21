# Wiring the community app into Knock-Knock

Drop the `community/` folder next to your other apps (`collaborations/`, `polls/`, etc.), then do these four steps.

## 1. settings.py

```python
INSTALLED_APPS = [
    # ...
    "community",
]
```

## 2. Project urls.py

```python
urlpatterns = [
    # ...
    path("community/", include("community.urls")),
]
```

## 3. Migrations

```bash
python manage.py makemigrations community
python manage.py migrate
```

## 4. The "Community" tab in base.html

Add this to your navbar, alongside your Dashboard link, so it only shows for logged-in users:

```html
{% if user.is_authenticated %}
<li class="nav-item">
  <a class="nav-link {% if request.resolver_match.namespace == 'community' %}active{% endif %}"
     href="{% url 'community:home' %}">
    <i class="bi bi-people"></i> Community
  </a>
</li>
{% endif %}
```

(If your nav isn't Bootstrap `nav-item`/`nav-link` markup, use whatever classes your other tabs use — the `{% url 'community:home' %}` href and the `resolver_match.namespace` active check are the important parts.)

## What you get

- **/community/** — the feed. Pinned topics on top, category pills (General, Help, Ideas, Showcase, Announcements), search, and sorting by newest / most liked / most comments. Paginated 15 per page.
- **/community/new/** — submit a topic (title, category, body; light server-side validation).
- **/community/topic/<id>/** — full topic with likes, comments, and one-level replies. The "Reply" button sets a hidden `parent_id` and scrolls to the form; everything still works with JavaScript off (comments just post as top-level).
- Authors (and staff) can edit or delete their own topics and delete their comments. Deletes are soft (`is_removed=True`) so nothing is lost.
- Likes are POST-only toggles with CSRF protection; they return JSON if called via fetch/XHR, or redirect back otherwise.
- Django admin gets bulk moderation actions: pin, lock (visible but no new comments), and remove/restore.

## Notes and easy next steps

- All views are `@login_required`, matching your "community appears after login" requirement. If you later want the feed publicly readable, remove the decorator from `home` and `topic_detail` and gate only posting.
- Locked topics show a notice instead of the comment form and reject POSTs server-side too.
- Reply depth is capped at one level in `Comment.save()` — a reply to a reply re-attaches to the top-level comment, Reddit-lite style, so threads stay readable.
- If you want notifications ("someone replied to your topic"), the natural hook is right after `comment.save()` in `views.topic_detail` — you can reuse the `_safe_send` pattern from `collaborations/services.py`.
- If usernames should link to profiles later, they're all in one place: the `kk-comment-author` spans and the topic meta lines.
