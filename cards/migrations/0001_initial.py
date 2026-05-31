import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Card",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "token",
                    models.CharField(
                        db_index=True, editable=False, max_length=12, unique=True
                    ),
                ),
                ("title", models.CharField(max_length=140)),
                ("recipient_name", models.CharField(max_length=120)),
                (
                    "occasion",
                    models.CharField(
                        choices=[
                            ("thank_you", "Thank You"),
                            ("goodbye", "Goodbye / Farewell"),
                            ("love_you", "Love You"),
                            ("congrats", "Congratulations"),
                            ("get_well", "Get Well Soon"),
                            ("birthday", "Happy Birthday"),
                            ("welcome", "Welcome Aboard"),
                            ("sympathy", "With Sympathy"),
                            ("good_luck", "Good Luck"),
                            ("appreciation", "Appreciation"),
                        ],
                        default="thank_you",
                        max_length=20,
                    ),
                ),
                (
                    "template",
                    models.CharField(
                        choices=[
                            ("sunset_bloom", "Sunset Bloom"),
                            ("midnight_glow", "Midnight Glow"),
                            ("paper_craft", "Paper Craft"),
                            ("ocean_breeze", "Ocean Breeze"),
                            ("golden_hour", "Golden Hour"),
                            ("lavender_fields", "Lavender Fields"),
                        ],
                        default="sunset_bloom",
                        max_length=30,
                    ),
                ),
                (
                    "recipient_photo",
                    models.ImageField(
                        blank=True, null=True, upload_to="cards/photos/%Y/%m/"
                    ),
                ),
                (
                    "intro_note",
                    models.TextField(
                        blank=True,
                        help_text="Optional note from the organiser shown under the photo.",
                    ),
                ),
                ("is_closed", models.BooleanField(default=False)),
                ("moderated", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cards_created",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Message",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("author_name", models.CharField(default="Anonymous", max_length=80)),
                ("body", models.TextField(max_length=600)),
                (
                    "color",
                    models.CharField(
                        choices=[
                            ("mint", "Mint"),
                            ("peach", "Peach"),
                            ("sky", "Sky"),
                            ("lemon", "Lemon"),
                            ("rose", "Rose"),
                            ("lilac", "Lilac"),
                        ],
                        default="mint",
                        max_length=10,
                    ),
                ),
                ("tilt", models.SmallIntegerField(default=0)),
                ("is_approved", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "card",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="cards.card",
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
