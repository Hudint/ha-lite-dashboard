"""Resolve Material Design Icons from the icon chunks shipped with the HA frontend.

The full HA frontend lazy-loads ~3 MB of icon chunks. The lite page instead asks
for exactly the icons it needs and gets a few hundred bytes back.
"""

from __future__ import annotations

import bisect
import json
import logging
from pathlib import Path

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

MAX_ICONS_PER_REQUEST = 200


class IconResolver:
    """Look up SVG paths for mdi icon names."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._mdi_dir: Path | None = None
        self._starts: list[str] = []
        self._files: list[str] = []
        self._chunks: dict[str, dict[str, str]] = {}
        self.version = "0"

    def _load_metadata(self) -> None:
        from hass_frontend import where  # noqa: PLC0415 - installed by the frontend integration

        self._mdi_dir = where() / "static" / "mdi"
        meta = json.loads((self._mdi_dir / "iconMetadata.json").read_text())
        self.version = str(meta.get("version", "0"))
        # parts are sorted; the first part has no "start" and covers everything before the second
        for part in meta["parts"]:
            self._starts.append(part.get("start", ""))
            self._files.append(part["file"])

    def _chunk_for(self, name: str) -> dict[str, str]:
        idx = bisect.bisect_right(self._starts, name) - 1
        file = self._files[max(idx, 0)]
        if file not in self._chunks:
            assert self._mdi_dir is not None
            self._chunks[file] = json.loads((self._mdi_dir / f"{file}.json").read_text())
        return self._chunks[file]

    def _resolve(self, names: list[str]) -> dict[str, str | None]:
        if self._mdi_dir is None:
            self._load_metadata()
        result: dict[str, str | None] = {}
        for full in names:
            prefix, _, name = full.partition(":")
            if prefix not in ("mdi", "hass") or not name:
                result[full] = None
                continue
            result[full] = self._chunk_for(name).get(name)
        return result

    async def async_resolve(self, names: list[str]) -> dict[str, str | None]:
        """Return {"mdi:name": svg_path or None}."""
        names = names[:MAX_ICONS_PER_REQUEST]
        return await self._hass.async_add_executor_job(self._resolve, names)
