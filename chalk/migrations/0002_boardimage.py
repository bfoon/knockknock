"""Pass 2: photo uploads.

The only schema change in this pass. Elements themselves live in the
`BoardPage.els` JSON field, which Pass 1 already created.

If your latest chalk migration is not called `0001_initial`, change the
dependency below to match — or just delete this file and run
`python manage.py makemigrations chalk`, which will produce the same thing.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models

import chalk.models


class Migration(migrations.Migration):

    dependencies = [
        ("chalk", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="BoardImage",
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
                    "file",
                    models.ImageField(upload_to=chalk.models.board_image_path),
                ),
                ("width", models.PositiveIntegerField(default=0)),
                ("height", models.PositiveIntegerField(default=0)),
                ("uploaded_at", models.DateTimeField(auto_now_add=True)),
                (
                    "board",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="images",
                        to="chalk.board",
                    ),
                ),
            ],
            options={"ordering": ["-uploaded_at"]},
        ),
    ]
