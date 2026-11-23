# PivIT Home

A Savant-style touchscreen dashboard for Home Assistant, built for wall-mounted iPads and tablets.

PivIT Home is a **dashboard strategy**: instead of a fixed list of cards, it builds the whole dashboard from the home's areas, devices and entities every time it opens. Install it once per home, add one line of config, and the dashboard lays itself out. New devices and rooms appear on their own.

## What it builds

- **Rooms** – a large clock, greeting, weather and alarm status; a *Home* row (All Lights Off, garage door, thermostat, locks, plus any quick actions and alerts you add); and a tile for every room. Tapping a room opens a pop-up with that room's media players, climate, covers, dimmable lights (slide to dim), switches and fans, plus an *All Off* button.
- **Climate** – every thermostat, grouped by room, plus ceiling fans.
- **Security** – alarm panels (arm home / arm away / disarm) and every door, window, motion, smoke and CO sensor, grouped by room.
- **Cameras** – every camera in a two-column grid.
- **Media** – every TV and speaker, grouped by room.
- A fixed navigation bar along the bottom, and any extra pages you add.

Pages that would be empty (no cameras, no thermostats) are left out automatically.

## Requirements

- Home Assistant 2025.1 or newer
- [Bubble Card](https://github.com/Clooos/Bubble-Card) v3.2 or newer (install it from the Marketplace/HACS)
- Devices assigned to **areas** – rooms come from areas, so a device without an area won't show up

## Install

**Marketplace / HACS:** add this repository as a custom repository of type *Dashboard*, install **PivIT Home**, then reload the browser.

**Manual:** copy `pivit-home-strategy.js` to `/config/www/pivit-home/` and add a dashboard resource:
Settings → Dashboards → ⋮ → Resources → Add → URL `/local/pivit-home/pivit-home-strategy.js`, type *JavaScript module*.

## Create the dashboard

Settings → Dashboards → Add dashboard → *New dashboard from scratch*. Open it, choose ⋮ → Edit → ⋮ → Raw configuration editor, replace everything with:

```yaml
strategy:
  type: custom:pivit-home
```

Save. That's the whole setup for a basic home.

## Options

All options are optional and go under `strategy:`.

| Option | Default | What it does |
|---|---|---|
| `name` | – | Name in the greeting ("Good evening, Will") |
| `title` | `Home` | Dashboard title |
| `room_order` | `[]` | Area IDs to show first, in order; the rest follow alphabetically |
| `hide_areas` | `[]` | Area IDs never shown (e.g. `server_rack`, `attic`) |
| `room_names` | `{}` | `area_id: Display name` overrides |
| `room_icons` | `{}` | `area_id: mdi:icon` overrides |
| `room_images` | `{}` | `area_id: /local/rooms/kitchen.jpg` – photo behind the room tile (the area's own picture is used if set) |
| `hide_entities` | `[]` | Entity IDs never shown |
| `extra_entities` | `[]` | Entity IDs added to their room even if their type or integration is normally left out – e.g. door unlock buttons (pressed with confirmation) or door sensors |
| `entity_names` | `{}` | `entity_id: Display name` overrides |
| `elan_rooms` | `true` | PivIT ELAN: show the Rooms page (Savant-style room tiles) below Climate |
| `camera_events` | `true` | PivIT ELAN: Camera Events list and per-camera event strips (UniFi Protect clips) |
| `elan_room_order` | `[]` | PivIT ELAN: Rooms page order (room ids or names); unlisted rooms follow |
| `camera_order` | `[]` | Camera entity_ids shown first, in this order, on the camera pages; the rest follow |
| `exclude_platforms` | network, NAS, UPS, Supervisor, backup, iBeacon, mobile app | Integrations whose entities are left out of rooms |
| `room_domains` | climate, media_player, cover, light, fan, switch, lock, vacuum | Entity types shown in rooms |
| `weather_entity` | first `weather.*` | Weather shown on the home screen |
| `all_lights_off` | `true` | Show the *All Lights Off* button |
| `all_lights_confirm` | `true` | Ask before turning every light off |
| `quick_actions` | `[]` | Extra entities for the *Home* row – an entity ID, or `{entity, name}` |
| `main_thermostat` | first thermostat | Climate entity shown in the *Home* row |
| `max_quick_locks` | `4` | Locks get their own Home-row button up to this many; above it, one *Lock All Doors* button (with confirmation) replaces them |
| `alerts` | `[]` | Red banners that appear only when a condition is met: `{entity, above, below, state, name, icon}` |
| `security_classes` | smoke, CO, gas, moisture, safety, door, garage door, window, opening, motion, occupancy | Binary sensor types shown on the Security page |
| `room_openings` | door, garage door, window, opening | Sensor types summarised on each room tile: an open icon per open door/window, or a closed-lock icon when all are shut (`[]` turns it off) |
| `room_status_classes` | door, garage door, window, opening, motion, occupancy, presence | Sensor types listed in yellow under the room name while open/detected |
| `room_lock_platforms` | all | Lock integrations that drive the room-tile lock icon, e.g. `["schlage"]` |
| `summaries` | none | Extra Home-row summary buttons, e.g. Sprinklers: `[{ name, icon, entities, on_word, off_text, cards, popups, spacer_before }]` — live count, tap opens a pop-up with `cards` |
| `nav_order` | none | Page order for the bottom menu and tabs, by page id or extra-view path, e.g. `[rooms, media, pool, cameras, security]` |
| `shared_entities` | none | `{ area_id: [entity ids] }` — also show these devices in that room (e.g. a Sonos amp shared by kitchen and dining) |
| `corner_alarm` | false | Pin a round alarm button to the top-right corner of the Rooms page |
| `audio_card` | default | `mediocre` uses the Mediocre Media Player Card (install `antontanderup/mediocre-hass-media-player-cards` first) for speakers |
| `kiosk_mode` | hide header + sidebar for non-admins | Kiosk Mode (`NemesisRE/kiosk-mode`) settings for this dashboard; `false` turns it off. Admins keep the menus; add `?disable_km` to a URL to show them |
| `hide_room_tiles` | none | Area ids whose room tile is hidden on the Rooms page; unlike `hide_areas`, their devices still appear in counts, pop-ups and other pages |
| `climate_zones` | none | Climate entities (or `{ entity, name }`) for the Rooms-page **Climate** button (live "N cooling / heating" status; opens all their controls) |
| `floor_thermostats` | none | Map of floor id → thermostat, e.g. `{ upstairs: climate.upstairs }`. Room tiles on that floor with no thermostat of their own show its temperature |
| `room_thermostats` | none | Per-room override, e.g. `{ attic: none, den: climate.den }`. A thermostat id shows that temperature; `none` shows no temperature on that tile |
| `intercoms` | none | Gate/door intercoms: `[{ name, camera, unlock, unlock_name, speaker, tts, messages: [...], message_entity, say_script, ring_entity, lock_rule, lock_rule_sensor }]`. Adds a pop-up (live video, unlock, spoken messages) on every page and a button on Rooms; `ring_entity` turning on opens it automatically; `lock_rule` (a select such as UniFi Access lock rule) adds Hold Open / Close Gate; `hold_until_entity` + `hold_until_script` add Hold open until <time>; `status_sensor` shows Open/Closed |
| `alarm_modes` | armed_home, armed_away, disarmed | Buttons on each alarm panel |
| `pages` | rooms, climate, security, cameras, media | Built-in pages to include, in order |
| `extra_views` | `[]` | Full Lovelace view configs added after the built-in pages (they get the nav bar automatically) |
| `nav_width` | `auto` | Width of the bottom navigation bar; `auto` sizes it to the number of pages (about 160px each) |
| `background` | dark radial gradient | CSS background for every page |

### Example

```yaml
strategy:
  type: custom:pivit-home
  name: Will
  room_order: [living_room, kitchen, master_bedroom]
  hide_areas: [attic, server_rack]
  room_names:
    master_bedroom: Master Bedroom
  hide_entities:
    - media_player.front_door_speaker
  entity_names:
    cover.garage_door_opener: Garage Door
  quick_actions:
    - entity: switch.pool_pump
      name: Pool
  alerts:
    - entity: sensor.pool_cleaner_canister_level
      above: 99
      name: Pool Cleaner Canister Full
      icon: mdi:delete-alert
```

## Rolling it out to a new home

1. Put every device in the right area and give entities sensible names.
2. Install Bubble Card and PivIT Home.
3. Create the dashboard with the one-line config, then add options as needed.
4. On the iPad, install the Home Assistant app, set this dashboard as the default (App settings → Default dashboard), and use Guided Access to lock it to the app.

## Customizing further

To hand-tune one home beyond what the options allow, open the dashboard's raw configuration editor and choose **Take control**. That converts the generated dashboard into a normal, editable one (it will no longer update itself).

## License

MIT © PivIT Consulting
