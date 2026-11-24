# Changelog

## 1.1.74 — 2026-11-23

- PivIT ELAN pop-up titles: taller line box so descenders (the g in "Living Room") aren't clipped.

## 1.1.73 — 2026-11-23

- PivIT ELAN thermostat pop-ups: removed the system fan-mode (air handler blower) row — it stays on Auto.

## 1.1.72 — 2026-11-23

- PivIT ELAN pop-ups: title-bar lock icons use the gold padlocks of the ELAN lock buttons (were green / red).
- PivIT ELAN climate rows: long names wrap (and shrink slightly on iPad widths) instead of scrolling under the temperature.

## 1.1.71 — 2026-11-23

- PivIT ELAN Rooms: the temperature's colour shows the system status — blue while cooling, red while heating, white when idle or off.

## 1.1.70 — 2026-11-23

- PivIT ELAN Rooms: tiles rebuilt as one row — room icon and name on the left; temperature (whole degrees) at the far right with the active icons to its left (lights, fans, unlocked door in red, TV, audio playing). Motion / open-door alerts removed. Fixes the temperature not showing (Bubble hid the sub-button when it had nothing of its own to show).

## 1.1.69 — 2026-11-23

- PivIT ELAN centring fixed: menu and Home content are centred in the visible area below Home Assistant's header bar when it shows (admins), or the whole window when it's hidden (kiosk). Home centres on what's visible — from "HOME" down to the last alert chip — not the clock card's empty top.

## 1.1.68 — 2026-11-23

- PivIT ELAN Home: the clock, date and alert chips are centred vertically in the window (same method as the menu; re-centres as chips come and go). Shared `elanCenterHook` for both.

## 1.1.67 — 2026-11-23

- PivIT ELAN menu: vertical centring reworked — Home Assistant's view container breaks position: fixed (the menu was centred on the page, not the screen). The menu's grid cell now gets a top margin that centres it in the window and sticks at that height while scrolling.

## 1.1.66 — 2026-11-23

- PivIT ELAN: temperatures in whole degrees everywhere the dashboard draws them — room tiles, Pool page readings, and every thermostat pop-up (Home Assistant's thermostat card and Bubble climate cards in pop-ups are replaced by the ELAN climate row with whole degrees and ▲ / ▼, mode buttons and a fan-mode drop-down).

## 1.1.65 — 2026-11-23

- PivIT ELAN Rooms: tile size back to the original (the icons-only-when-on change stays).
- PivIT ELAN menu (wide screens): held in the vertical middle of the screen, lined up with its column.

## 1.1.64 — 2026-11-23

- PivIT ELAN Rooms: tiles are cleaner — each icon shows only while something it stands for is on (lights, fans, TV, audio playing, a door unlocked; the all-locked icon is gone); temperature and motion/open alerts stay. A little more room per tile.
- New `elan_room_order` option (room ids or names) for the Rooms page order; rooms not listed follow.

## 1.1.63 — 2026-11-23

- Camera Events: fixed an empty list with a single UniFi console (the media source lists the cameras at the top level).
- Reverted the 1.1.62 slider change (Bubble's default — icon and name fade while dragging — kept at Will's request).

## 1.1.62 — 2026-11-23

- PivIT ELAN Cameras: new **Events** button under the title opens Camera Events — UniFi Protect detections (person / vehicle / animal / package / ring) from every camera, newest first, with thumbnails; filter by type and camera, 24 hours or 7 days; tap to play the clip (full screen available). Each camera pop-up gets a strip of that camera's recent events. New `custom:pivit-events-card` (in this file; uses Home Assistant's media source, works for non-admin users). `camera_events: false` turns it off.
- PivIT ELAN Home: the camera detections chip opens Camera Events.
- PivIT ELAN sliders: the icon and name stay visible while dragging (the value shows at the right end).

## 1.1.61 — 2026-11-23

- PivIT ELAN Home: new alert chip for recent camera detections — person / vehicle / animal / package seen in the last 5 minutes, showing the latest and its camera ("Person at Front Door", "+2" for more); the icon is yellow while the detection is still active. Tap for the Cameras page.

## 1.1.60 — 2026-11-23

