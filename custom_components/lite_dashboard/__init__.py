"""Lite Dashboard: serve Lovelace dashboards as a lightweight standalone page.

The regular HA frontend loads the full app (sidebar, editors, hundreds of web
components, every registered custom card resource). On weak wall panels this
makes taps lag. This integration serves a small page that reads the same
dashboard config and renders it with plain DOM, talking to HA over the normal
websocket API.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, STATIC_URL
from .icons import IconResolver
from .views import LiteIconsView, LitePageView

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

WWW_DIR = Path(__file__).parent / "www"


def _scan_assets() -> tuple[str, list[str]]:
    """Return a content hash (cache buster) and the ordered script list."""
    scripts = sorted(p.relative_to(WWW_DIR).as_posix() for p in (WWW_DIR / "js").glob("*.js"))
    digest = hashlib.sha1()
    for name in [*scripts, "app.css"]:
        digest.update((WWW_DIR / name).read_bytes())
    return digest.hexdigest()[:10], scripts


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the static assets and views once."""
    version, scripts = await hass.async_add_executor_job(_scan_assets)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(WWW_DIR), cache_headers=True)]
    )
    hass.http.register_view(LitePageView(version, scripts))
    hass.http.register_view(LiteIconsView(IconResolver(hass)))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Nothing to set up per entry: the page view looks entries up on request."""
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an entry."""
    return True
