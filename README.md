# Lite Dashboard für Home Assistant

Zeigt ein bestehendes Lovelace-Dashboard als **schlanke, eigenständige Seite** an. Gedacht für schwache Wanddisplays (Shelly Wall Display, ältere Tablets), auf denen das normale HA-Frontend träge ist.

Du baust dein Dashboard weiter ganz normal im HA-Editor. Die Integration liest dieselbe Konfiguration und stellt sie unter `/lite-dashboard/<dashboard>` bereit. Dort wird sie mit wenig JavaScript, ohne Web-Components und ohne Custom-Card-Ressourcen gerendert. Änderungen am Dashboard erscheinen automatisch, ohne dass du die Seite neu laden musst.

## Warum ist das schneller?

Das normale Frontend lädt beim Öffnen jedes Dashboards die komplette HA-App: Seitenleiste, Editoren, Hunderte Komponenten und **alle** installierten Custom-Card-Ressourcen, auch solche, die das Dashboard gar nicht nutzt. Die Lite-Seite lädt nur:

- ihr eigenes, kleines Skript (ca. 150 KB, ohne Build-Schritt, ES2017-kompatibel für alte WebViews),
- die Zustände der Entitäten, die im Dashboard vorkommen (`subscribe_entities` mit Filter),
- genau die Icons, die gebraucht werden (ein Request, danach lokal gecacht).

Ein Tap schaltet sofort optisch um und wird dann von HA bestätigt.

### Messung

Gemessen mit demselben Dashboard, denselben Daten und Benutzer, Chromium mit **6-fach gedrosselter CPU**, Median aus 3 Läufen:

| | Original-Frontend | Lite-Seite | Lite eingebettet (Webseite-Dashboard) |
|---|---|---|---|
| Laden bis bedienbar | 10,1 s | **1,1 s** | 6,7 s |
| Tap → sichtbare Reaktion | 116 ms | **34 ms** | 49 ms |
| Long-Press → Dialog (inkl. 500 ms Haltezeit) | 1224 ms | **514 ms** | 513 ms |
| Blockierte Rechenzeit beim Laden | 6,7 s | **0,23 s** | 4,0 s |
| JS-Speicher | 33 MB | **3,5 MB** | 55 MB |

Die echten Werte auf einem Gerät hängen von dessen CPU und WebView ab. Das Verhältnis sollte aber ähnlich sein.

## Installation

### HACS (benutzerdefiniertes Repository)

1. HACS → ⋮ → *Benutzerdefinierte Repositories* → URL dieses Repos, Typ **Integration**.
2. „Lite Dashboard“ installieren und Home Assistant neu starten.

### Manuell

Den Ordner `custom_components/lite_dashboard` nach `/config/custom_components/` kopieren und HA neu starten.

## Einrichtung

1. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Lite Dashboard*.
2. Dashboard auswählen. Für jedes gewünschte Dashboard kannst du einen eigenen Eintrag anlegen.
3. Die Seite ist danach erreichbar unter `http://<ha-adresse>:8123/lite-dashboard/<url-pfad>`, zum Beispiel `/lite-dashboard/dashboard-displayxl`.

Die Anmeldung läuft über den normalen HA-Login. Ein eingeschränkter Benutzer (z. B. `shelly`) funktioniert.

### Auf dem Shelly Wall Display

- **Variante A (am schnellsten):** Wenn die Shelly-Firmware oder eine Kiosk-App (z. B. [ShellyElevate](https://github.com/RapierXbox/ShellyElevate)) eine beliebige URL erlaubt, trägst du dort direkt `http://<ha-adresse>:8123/lite-dashboard/<url-pfad>` ein.
- **Variante B (funktioniert immer):** In HA unter *Einstellungen → Dashboards → Dashboard hinzufügen → Webseite* ein Dashboard mit der URL `/lite-dashboard/<url-pfad>` anlegen und es für den Display-Benutzer als Standard-Dashboard setzen. Die Lite-Seite übernimmt die Anmeldung von HA, ein zweiter Login ist nicht nötig. Beim Start lädt HA einmal sein Frontend im Hintergrund, die Bedienung läuft danach komplett über die Lite-Seite.

URL-Parameter: `?kiosk` blendet die Ansichts-Tabs aus, `?lang=de` erzwingt eine Sprache.

## Unterstützte Karten

**Ansichten:** `sections` (gleiche Spalten- und Rasterlogik wie HA), `masonry`, `panel`, `sidebar`, Badges, Sichtbarkeitsbedingungen für Abschnitte und Karten.

**HA-Karten:** `tile` (inkl. Features `toggle`, `target-temperature`, `light-brightness`, `cover-open-close`, `cover-position`, `fan-speed`, `climate-hvac-modes`, `climate-preset-modes`), `heading` (mit Badges), `button`, `entities`, `glance`, `entity`/`sensor` (ohne Graph), `thermostat`, `weather-forecast`, `markdown` (mit Templates), `grid`, `vertical-stack`, `horizontal-stack`, `conditional`, `picture`, `picture-entity`, `picture-glance`, `iframe`.

**Custom Cards, nachgebaut (die Original-JS wird nicht geladen):** `actions-card`, `restriction-card` (PIN/Bestätigen/Sperren, gleiche Logik wie das Original), `bignumber-card`, `split-button-card`, `button-card` (Kernfunktionen inkl. `[[[ JS-Templates ]]]`), Mushroom-Entity-/Light-/Climate-/Cover-…-Karten, `mushroom-template-card`, `mushroom-title-card`, `mushroom-chips-card`, `stack-in-card`, `layout-card` (vereinfacht).

**Aktionen:** `toggle`, `more-info` (eigener, schlanker Dialog für Licht, Klima, Abdeckungen, Schlösser, Skripte, Wetter und generische Entitäten), `perform-action`/`call-service`, `navigate`, `url`, Bestätigungsdialoge, `tap`/`hold`/`double_tap`/`icon_tap`.

## Grenzen

- Nicht unterstützt sind Graphen und Verlauf (`history-graph`, `statistics-graph`, Sensor-Graph), Karten (`map`), Kamera-Streams, Energie-Karten, Kalender, Media-Control und Alarm-Keypad. Solche Karten werden als Hinweis angezeigt. Unbekannte Custom Cards mit einer `entity` erscheinen als bedienbare Kachel.
- `card_mod` wird nicht ausgeführt. Übernommen werden nur einfache CSS-Variablen der Form `ha-card { --x: y; }`.
- Strategie-Dashboards (automatisch generiert) müssen in HA erst „übernommen“ werden.
- Der Detaildialog ist bewusst kompakt und kein vollständiger Ersatz für den HA-Dialog.

## Entwicklung

Kein Build-Schritt: Die Dateien in `custom_components/lite_dashboard/www/js/` werden in Namensreihenfolge geladen. Die Cache-Version ergibt sich aus einem Hash der Dateien beim HA-Start.