- PivIT ELAN: new Rooms page in the menu, below Climate — the PivIT Home room tiles (live light / fan / lock / TV / audio / temperature icons) in ELAN colours, two per row (one on phones); tap a tile or icon for the same pop-ups as the Savant dashboard, in ELAN style. `elan_rooms: false` hides it.

## 1.1.59 — 2026-11-23

- PivIT ELAN Lighting room pages: the red "<Room> All Off" button is dimmed (35%) and not tappable until at least one device in the room is on.

## 1.1.58 — 2026-11-23

- PivIT ELAN Lighting room pages: lights with effects (e.g. the Pool room's Pool Lights and Spa Lights) get the same effect drop-down and current-effect text as on the Pool page (shared helpers).

## 1.1.57 — 2026-11-23

- PivIT ELAN Pool page: lights with effects (pool and spa lights) get an effect drop-down (palette button) at the right end of their button; the current effect shows next to the state.

## 1.1.56 — 2026-11-23

- Both templates: new `camera_order` option — listed cameras come first (in that order) on the camera pages, the rest follow.

## 1.1.55 — 2026-11-23

- PivIT ELAN: Home Assistant's own pop-up (more-info) — opened by light, LED, fan and pool/spa heat rows — now uses the ELAN navy panel and blue/red palette instead of grey while an ELAN dashboard is open (other dashboards keep the normal look).

## 1.1.54 — 2026-11-22

- PivIT ELAN Home (phones): alert chips no longer run off the screen — the clock area is shorter on narrow screens (36vh, smaller clock), chip text wraps instead of overflowing the edge, and there is room above the bottom menu bar so it never covers the last chip.

## 1.1.53 — 2026-11-22

- Both templates: when Kiosk Mode (NemesisRE/kiosk-mode) is installed, the Home Assistant header and sidebar are hidden for non-admin users (`kiosk_mode` option; default `{ non_admin_settings: { hide_header: true, hide_sidebar: true } }`, `false` to turn off). Admins keep the menus.

## 1.1.52 — 2026-11-22

- PivIT ELAN Cameras: tapping a feed opens its pop-up again (picture-elements cards only react to taps on elements, so each tile has an invisible full-size tap area under the name bar).

## 1.1.51 — 2026-11-22

- PivIT ELAN Cameras: each live tile (now a picture-elements card) has a top bar with the camera name and, on the right, an icon for each detection on the camera seen in the last 5 minutes — motion, person (walk), vehicle (car), animal (paw), package — yellow while active, white for 5 minutes after it ends. Sensors are found on the camera's device by suffix (_motion, _person_detected, _vehicle_detected, _animal_detected, _package_detected). Taps still open the camera pop-up.

## 1.1.50 — 2026-11-22

- Reverted 1.1.49 (menu spacer): the ELAN side menu starts at the top again, beside the page title.

## 1.1.49 — 2026-11-22

- PivIT ELAN: the side menu starts with an invisible spacer the height of the page title, so its top button lines up with the first row of each page (and the menu sits in the same place on every page).

## 1.1.48 — 2026-11-22

- PivIT ELAN: the Video page is now called Cameras (menu label and page title; path stays /video).

## 1.1.47 — 2026-11-22

- PivIT ELAN: menu and row labels use a taller line box so descenders (g, y, p, q) are no longer clipped ("Lighting", "Irrigation", "Living Room").

## 1.1.43–1.1.46 — 2026-11-22

- PivIT ELAN Home: alert chips under the date, each shown only while active and tappable — alarm state (always; red when armed/triggered) → Security; doors/windows open (every visible door/window/opening/garage_door sensor, gate sensors excluded; "Front Door open" or "N doors/windows open") → Security; doors unlocked → Security; gate held open with time left / gate open → gate pop-up; sprinklers (summary groups) running with the zone name or count → Irrigation; pool/spa heater switches on (from the extra pages) → Pool. Hold countdown treats an end time more than 12 h in the past as tomorrow (midnight holds) and anything else past as finished.

## 1.1.42 — 2026-11-22

- PivIT ELAN locks: unlocked doors show only a red padlock icon and red "Unlocked" text (no red row fill or edge); LOCK, UNLOCK and LOCK ALL share one outlined style with gold padlock icons.

## 1.1.41 — 2026-11-22

- PivIT ELAN locks redesigned for clarity (Will: LOCK/UNLOCK pair was confusing): each door row says **Locked** (white, closed padlock) or **Unlocked** (red, open padlock, red left edge and tint), Jammed in amber, Locking…/Unlocking… while moving; one button with the opposite action — solid blue LOCK when unlocked, outlined UNLOCK (gold padlock, confirms) when locked. A "Doors" summary row on top: "N doors unlocked" in red with LOCK ALL (confirms, locks only unlocked doors) or "All doors locked". Lock pop-up: big coloured state + the single action button + activity.

## 1.1.40 — 2026-11-22

- Intercom pop-up: the hold-duration picker now comes after the Open / Hold Open / Held Open buttons and, when closed, hides its grid slot (Bubble wraps each pop-up card in div.card), so Held Open always sits beside Open Front Gate.

## 1.1.39 — 2026-11-22

- Intercoms (both templates): when the hold-open lock rule belongs to a UniFi Access device, Hold Open shows a duration picker (`hold_durations`, default 15 min, 30 min, 1 hr, 2 hr, 4 hr, Until cancelled). A duration calls unifi_access.set_lock_rule (rule custom, interval) and stores the end time in `hold_end_entity` (auto: input_datetime.pivit_<gate>_open_until); Until cancelled uses keep_unlock. While held, the status pill (pop-up header and Home row) reads "Held Open · 23 min", the button reads "Held Open" with "23 min left · Press to cancel", and the ELAN Security row shows Held Open with the time left. Picking a duration is the confirmation (no extra dialog).

## 1.1.36–1.1.38 — 2026-11-22

- PivIT ELAN camera pop-ups use the Advanced Camera Card when it is installed (detected from the dashboard resources, since its script may load after the strategy runs): live view, fixed 16:9, an overlay menu along the bottom with only mute/unmute (camera audio) and full screen; no thumbnails, next/previous or other buttons. Falls back to the HA live picture when the card is missing. The grid stays muted.

## 1.1.33–1.1.35 — 2026-11-22

- PivIT ELAN Video page: every camera live (picture-entity, camera_view live, 16:9, name overlay) — two per row beside the menu, one per row below 1000px; tapping a camera opens a wide (960px) ELAN pop-up (`#camera-<camera>`) with it live. The grid uses a camera's low or medium resolution stream when one exists (pop-up stays high-res). view() accepts { wide, narrow } content.

## 1.1.32 — 2026-11-22

- PivIT ELAN media: tapping the artwork on a Mediocre card used to open Home Assistant's own (grey) media dialog, which lives outside the dashboard and can't be recoloured. Media page now-playing cards now open that room's ELAN audio pop-up (`#<room>-audio`); inside audio pop-ups the artwork tap does nothing (card `action.tap_action`).

## 1.1.31 — 2026-11-22

- PivIT ELAN media: Mediocre media cards use the ELAN palette — album-art colours off (use_art_colors: false) on the Media page and in every ELAN pop-up; card, dialog, text, divider, chip, slider and accent colours set through the card's CSS variables (--mmpc-*). Pop-ups carry them in their style; on pages the ELAN title card puts them on the sections view once it is on screen, so standard cards outside pop-ups (e.g. now playing) follow too.

## 1.1.30 — 2026-11-22

- PivIT ELAN shades: Lighting-page shade rows rebuilt (name, position under it — "Open" / "Closed" / "50% open" — and ▲ ■ ▼ buttons); tapping a row opens an ELAN shade pop-up (`#shade-<cover>`): OPEN / STOP / CLOSE buttons with gold icons (fully open / closed fills blue), a position slider when the shade supports set_position, and 24 h of activity.

## 1.1.28–1.1.29 — 2026-11-22

- PivIT ELAN Security: tapping a door lock row opens an ELAN lock pop-up (`#lock-<lock>`) instead of HA's grey dialog — big LOCK / UNLOCK buttons (gold padlocks, current state blue, unlock confirms) and the lock's last 24 h of activity. ELAN pop-ups use a solid navy card colour so pinned list headers don't show text through them.

## 1.1.25–1.1.27 — 2026-11-22

- PivIT ELAN Home Security pop-up rebuilt (elanAlarmCards): ARM HOME / ARM AWAY (/ ARM NIGHT if supported) / DISARM as ELAN segmented buttons with gold shield icons, current mode filled blue (same look as LOCK / UNLOCK); ELAN keypad (1–9, ⌫, 0, C) with a dot display when the alarm needs a code. The code lives only in the browser until a button is tapped, is sent with that command, then cleared. Tapping a button with no code shows "Enter code first" and sends nothing. Cards use fixed heights (Bubble Card positions contents absolutely).

## 1.1.24 — 2026-11-22

- PivIT ELAN Media: "All Zones Off" only sends media_player.turn_off to players that support it (feature 256); players that cannot be switched off (Sonos with a TV input) are paused instead. Fixes "does not support action media_player.turn_off" errors.

## 1.1.23 — 2026-11-22

- PivIT ELAN Security: the Home Security row opens an ELAN pop-up (`#security-<alarm>`) with Home Assistant's alarm panel — Arm Home / Arm Away (from the alarm's supported features) / Disarm, and a keypad whenever the alarm requires a code. Alarm colours in the ELAN palette (disarmed blue, armed/triggered red).

