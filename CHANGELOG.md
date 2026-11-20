# Changelog

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
