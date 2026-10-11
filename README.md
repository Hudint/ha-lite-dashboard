# Lite Dashboard for Home Assistant

Renders an existing Lovelace dashboard as a **lightweight standalone page**. Built for slow wall panels (Shelly Wall Display, older tablets) where the regular HA frontend feels sluggish.

You keep editing your dashboard in the normal HA editor. The integration reads the same configuration and serves it at `/lite-dashboard/<dashboard>`, rendered with a small amount of JavaScript, no web components and no custom card resources. Changes to the dashboard show up automatically, without reloading the page.

## Why is it faster?

Every time a dashboard is opened, the regular frontend loads the whole HA app: sidebar, editors, hundreds of components and **all** installed custom card resources, including the ones the dashboard doesn't use. The lite page only loads:

- its own small script (about 150 KB, no build step, ES2017-compatible for old WebViews),
- the states of the entities that appear in the dashboard (filtered `subscribe_entities`),
- exactly the icons it needs (one request, cached locally afterwards).

A tap updates the UI immediately and is then confirmed by HA.

### Measurements

Same dashboard, same data and user, Chromium with **6x CPU throttling**, median of 3 runs:

| | Regular frontend | Lite page | Lite embedded (Webpage dashboard) |
|---|---|---|---|
| Load until usable | 10.1 s | **1.1 s** | 6.7 s |
| Tap → visible response | 116 ms | **34 ms** | 49 ms |
| Long press → dialog (incl. 500 ms hold time) | 1224 ms | **514 ms** | 513 ms |
| Main-thread blocking during load | 6.7 s | **0.23 s** | 4.0 s |
| JS memory | 33 MB | **3.5 MB** | 55 MB |

Real numbers on a device depend on its CPU and WebView, but the ratio should be similar.

## Installation

### HACS (custom repository)

1. HACS → ⋮ → *Custom repositories* → `https://github.com/Hudint/ha-lite-dashboard`, type **Integration**.
2. Install "Lite Dashboard" and restart Home Assistant.

### Manual

Copy the `custom_components/lite_dashboard` folder to `/config/custom_components/` and restart HA.

## Setup

1. *Settings → Devices & services → Add integration → Lite Dashboard*.
2. Pick a dashboard. Add one entry per dashboard you want to publish.
3. The page is then available at `http://<ha-address>:8123/lite-dashboard/<url-path>`, for example `/lite-dashboard/dashboard-displayxl`.

Login uses the regular HA login. A restricted user (e.g. a dedicated `wallpanel` user) works fine.

### On a Shelly Wall Display

- **Option A (fastest):** If the Shelly firmware or a kiosk app (e.g. [ShellyElevate](https://github.com/RapierXbox/ShellyElevate)) accepts an arbitrary URL, enter `http://<ha-address>:8123/lite-dashboard/<url-path>` there.
- **Option B (always works):** In HA, go to *Settings → Dashboards → Add dashboard → Webpage*, use the URL `/lite-dashboard/<url-path>` and make it the default dashboard for the panel's user. The lite page reuses HA's login, so no second login is needed. HA loads its frontend once in the background at startup; after that, all interaction goes through the lite page.

URL parameters: `?kiosk` hides the view tabs, `?lang=en` forces a language.

## Supported cards

**Views:** `sections` (same column and grid logic as HA), `masonry`, `panel`, `sidebar`, badges, visibility conditions for sections and cards.

**HA cards:** `tile` (including the features `toggle`, `target-temperature`, `light-brightness`, `cover-open-close`, `cover-position`, `fan-speed`, `climate-hvac-modes`, `climate-preset-modes`), `heading` (with badges), `button`, `entities`, `glance`, `entity`/`sensor` (without graph), `thermostat`, `weather-forecast`, `markdown` (with templates), `grid`, `vertical-stack`, `horizontal-stack`, `conditional`, `picture`, `picture-entity`, `picture-glance`, `iframe`.

**Custom cards, re-implemented (the original JS is never loaded):** `actions-card`, `restriction-card` (PIN/confirm/block, same logic as the original), `bignumber-card`, `split-button-card`, `button-card` (core features incl. `[[[ JS templates ]]]`), Mushroom entity/light/climate/cover/… cards, `mushroom-template-card`, `mushroom-title-card`, `mushroom-chips-card`, `stack-in-card`, `layout-card` (simplified).

**Actions:** `toggle`, `more-info` (its own compact dialog for lights, climate, covers, locks, scripts, weather and generic entities), `perform-action`/`call-service`, `navigate`, `url`, confirmation dialogs, `tap`/`hold`/`double_tap`/`icon_tap`.

## Limitations

- Not supported: graphs and history (`history-graph`, `statistics-graph`, sensor graph), `map`, camera streams, energy cards, calendar, media control and the alarm keypad. These cards show a placeholder notice. Unknown custom cards that have an `entity` are shown as a usable tile.
- `card_mod` is not executed. Only simple CSS variables of the form `ha-card { --x: y; }` are applied.
- Strategy (auto-generated) dashboards must first be "taken control of" in HA.
- The more-info dialog is intentionally compact and is not a full replacement for HA's dialog.

## Development

No build step: the files in `custom_components/lite_dashboard/www/js/` are loaded in name order. The cache version is a hash of the files, computed when HA starts.