## 1.1.22 — 2026-11-22

- PivIT ELAN climate: current temperatures and setpoints display as the nearest whole degree (was nearest 0.5°), including the value shown straight after an arrow tap.

## 1.1.21 — 2026-11-22

- PivIT ELAN climate: arrow taps now show in the setpoint box immediately (the row looked for its boxes inside the ha-card; they live in the Bubble Card shadow root) and the new value stays until the thermostat reports it back or 90 s pass — Daikin units only report about once a minute. Further taps build on the shown value; cool/heat selection outline appears at once.

## 1.1.19–1.1.20 — 2026-11-22

- PivIT ELAN Climate screen rebuilt like the ELAN climate screen (elanClimateRow): name + action subtitle, big current temperature, setpoint block with cool (navy) over heat (dark red) for two-setpoint zones or one tall box with the mode ("Heat 70°") for single-setpoint zones, grey ▲ / ▼, ›. Tap cool or heat to choose which the arrows change (white outline; cool by default). Arrow taps update the box at once and are combined into one climate.set_temperature 0.8 s after the last tap (clamped to min/max, target_temp_step). Off zones dim the arrows. Row/name/› open the thermostat pop-up. Phones: compact block, no ›.

## 1.1.18 — 2026-11-22

- PivIT ELAN Security: gold padlock icons on the LOCK (closed) and UNLOCK (open) buttons, as on the ELAN security screen; buttons widened to 112px (74px on phones, smaller icon and text).

