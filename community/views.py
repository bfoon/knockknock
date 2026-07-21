from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count, Q, Prefetch
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import TopicForm, CommentForm
from .models import Topic, TopicLike, Comment, CommentLike

TOPICS_PER_PAGE = 15


# ─── Topic list (the "Community" tab) ────────────────────────────────

@login_required
def home(request):
    """Community landing page: pinned topics on top, then the feed."""
    qs = (Topic.objects
          .filter(is_removed=False)
          .select_related("author")
          .annotate(
              like_count=Count("topic_likes", distinct=True),
              comment_count=Count("comments", filter=Q(comments__is_removed=False),
                                  distinct=True),
          ))

    category = request.GET.get("category") or ""
    if category in dict(Topic.CATEGORY_CHOICES):
        qs = qs.filter(category=category)
    else:
        category = ""

    query = (request.GET.get("q") or "").strip()
    if query:
        qs = qs.filter(Q(title__icontains=query) | Q(body__icontains=query))

    sort = request.GET.get("sort") or "new"
    if sort == "top":
        qs = qs.order_by("-is_pinned", "-like_count", "-created_at")
    elif sort == "active":
        qs = qs.order_by("-is_pinned", "-comment_count", "-created_at")
    else:
        sort = "new"
        qs = qs.order_by("-is_pinned", "-created_at")

    paginator = Paginator(qs, TOPICS_PER_PAGE)
    page = paginator.get_page(request.GET.get("page"))

    liked_ids = set(
        TopicLike.objects.filter(
            user=request.user, topic__in=page.object_list,
        ).values_list("topic_id", flat=True)
    )

    return render(request, "community/home.html", {
        "page": page,
        "topics": page.object_list,
        "liked_ids": liked_ids,
        "categories": Topic.CATEGORY_CHOICES,
        "active_category": category,
        "query": query,
        "sort": sort,
    })


# ─── Topic CRUD ──────────────────────────────────────────────────────

@login_required
def topic_create(request):
    if request.method == "POST":
        form = TopicForm(request.POST)
        if form.is_valid():
            topic = form.save(commit=False)
            topic.author = request.user
            topic.save()
            messages.success(request, "Your topic is live. 🎉")
            return redirect(topic.get_absolute_url())
    else:
        form = TopicForm()
    return render(request, "community/topic_form.html", {
        "form": form, "is_edit": False,
    })


@login_required
def topic_edit(request, pk):
    topic = get_object_or_404(Topic, pk=pk, is_removed=False)
    if topic.author_id != request.user.id and not request.user.is_staff:
        return HttpResponseForbidden("You can only edit your own topics.")

    if request.method == "POST":
        form = TopicForm(request.POST, instance=topic)
        if form.is_valid():
            form.save()
            topic.mark_edited()
            messages.success(request, "Topic updated.")
            return redirect(topic.get_absolute_url())
    else:
        form = TopicForm(instance=topic)
    return render(request, "community/topic_form.html", {
        "form": form, "is_edit": True, "topic": topic,
    })


@login_required
@require_POST
def topic_delete(request, pk):
    topic = get_object_or_404(Topic, pk=pk)
    if topic.author_id != request.user.id and not request.user.is_staff:
        return HttpResponseForbidden("You can only delete your own topics.")
    topic.is_removed = True
    topic.save(update_fields=["is_removed"])
    messages.success(request, "Topic deleted.")
    return redirect("community:home")


# ─── Topic detail + comments ─────────────────────────────────────────

@login_required
def topic_detail(request, pk):
    topic = get_object_or_404(
        Topic.objects.select_related("author").annotate(
            like_count=Count("topic_likes", distinct=True),
        ),
        pk=pk, is_removed=False,
    )

    # Handle a new comment / reply.
    if request.method == "POST":
        if topic.is_locked:
            messages.error(request, "This topic is locked — new comments are off.")
            return redirect(topic.get_absolute_url())
        form = CommentForm(request.POST)
        if form.is_valid():
            comment = form.save(commit=False)
            comment.topic = topic
            comment.author = request.user
            parent_id = form.cleaned_data.get("parent_id")
            if parent_id:
                comment.parent = Comment.objects.filter(
                    pk=parent_id, topic=topic, is_removed=False,
                ).first()  # silently ignore bogus parent ids
            comment.save()
            messages.success(request, "Comment posted.")
            return redirect(f"{topic.get_absolute_url()}#comment-{comment.pk}")
    else:
        form = CommentForm()

    # Top-level comments with their replies, likes pre-counted.
    replies_qs = (Comment.objects
                  .filter(is_removed=False)
                  .select_related("author")
                  .annotate(like_count=Count("comment_likes", distinct=True)))
    comments = (topic.comments
                .filter(is_removed=False, parent__isnull=True)
                .select_related("author")
                .annotate(like_count=Count("comment_likes", distinct=True))
                .prefetch_related(Prefetch("replies", queryset=replies_qs)))

    liked_comment_ids = set(
        CommentLike.objects.filter(
            user=request.user, comment__topic=topic,
        ).values_list("comment_id", flat=True)
    )
    user_likes_topic = TopicLike.objects.filter(
        user=request.user, topic=topic,
    ).exists()

    return render(request, "community/topic_detail.html", {
        "topic": topic,
        "comments": comments,
        "form": form,
        "liked_comment_ids": liked_comment_ids,
        "user_likes_topic": user_likes_topic,
    })


@login_required
@require_POST
def comment_delete(request, pk):
    comment = get_object_or_404(Comment, pk=pk, is_removed=False)
    if comment.author_id != request.user.id and not request.user.is_staff:
        return HttpResponseForbidden("You can only delete your own comments.")
    comment.is_removed = True
    comment.save(update_fields=["is_removed"])
    messages.success(request, "Comment deleted.")
    return redirect(comment.topic.get_absolute_url())


# ─── Likes (POST-only toggles; work with or without JS) ──────────────

@login_required
@require_POST
def topic_like_toggle(request, pk):
    topic = get_object_or_404(Topic, pk=pk, is_removed=False)
    like, created = TopicLike.objects.get_or_create(topic=topic, user=request.user)
    if not created:
        like.delete()
    count = topic.topic_likes.count()
    if request.headers.get("x-requested-with") == "XMLHttpRequest":
        return JsonResponse({"liked": created, "count": count})
    return redirect(topic.get_absolute_url())


@login_required
@require_POST
def comment_like_toggle(request, pk):
    comment = get_object_or_404(Comment, pk=pk, is_removed=False)
    like, created = CommentLike.objects.get_or_create(comment=comment, user=request.user)
    if not created:
        like.delete()
    count = comment.comment_likes.count()
    if request.headers.get("x-requested-with") == "XMLHttpRequest":
        return JsonResponse({"liked": created, "count": count})
    return redirect(f"{comment.topic.get_absolute_url()}#comment-{comment.pk}")
