from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


class Topic(models.Model):
    """A community post: a question, idea, showcase, or announcement."""

    CATEGORY_GENERAL = "general"
    CATEGORY_HELP = "help"
    CATEGORY_IDEAS = "ideas"
    CATEGORY_SHOWCASE = "showcase"
    CATEGORY_ANNOUNCE = "announce"
    CATEGORY_CHOICES = [
        (CATEGORY_GENERAL, "General"),
        (CATEGORY_HELP, "Help & questions"),
        (CATEGORY_IDEAS, "Ideas & feedback"),
        (CATEGORY_SHOWCASE, "Showcase"),
        (CATEGORY_ANNOUNCE, "Announcements"),
    ]

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_topics",
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    category = models.CharField(
        max_length=20, choices=CATEGORY_CHOICES, default=CATEGORY_GENERAL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    # Moderation / curation
    is_pinned = models.BooleanField(default=False)
    is_locked = models.BooleanField(
        default=False,
        help_text="Locked topics stay visible but can't receive new comments.",
    )
    is_removed = models.BooleanField(
        default=False,
        help_text="Soft-delete: hidden from lists, kept for the record.",
    )

    likes = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="TopicLike",
        related_name="liked_topics",
        blank=True,
    )

    class Meta:
        ordering = ["-is_pinned", "-created_at"]
        indexes = [
            models.Index(fields=["category", "-created_at"]),
            models.Index(fields=["is_removed", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.title} — {self.author}"

    def get_absolute_url(self):
        return reverse("community:topic_detail", kwargs={"pk": self.pk})

    def mark_edited(self):
        self.edited_at = timezone.now()
        self.save(update_fields=["edited_at", "title", "body", "category"])

    @property
    def visible_comment_count(self):
        return self.comments.filter(is_removed=False).count()


class TopicLike(models.Model):
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="topic_likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("topic", "user")]


class Comment(models.Model):
    """A comment on a topic. One level of replies via `parent`."""

    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_comments",
    )
    parent = models.ForeignKey(
        "self",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="replies",
        help_text="Set when this comment is a reply to another comment.",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_removed = models.BooleanField(default=False)

    likes = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="CommentLike",
        related_name="liked_comments",
        blank=True,
    )

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["topic", "created_at"])]

    def __str__(self):
        return f"Comment by {self.author} on {self.topic_id}"

    def save(self, *args, **kwargs):
        # Keep replies one level deep: a reply to a reply attaches to the
        # top-level parent instead, so threads never nest infinitely.
        if self.parent and self.parent.parent_id:
            self.parent = self.parent.parent
        super().save(*args, **kwargs)


class CommentLike(models.Model):
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name="comment_likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("comment", "user")]