## 1.1.15–1.1.17 — 2026-11-22

- PivIT ELAN pop-ups: panel opens in ELAN night-sky navy (it was grey: Bubble paints .bubble-pop-up-background from --bubble-pop-up-main-background-color, which had been set to the light row colour). ELAN palette inside pop-ups: heat red #d23c3c, cool/auto/active/on ELAN blue (thermostat dial and mode buttons, light/fan/switch fills, toggles); pop-up sliders fill ELAN blue instead of the bulb colour.

## 1.1.14 — 2026-11-22

- PivIT ELAN: slider fills were still pill-rounded inside the squared rows (Bubble clips the fill with --bubble-button-border-radius, which the rows did not set). ELAN rows and pop-ups now set the Bubble corner variables to 6px (4px for sub-sliders/selects), so slider track and fill match the row.

## 1.1.12–1.1.13 — 2026-11-22

- PivIT ELAN pool/spa: setpoint − / + now shown on phones (water temperature moves into the subtitle); tapping a panel opens the full thermostat; setpoint box red.

## 1.1.7–1.1.11 — 2026-11-22

- PivIT ELAN review pass at iPad landscape, iPad portrait (820px) and phone (390px): pop-ups re-skinned for ELAN (navy panel, squarer corners, visible rows) via cascading Bubble/HA card variables; below 1000px the menu becomes a bar of square icon buttons that fits all 8 pages (phones too) and content goes full width; phone sizing for rows, LOCK/UNLOCK, climate (setpoints hidden, row opens thermostat), pool panels/toggles; room-title descenders.

## 1.1.5–1.1.6 — 2026-11-22

- PivIT ELAN pool/spa: big water temperature beside the setpoint. Home date separator "·" (Bubble Card drops the space after a comma).

## 1.1.4 — 2026-11-22

