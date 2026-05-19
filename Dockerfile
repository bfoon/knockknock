FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Pin the Playwright browser path so the install step and the
    # runtime agree on where Chromium lives. Default is
    # /root/.cache/ms-playwright which works fine, but being explicit
    # makes it easier to debug and to share between users/containers.
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

# ── Playwright browser + system deps ─────────────────────────────
# The Python package alone isn't enough — Playwright also needs a
# Chromium binary and the X/glib/nss libraries it links against.
# `--with-deps` installs both in one shot. Done as a separate layer
# so changes to your app code don't bust the (expensive) browser
# download cache.
RUN playwright install --with-deps chromium

COPY . .

RUN mkdir -p /app/staticfiles /app/media

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]