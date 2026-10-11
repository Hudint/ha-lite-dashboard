"""HTTP views: the lite page itself and the icon lookup endpoint."""

from __future__ import annotations

import html
import json

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import CONF_DASHBOARD, DEFAULT_DASHBOARD, DOMAIN, ICONS_URL, PAGE_URL, STATIC_URL
from .icons import IconResolver

PAGE_TEMPLATE = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<link rel="icon" href="/static/icons/favicon.ico">
<title>{title}</title>
<link rel="stylesheet" href="{static}/app.css?v={version}">
<script>window.LITE_DASHBOARD = {boot};</script>
{scripts}
</head>
<body>
<div id="app"><div class="ld-boot"><div class="ld-spinner"></div></div></div>
</body>
</html>
"""


def _find_entry(hass: HomeAssistant, slug: str):
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.data.get(CONF_DASHBOARD) == slug and not entry.disabled_by:
            return entry
    return None


class LitePageView(HomeAssistantView):
    """Serve the HTML shell for a configured dashboard.

    The shell contains no dashboard data, so it does not require auth: the page
    authenticates itself over the websocket like the regular HA frontend does.
    """

    url = PAGE_URL + "/{slug}"
    extra_urls = [PAGE_URL + "/{slug}/{view:.*}"]
    name = "lite_dashboard:page"
    requires_auth = False

    def __init__(self, version: str, scripts: list[str]) -> None:
        self._version = version
        self._scripts = scripts

    async def get(self, request: web.Request, slug: str, view: str = "") -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        entry = _find_entry(hass, slug)
        if entry is None:
            return web.Response(status=404, text="Lite Dashboard: unknown dashboard")
        boot = {
            "slug": slug,
            "urlPath": None if slug == DEFAULT_DASHBOARD else slug,
            "basePath": f"{PAGE_URL}/{slug}",
            "title": entry.title,
            "iconsUrl": ICONS_URL,
            "version": self._version,
        }
        body = PAGE_TEMPLATE.format(
            lang=html.escape(hass.config.language or "en"),
            title=html.escape(entry.title),
            static=STATIC_URL,
            version=self._version,
            boot=json.dumps(boot).replace("</", "<\\/"),
            scripts="\n".join(
                f'<script defer src="{STATIC_URL}/{name}?v={self._version}"></script>'
                for name in self._scripts
            ),
        )
        return web.Response(
            text=body,
            content_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )


class LiteIconsView(HomeAssistantView):
    """Return SVG paths for requested mdi icons (public data, like /static/mdi)."""

    url = ICONS_URL
    name = "lite_dashboard:icons"
    requires_auth = False

    def __init__(self, resolver: IconResolver) -> None:
        self._resolver = resolver

    async def get(self, request: web.Request) -> web.Response:
        names = [n for n in request.query.get("names", "").split(",") if n]
        icons = await self._resolver.async_resolve(names)
        return web.json_response(
            icons, headers={"Cache-Control": "public, max-age=604800"}
        )