- PivIT ELAN: lighting room pages (subviews `lighting-<room>`): "◀ Room ▶" switcher, a wide slider per dimmer, on/off loads and fans, room scenes/scripts as buttons, wide dark-red "<Room> All Off" (only what is on). Lighting rows open them.
- PivIT ELAN: pool/spa page for extra views holding pool/spa thermostats: one panel per body (big water temperature, red heat setpoint −/+, heater toggle), pumps/lights/features as large toggles (blue when on), other readings as rows.

## 1.1.1–1.1.3 — 2026-11-22

- PivIT ELAN: menu and page side by side in one full-width section (menu hides below 1000px, bottom nav instead); titles and Home clock drawn with Bubble Card (HA markdown strips styles); dark climate rows with red heat / blue cool setpoints; LOCK/UNLOCK text-only segments; extra-view duplicate heading dropped.

## 1.1.0 — 2026-11-22

- New **PivIT ELAN** template (`strategy: type: custom:pivit-elan`), modelled on the ELAN g!/ELAN 8 touch-panel UI: translucent subsystem menu on the left (Home, Security, Climate, Lighting, Media, Irrigation, Video, Pool…), centred page titles, translucent zone rows with big status values. Uses the same options and devices as PivIT Home and reuses its pop-ups. The PivIT Home (Savant-style) template is unchanged.

## 1.0.63 — 2026-11-20

- New `shared_entities` option (`{ <area_id>: [entity ids] }`): show a device in another room as well, e.g. one Sonos amp covering the kitchen and dining room.

## 1.0.62 — 2026-11-20

- Room pop-ups: HVAC thermostats (that can cool) are listed before heat-only climate devices such as fireplaces; the room tile temperature prefers them too.
- Room pop-ups: door unlock buttons (e.g. UniFi Access "… Unlock") move into the title bar as a door-lock icon (tap → confirm → unlock); door/window/motion sensors are no longer listed in the pop-up (they show on the room card when open/active).
- TVs are also recognised by device model (e.g. Cast "Smart TV Pro"), so they no longer show up as speakers.

## 1.0.61 — 2026-11-20

- New `nav_order` option: order of the pages (bottom menu and top tabs) by page id / extra-view path.

## 1.0.60 — 2026-11-20

- `summaries` `spacer_before`: the spacer only shows on screens ≥ 768 px, so narrow screens no longer get an extra gap above the button.

## 1.0.59 — 2026-11-20

- New `summaries` option: extra Home-row buttons that work like Lights/Locks/Climate — a live "N running"-style count (`entities`, `on_states`, `on_word`, `off_text`) and a tap that opens a pop-up with the given `cards` (plus any extra `popups`). `spacer_before` leaves the left slot empty so the button sits in the right column.

## 1.0.58 — 2026-11-20

- Media page uses the Mediocre cards too when `audio_card: mediocre` (speakers with grouping/browse/Play TV Audio; TVs as plain Mediocre cards).

## 1.0.57 — 2026-11-20

- Floating corner alarm button removed by default (`corner_alarm: true` brings it back).
- Room pop-ups: the door lock moves from the body into the title bar, before *All Off* — a green lock when all locked, red open lock when any is unlocked; tapping it opens the room's Locks pop-up.

## 1.0.56 — 2026-11-20

- Mediocre speaker card: tapping it no longer opens the big player (`tap_opens_popup: false`). Album-art colours stay on.

## 1.0.55 — 2026-11-20

- Audio pop-ups back to the standard Mediocre card (the Massive card was too large). The `massive` parameter stays available in code but is unused.

## 1.0.54 — 2026-11-20

- With `audio_card: mediocre`, the room Audio pop-ups (speaker icon) use the Mediocre **Massive** card, which always shows the volume slider; room pop-ups keep the standard card.

## 1.0.53 — 2026-11-20

