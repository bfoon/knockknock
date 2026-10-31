"""
kura/agent_middleware.py — puts Kora in the bottom-right corner of every
owner-facing Kura page, without editing a dozen standalone templates.

Most Kura screens are self-contained HTML documents (they don't extend
base.html), so a template block can't reach them all. This middleware adds
three tags just before </body> on successful HTML responses whose URL
resolves inside the `kura` namespace:

    <script type="application/json" id="kora-config">…</script>
    <script src="/static/kura/agent/kora.<hash>.js" defer></script>

It skips anything public or field-facing — the web runner (/kura/<code>/),
previews, shared dashboard links, invite links and the enumerator's
"my work" page — and anyone who couldn't see the survey anyway. Any error
here is swallowed: Kora must never be the reason a page fails to load.

settings.py:  add "kura.agent_middleware.KuraAgentMiddleware" to MIDDLEWARE
              after AuthenticationMiddleware. KURA_AGENT_ENABLED=False hides it.
"""

from __future__ import annotations

import logging

from asgiref.sync import iscoroutinefunction, markcoroutinefunction, sync_to_async

logger = logging.getLogger(__name__)

PAGES = {"list", "builder", "data", "studio", "dashboards", "dashboard", "monitor",
         "live_map", "teams", "team_board"}

CHART_JS = "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"
LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
FONTS_CSS = ("https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900"
             "&family=Fraunces:ital,opsz,wght@1,9..144,600&display=swap")


class KuraAgentMiddleware:
    sync_capable = True
    async_capable = True

    def __init__(self, get_response):
        self.get_response = get_response
        if iscoroutinefunction(get_response):
            markcoroutinefunction(self)

    def __call__(self, request):
        if iscoroutinefunction(self):
            return self.__acall__(request)
        response = self.get_response(request)
        return self._maybe_inject(request, response)

    async def __acall__(self, request):
        response = await self.get_response(request)
        return await sync_to_async(self._maybe_inject)(request, response)

    # ───────────────────────────────────────────────────────────────

    def _maybe_inject(self, request, response):
        try:
            snippet = self._snippet(request, response)
            if snippet:
                content = response.content
                idx = content.rfind(b"</body>")
                if idx != -1:
                    response.content = content[:idx] + snippet + content[idx:]
                    if response.has_header("Content-Length"):
                        response["Content-Length"] = str(len(response.content))
        except Exception:  # never break a page over the assistant
            logger.exception("Kora injection skipped")
        return response

    def _snippet(self, request, response) -> bytes | None:
        if response.status_code != 200 or getattr(response, "streaming", False):
            return None
        if "text/html" not in (response.get("Content-Type") or ""):
            return None
        match = getattr(request, "resolver_match", None)
        if not match or match.namespace != "kura" or match.url_name not in PAGES:
            return None
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if request.GET.get("kora") == "0" or request.headers.get("X-Kora-Skip"):
            return None

        from django.conf import settings
        from django.middleware.csrf import get_token
        from django.templatetags.static import static
        from django.utils.html import json_script

        from .agent_ai import agent_enabled
        if not agent_enabled():
            return None

        code = (match.kwargs or {}).get("code")
        can = {"build": True}
        title = ""
        state = ""
        if code:
            from .agent_views import capabilities
            from .models import Survey
            survey = Survey.objects.filter(code=str(code).upper()).only("id", "code", "title", "state", "owner_id").first()
            if survey is None:
                return None
            _access, can = capabilities(user, survey)
            if can is None:
                return None
            code, title, state = survey.code, survey.title, survey.state

        try:
            js_url = static("kura/agent/kora.js")
            css_url = static("kura/agent/kora.css")
        except Exception:
            # Manifest storage without collectstatic: fall back to plain paths.
            base = settings.STATIC_URL if str(settings.STATIC_URL).startswith("/") else "/" + str(settings.STATIC_URL)
            js_url, css_url = base + "kura/agent/kora.js", base + "kura/agent/kora.css"

        config = {
            "v": 1,
            "page": match.url_name,
            "code": code or None,
            "title": title,
            "state": state,
            "user": (user.first_name or user.get_username() or "").split(" ")[0][:30],
            "csrf": get_token(request),
            "can": can,
            "css": css_url,
            "endpoints": {"status": "/kura/agent/status/", "chat": "/kura/agent/chat/",
                          "export": "/kura/agent/export/", "apply": "/kura/agent/apply/"},
            "libs": {"chart": CHART_JS, "leaflet": LEAFLET_JS, "leafletCss": LEAFLET_CSS, "fonts": FONTS_CSS},
        }
        tag = json_script(config, "kora-config")
        return (f"\n{tag}\n<script src=\"{js_url}\" defer></script>\n").encode("utf-8")
