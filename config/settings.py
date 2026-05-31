"""
Django settings for Knock-Knock.
"""
from pathlib import Path
import os
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY", default="dev-secret-key-change-me")
DEBUG = env.bool("DEBUG", default=True)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])

INSTALLED_APPS = [
    "daphne",  # must come before django.contrib.staticfiles
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    "channels",

    # Local
    "accounts",
    "core",
    "polls",
    "games",
    "presentations",
    "subscriptions",
    "organizations",
    "collaborations",
    "attendance",
    "boardly",
    "hanns",
    "quest_rpg",
    "cards",
    "icebreakers.apps.IcebreakersConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Database
if env("POSTGRES_HOST", default=None):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("POSTGRES_DB"),
            "USER": env("POSTGRES_USER"),
            "PASSWORD": env("POSTGRES_PASSWORD"),
            "HOST": env("POSTGRES_HOST"),
            "PORT": env("POSTGRES_PORT", default="5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# Channels
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    },
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static / media
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Auth
LOGIN_URL = "accounts:login"
LOGIN_REDIRECT_URL = "core:dashboard"
LOGOUT_REDIRECT_URL = "core:home"


# ──────────────────────────────────────────────────────────────────
# Email (Gmail SMTP)
# ──────────────────────────────────────────────────────────────────
#
# Gmail no longer accepts your normal account password over SMTP. You
# need an "App Password":
#
#   1. Turn on 2-Step Verification on the Google account that will
#      send the mail — required, App Passwords are only available
#      once 2FA is on. (https://myaccount.google.com/security)
#   2. Visit https://myaccount.google.com/apppasswords
#   3. Generate a new app password — pick "Mail" + "Other (Custom)".
#   4. Copy the 16-character token (the page hides it after you leave).
#   5. Put it in .env as EMAIL_HOST_PASSWORD. Spaces are optional;
#      Google shows it as "abcd efgh ijkl mnop" but "abcdefghijklmnop"
#      works the same.
#
# Behaviour:
#   - If EMAIL_HOST_USER is set, we use real Gmail SMTP.
#   - Otherwise (dev with no credentials), we fall back to the console
#     backend so send_mail() prints to the terminal instead of crashing.
#     This keeps local dev working without exposing test mail to users.
#
# DEFAULT_FROM_EMAIL is what recipients see in "From:". Best practice
# is to match it to EMAIL_HOST_USER — Gmail will rewrite it to the
# authenticated user anyway, so they should be the same address.

EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")

if EMAIL_HOST_USER:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = env("EMAIL_HOST", default="smtp.gmail.com")
    EMAIL_PORT = env.int("EMAIL_PORT", default=587)
    # TLS on port 587 is the modern, recommended path.
    # If you'd rather use implicit SSL on 465, set EMAIL_USE_SSL=True
    # and EMAIL_USE_TLS=False in .env — only one of the two should be
    # truthy at a time.
    EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
    EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)
    DEFAULT_FROM_EMAIL = env(
        "DEFAULT_FROM_EMAIL",
        default=f"Knock-Knock <{EMAIL_HOST_USER}>",
    )
    # Used by Django's password-reset and other internal mail; usually
    # the same as DEFAULT_FROM_EMAIL.
    SERVER_EMAIL = env("SERVER_EMAIL", default=DEFAULT_FROM_EMAIL)
    # Reasonable network timeout so a stuck SMTP connection doesn't
    # hang a web request. 10s is the Django docs' suggestion.
    EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=10)
else:
    # No credentials set → print mail to the console. Devs can still
    # see what would have been sent without configuring Gmail at all.
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
    DEFAULT_FROM_EMAIL = "Knock-Knock <noreply@localhost>"
    SERVER_EMAIL = DEFAULT_FROM_EMAIL