- New `audio_card: mediocre` option: speakers in the Audio and room pop-ups use the [Mediocre Media Player Card](https://github.com/antontanderup/mediocre-hass-media-player-cards) (art colours, tap for the big player, grouping with every room speaker, media browser, volume steps, *Play TV Audio* as a custom button). Requires that card to be installed.

## 1.0.52 — 2026-11-20

- Room tiles: motion and open door/window alerts are yellow icons in the top-left corner (in line with the temperature) instead of a line under the name. The motion icon shows only if motion/occupancy was detected in the last 5 minutes. Tapping any alert opens *<Room> Activity* (3-hour history of the room's motion and door/window sensors).
- Larger room names (16 px) and temperatures (15 px).

## 1.0.51 — 2026-11-20

- Room tiles: the motion icon no longer overlaps the room name when no door/window is open.

## 1.0.50 — 2026-11-20

- Room *All Off* also turns off TVs that are on and pauses speakers that are playing.
- Lock cards: no fill; the lock icon is red when unlocked and green when locked.
- Intercom status: closed-gate / open-gate icons with the Closed/Open text (yellow while open).
- Room tiles: motion/occupancy shows as a yellow person (motion-sensor) icon under the room name instead of text; open doors/windows stay as text next to it.

## 1.0.49 — 2026-11-20

- *All Off* / *Lock All* moved into the pop-up title bar (Lights On, room pop-ups, room lights pop-ups, Locks). They still act only on what is on/unlocked at the moment of the tap; Lights On and Locks still confirm.

## 1.0.48 — 2026-11-20

- Bottom page menu shows icons only on phone-width screens (≤ 600 px) so all pages fit.

## 1.0.47 — 2026-11-20

- Room pop-ups: climate and locks sit above *All Off* (which only turns off lights, switches and fans); below it the order is lights, fans, shades, TV, audio, then anything else.

## 1.0.46 — 2026-11-20

- Button fills: instead of colouring the whole button, only the round icon is filled, in the same colours as before (lights yellow, unlocked red / locked blue, Held Open and Play TV Audio yellow, other switches their usual state colour).

## 1.0.45 — 2026-11-20

- Room Locks pop-up keeps each lock's full name (e.g. "Office Door", not "Door").

## 1.0.44 — 2026-11-20

- Lights / Locks / Climate buttons: the count is display-only (no separate clickable chevron); the whole button opens the pop-up.
- `climate_zones` entries can be `{ entity, name }` to rename a zone in the Climate pop-up.
- Locks pop-up lists **all** locks, unlocked ones first; *Lock all* → **Lock All Unlocked** (locks only those unlocked, with confirmation). Tapping a locked door unlocks it after confirmation.
- Room tiles:
  - Under the room name, any open door/window or detected motion/occupancy shows in yellow (e.g. "Front Door open · Motion"); nothing shows when all is quiet (`room_status_classes`).
  - The lock icon now reflects the room's locks only (`room_lock_platforms`, e.g. `["schlage"]`): closed-lock icon when all locked, yellow open-lock icon when any is unlocked; tapping opens *<Room> Locks* (Lock All Unlocked when there are several). The door/window icons and Doors & Windows pop-up are replaced by the status line.
  - Audio is now the left-most icon (order right→left: lights, fan, lock, TV, audio).
  - What's playing (title — artist) scrolls along the bottom, left of the icons.

## 1.0.43 — 2026-11-20

- Room tiles: the audio icon is always a speaker (it was showing the album art while playing).

## 1.0.42 — 2026-11-20

- Room tiles: ceiling-fan icon for rooms with fans (next to the lights icon; yellow while any fan is on). Tapping it opens *<Room> Fans* with speed and direction controls. The lights icon no longer stands in for fans.

## 1.0.41 — 2026-11-20

- New `hide_room_tiles` option: hide a room's tile on the Rooms page while its devices still count in Lights/Locks, Security, etc. (unlike `hide_areas`).

## 1.0.40 — 2026-11-20

- Rooms page Home row:
  - *All Lights Off* → **Lights** with a live "N on" / "All off" status; tapping opens the Lights On pop-up.
  - *Lock All Doors* → **Locks** with "N unlocked" / "All locked"; tapping opens the Unlocked Doors pop-up.
  - New `climate_zones` option → **Climate** button with a live status ("2 cooling", "1 heating · 1 cooling", "Idle"); tapping opens a pop-up with every zone's thermostat controls. Those zones are no longer listed as separate quick buttons.

## 1.0.39 — 2026-11-20

- Room pop-ups show speakers the same way as the Audio pop-up (album-art player, volume slider, Play TV Audio).

## 1.0.38 — 2026-11-20

- Room Audio pop-up: speakers with a "TV" input (e.g. Sonos soundbars) get a *Play TV Audio* button under the volume slider that switches the source to TV; it turns yellow while TV is the source.

## 1.0.37 — 2026-11-20

- Intercom `status_sensor` option: an Open/Closed indicator (yellow while open) in the pop-up header and on the intercom button on the Rooms page.

## 1.0.36 — 2026-11-20

- Intercom pop-up: *Open <name>* and *Hold Open* sit side by side on one row.

## 1.0.35 — 2026-11-20

- Intercom pop-up: *Open <name>* no longer asks to confirm (set `unlock_confirm: true` to bring it back). *Hold Open* is full width and asks to confirm; while held it becomes a yellow *Held Open - Press to Cancel* button that ends the hold. The separate *Close Gate* button is now optional (`close_button: true`).

## 1.0.34 — 2026-11-20

- Intercom pop-up: time-picker label shortened to "Until" so it isn't truncated.

## 1.0.33 — 2026-11-20

- Intercom pop-up: *Hold open until* a chosen time (`hold_until_entity` time picker + `hold_until_script`, with confirmation), and an *Open until* line (`hold_end_sensor`) while a timed hold is active. *Hold Open* is highlighted for both indefinite and timed holds.

## 1.0.32 — 2026-11-20

- Intercom pop-up: *Back to Normal* renamed *Close Gate* (override with `normal_name`).

## 1.0.31 — 2026-11-20

- Intercom pop-up: the unlock button now reads *Open <name>*; new `lock_rule` option adds *Hold Open* (e.g. UniFi Access `keep_unlock`, with confirmation; highlighted while held) and *Back to Normal* (`reset`).

## 1.0.30 — 2026-11-20

- Intercom pop-up video is cropped to 4:3 (override with `aspect_ratio`) so portrait intercom cameras don't push the buttons off screen.

## 1.0.29 — 2026-11-20

- New `intercoms` option. Each intercom gets a pop-up on every page — live camera (tap for full view/audio), Unlock (with confirmation), one-tap spoken messages via TTS to the intercom speaker, and a typed message + *Say* — plus a button in the Rooms page Home row. With `ring_entity`, the pop-up opens by itself when that entity turns on (e.g. from a doorbell automation) and closes when it turns off.

## 1.0.28 — 2026-11-20

- Room Audio pop-up: each speaker shows HA's media-control card (full album art, title/artist, transport controls) with a volume slider underneath.

## 1.0.27 — 2026-11-20

- Tapping a temperature on a room tile (or the Thermostat quick button) opens that unit's thermostat controls in a pop-up: dial, HVAC modes, and fan modes when supported.

## 1.0.26 — 2026-11-20

- Room tile icons each open their own pop-up:
  - **Doors/windows** → *<Room> Doors & Windows* (that room's door/window sensors and locks).
  - **Audio** → *<Room> Audio* (a media-player card per speaker).
  - **TV** → *<Room> TV* remote: Power, the TV's media card, and — when a `remote.*` entity exists for the TV (same device, or same room) — a d-pad with OK, Back, Home and volume −/mute/+. Power uses the remote when there is one, otherwise the media player. Remote command names adapt to Android TV Remote, Apple TV, Roku, LG webOS and Samsung.

## 1.0.25 — 2026-11-20

- Tapping the lights icon on a room tile opens a pop-up with just that room's lights (plus *All Off* when there are several) instead of the whole room pop-up.

## 1.0.24 — 2026-11-20

- Fix: room tile temperature now actually sits in the top-right corner (it was being positioned inside the bottom icon row).

## 1.0.23 — 2026-11-20

- Room tile layout: temperature in the top-right corner; the other icons in one row along the bottom, starting bottom-right and running left, with the lights icon furthest right.

## 1.0.22 — 2026-11-20

- New `room_thermostats` option: per-room override of the tile temperature (a climate id, or `none` to hide it), e.g. to leave the attic out of the upstairs temperature.

## 1.0.21 — 2026-11-20

- New `floor_thermostats` option (`{ <floor_id>: climate.x }`): room tiles on that floor that have no thermostat of their own show that thermostat's temperature (with the cooling/heating colour).

## 1.0.20 — 2026-11-20

- Lights that are on show in the standard light yellow in all pop-ups (Lights On and room pop-ups) instead of blue / each bulb's own colour.

## 1.0.19 — 2026-11-20

- Room tile "on" highlights (open door/window, lights on, speaker playing, TV on) use the theme accent colour (yellow-orange) instead of blue. Temperature colours unchanged.

## 1.0.18 — 2026-11-20

- Room tiles: an open door/window icon is shown in the accent blue, the light icon turns accent blue while any light in the room is on, the audio icon turns accent blue while a speaker in the room is playing, and a separate TV icon (rooms with a TV) turns accent blue while the TV is on. The room temperature shows blue while the AC is cooling and orange while heating.

## 1.0.17 — 2026-11-20

- *All Lights Off*, *Lock All Doors*, and the pop-ups' *Turn all off* / *Lock all* now act only on the lights that are on / doors that are unlocked at the moment of the tap, and the confirmation shows that live count (e.g. "Lock 7 doors?"). Nothing on/unlocked → the tap does nothing.

## 1.0.16 — 2026-11-20

- *Turn all off* (Lights On pop-up) and *Lock all* (Unlocked Doors pop-up) now ask for confirmation before acting.

## 1.0.15 — 2026-11-19

- Lock All Doors gets the same treatment as All Lights Off: a live "N unlocked ›" count that opens an *Unlocked Doors* pop-up listing only unlocked doors (with their room), each lockable on its own, plus *Lock all*.

## 1.0.14 — 2026-11-19

- Lights On pop-up uses the standard accent blue for lights that are on, instead of each light's own colour.

## 1.0.13 — 2026-11-19

- Alarm corner icon is centered in its circle.

## 1.0.12 — 2026-11-19

- Alarm is now an icon-only round button pinned to the top-right corner of the Rooms page (icon reflects armed/disarmed; tap opens Security) instead of a card in the header row.

## 1.0.11 — 2026-11-19

- Lights-on count reads "5 on ›" (count before the arrow).

## 1.0.10 — 2026-11-19

- The "N on" count on All Lights Off is now its own button: tapping it opens a *Lights On* pop-up listing only the lights that are on (with their room), each controllable on its own, plus *Turn all off*.

## 1.0.9 — 2026-11-19

- All Lights Off shows a live count of lights that are on (e.g. "3 on"), right-aligned in the button; hidden when none are on.

## 1.0.8 — 2026-11-19

- Room tiles show door/window status: an open icon for each open door or window, or a closed-lock icon when everything in the room is shut. Tapping it opens the Security page. New `room_openings` option.

## 1.0.5 / 1.0.6 — 2026-11-19

- The Alarm button moved from the Home row up into the header row, next to the outside weather.
- Outside weather and Alarm buttons are the same width as the Home-row buttons below them; the clock/greeting takes its own row and the Alarm lines up with the third column.

## 1.0.4 — 2026-11-19

- Bottom navigation bar now sizes itself to the number of pages (`nav_width: auto`, the new default) so extra pages don't get cut off.

## 1.0.3 — 2026-11-19

- New **Security** page: alarm panels with arm/disarm buttons, plus door, window, motion, smoke and CO sensors grouped by room. Shown only when the home has an alarm panel or such sensors.
- Home row gets an Alarm button (shows state, opens the Security page).
- New options: `security_classes`, `alarm_modes`; `pages` default now includes `security`.

## 1.0.2 — 2026-11-19

- New `extra_entities` option: put specific entities (e.g. UniFi Access door unlock buttons and door sensors) into their rooms even when their type or integration is normally excluded. Buttons press after a confirmation; sensors show their state.

## 1.0.1 — 2026-11-19

- New `main_thermostat` option picks the thermostat shown in the Home row.
- Thermostats on the Climate page use `entity_names`.
- Homes with many locks: above `max_quick_locks` (default 4) the Home row shows one *Lock All Doors* button with confirmation instead of a button per lock.

## 1.0.0 — 2026-11-19

- First release of the `custom:pivit-home` dashboard strategy.
- Pages: Rooms (clock, greeting, weather, Home row, room tiles with Bubble Card room pop-ups), Climate, Cameras, Media, plus `extra_views`; fixed bottom navigation bar.
- Options: `name`, `title`, `room_order`, `hide_areas`, `room_names`, `room_icons`, `room_images`, `hide_entities`, `entity_names`, `exclude_platforms`, `room_domains`, `weather_entity`, `all_lights_off`, `all_lights_confirm`, `quick_actions`, `alerts`, `pages`, `extra_views`, `nav_width`, `background`.
