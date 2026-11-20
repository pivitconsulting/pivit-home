# Changelog

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
