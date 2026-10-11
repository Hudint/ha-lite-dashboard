"""Config flow: pick a dashboard to publish as a lite page."""

from __future__ import annotations

from typing import Any

try:
    import probatio as vol
except ImportError:  # HA releases before the probatio switch
    import voluptuous as vol

from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import CONF_DASHBOARD, DEFAULT_DASHBOARD, DOMAIN, PAGE_URL


def _available_dashboards(hass) -> dict[str, str]:
    """Return {slug: title} for all lovelace dashboards."""
    result: dict[str, str] = {}
    for url_path, dashboard in hass.data[LOVELACE_DATA].dashboards.items():
        if url_path is None:
            result[DEFAULT_DASHBOARD] = "Overview"
            continue
        title = (dashboard.config or {}).get("title") or url_path
        result[url_path] = title
    return result


class LiteDashboardConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Lite Dashboard."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Let the user choose a dashboard."""
        dashboards = _available_dashboards(self.hass)
        configured = {
            entry.data.get(CONF_DASHBOARD) for entry in self._async_current_entries()
        }
        choices = {k: v for k, v in dashboards.items() if k not in configured}
        if not choices:
            return self.async_abort(reason="no_dashboards")

        if user_input is not None:
            slug = user_input[CONF_DASHBOARD]
            await self.async_set_unique_id(slug)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=dashboards.get(slug, slug),
                data={CONF_DASHBOARD: slug},
                description_placeholders={"url": f"{PAGE_URL}/{slug}"},
            )

        options = [
            SelectOptionDict(value=slug, label=f"{title} (/{slug})")
            for slug, title in choices.items()
        ]
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_DASHBOARD): SelectSelector(
                        SelectSelectorConfig(
                            options=options, mode=SelectSelectorMode.DROPDOWN
                        )
                    )
                }
            ),
        )
