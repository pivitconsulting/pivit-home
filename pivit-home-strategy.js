/*
 * PivIT Home — a Savant-style touchscreen dashboard for Home Assistant.
 *
 * A dashboard strategy: it builds the whole dashboard from the home's areas,
 * devices and entities every time the dashboard opens, so the same file works
 * in any house. Requires Bubble Card (https://github.com/Clooos/Bubble-Card).
 *
 * Use it by creating a new dashboard and setting its raw configuration to:
 *
 *   strategy:
 *     type: custom:pivit-home
 *
 * Every option is optional; see README.md.
 */

const VERSION = "1.1.10";

const DEFAULTS = {
  title: "Home",
  name: null, // name in the greeting, e.g. "Will"
  room_order: [], // area_ids shown first, in this order
  hide_areas: [], // area_ids never shown
  room_names: {}, // area_id -> display name
  room_icons: {}, // area_id -> mdi icon
  room_images: {}, // area_id -> image URL for the room tile background
  hide_entities: [], // entity_ids never shown
  extra_entities: [], // entity_ids added to their room even if their type or integration is normally left out (e.g. door unlock buttons)
  entity_names: {}, // entity_id -> display name on the dashboard
  exclude_platforms: ["unifi", "unifiprotect", "synology_dsm", "hassio", "nut", "backup", "ibeacon", "mobile_app"],
  room_domains: ["climate", "media_player", "cover", "light", "fan", "switch", "lock", "vacuum"],
  weather_entity: null, // auto-detected when not set
  all_lights_off: true,
  all_lights_confirm: true,
  quick_actions: [], // extra entity_ids for the "Home" row
  main_thermostat: null, // climate entity for the Home row (first thermostat when not set)
  max_quick_locks: 4, // above this many locks, show one "Lock All Doors" button instead of each lock
  alerts: [], // [{ entity, above, below, state, name, icon }]
  pages: ["rooms", "climate", "security", "cameras", "media"],
  security_classes: ["smoke", "carbon_monoxide", "gas", "moisture", "safety", "door", "garage_door", "window", "opening", "motion", "occupancy"], // binary sensor types on the Security page
  alarm_modes: ["armed_home", "armed_away", "disarmed"],
  room_status_classes: ["door", "garage_door", "window", "opening", "motion", "occupancy", "presence"], // shown under the room name while open/detected
  room_lock_platforms: null, // e.g. ["schlage"]: only these locks drive the room-tile lock icon (null = all locks)
  // Extra Home-row summary buttons: [{ name, icon, hash, entities, on_states, on_word, off_text, cards, popups, spacer_before }]
  summaries: [],
  nav_order: [], // e.g. ["rooms","media","pool","cameras","security"]: page / extra-view order in the bottom menu and tabs
  shared_entities: {}, // { <area_id>: [entity ids] } — also show these in that room (e.g. a Sonos amp shared by two rooms)
  corner_alarm: false, // true: round alarm button pinned to the top-right corner of the Rooms page
  audio_card: "default", // "mediocre" uses the Mediocre Media Player Card for speakers (install it from HACS/Marketplace first)
  hide_room_tiles: [], // area ids whose tile is hidden on the Rooms page (their devices still count everywhere else)
  climate_zones: [], // climate entities summarised by the Rooms-page "Climate" button (opens all their controls)
  floor_thermostats: {}, // { <floor_id>: climate.x } — rooms on that floor without their own thermostat show its temperature
  room_thermostats: {}, // { <area_id>: climate.x | "none" } — per-room override of the temperature shown ("none" hides it)
  room_openings: ["door", "garage_door", "window", "opening"], // sensor types summarised on each room tile ([] to turn off)
  extra_views: [], // full Lovelace view configs, appended after the built-in pages
  // Intercoms / gate stations. Each gets a pop-up (#<slug of name>) on every page: live video, unlock, spoken messages.
  // { name, camera, unlock, unlock_name, speaker, tts, messages: [..], message_entity: input_text.x, say_script: script.x, ring_entity: input_boolean.x,
  //   lock_rule: select.x (hold open), lock_rule_sensor, hold_option: "keep_unlock", normal_option: "reset", normal_name,
  //   hold_until_entity: input_datetime.x (time), hold_until_script: script.x, hold_end_sensor: sensor.x (timestamp),
  //   status_sensor: binary_sensor.x (open/closed indicator) }
  // ring_entity: when it turns "on" the pop-up opens by itself (and closes when it turns off).
  intercoms: [],
  nav_width: "auto", // "auto" sizes the bottom bar to the number of pages, or set e.g. "940px"
  background:
    "center / cover no-repeat fixed radial-gradient(circle at 20% 0%, #2a2f3a 0%, #121418 55%, #0b0c0f 100%)",
};

const PAGE_META = {
  rooms: { name: "Rooms", icon: "mdi:home-outline" },
  climate: { name: "Climate", icon: "mdi:thermostat" },
  security: { name: "Security", icon: "mdi:shield-home" },
  cameras: { name: "Cameras", icon: "mdi:cctv" },
  media: { name: "Media", icon: "mdi:speaker-multiple" },
};

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const domainOf = (id) => id.split(".")[0];

class PivitHomeStrategy extends HTMLElement {
  static async generate(userConfig, hass) {
    const cfg = { ...DEFAULTS, ...(userConfig || {}) };
    NAMES = cfg.entity_names || {};
    AUDIO_CARD = cfg.audio_card || "default";
    const ctx = buildContext(cfg, hass);
    SPEAKERS = ctx.rooms.flatMap((r) => roomMediaSplit(r, hass).audio);

    const pages = cfg.pages.filter((p) => {
      if (p === "climate") return ctx.climates.length > 0;
      if (p === "security") return ctx.alarms.length > 0 || ctx.securityByRoom.length > 0;
      if (p === "cameras") return ctx.cameras.length > 0;
      if (p === "media") return ctx.mediaByRoom.length > 0;
      return p === "rooms";
    });

    const extra = (cfg.extra_views || []).map((v) => ({
      ...v,
      path: v.path || slug(v.title || "view"),
    }));

    // Optional nav_order: page ids / extra-view paths in the order they should appear (others follow).
    const rank = (path) => {
      const i = (cfg.nav_order || []).indexOf(path);
      return i < 0 ? 999 : i;
    };
    const navItems = [
      ...pages.map((p) => ({ ...PAGE_META[p], path: p })),
      ...extra.map((v) => ({ name: v.title, icon: v.icon || "mdi:view-dashboard", path: v.path })),
    ]
      .map((it, i) => [it, i])
      .sort((a, b) => rank(a[0].path) - rank(b[0].path) || a[1] - b[1])
      .map(([it]) => it);
    const base = ctx.basePath;
    const nav = navCard(navItems, base, cfg.nav_width);

    const views = [];
    for (const p of pages) {
      if (p === "rooms") views.push(roomsView(cfg, ctx, nav));
      if (p === "climate") views.push(climateView(cfg, ctx, nav));
      if (p === "security") views.push(securityView(cfg, ctx, nav));
      if (p === "cameras") views.push(camerasView(cfg, ctx, nav));
      if (p === "media") views.push(mediaView(cfg, ctx, nav));
    }
    for (const v of extra) {
      const sections = [...(v.sections || []), { type: "grid", column_span: v.max_columns || 3, cards: [nav] }];
      views.push({ background: cfg.background, type: "sections", ...v, sections });
    }
    // Views (top tabs) follow the same order; Rooms stays first unless nav_order says otherwise.
    if ((cfg.nav_order || []).length) views.sort((a, b) => rank(a.path) - rank(b.path));
    // Intercom pop-ups go on every page so a ring can open them wherever the iPad is.
    if ((cfg.intercoms || []).length)
      for (const v of views) v.sections = [...(v.sections || []), { type: "grid", cards: cfg.intercoms.map(intercomPopup) }];
    return { title: cfg.title, views };
  }
}

/* ------------------------------------------------------------------ */
/* Reading the home                                                    */
/* ------------------------------------------------------------------ */

function buildContext(cfg, hass) {
  const areas = Object.values(hass.areas || {});
  const devices = hass.devices || {};
  const entities = hass.entities || {};
  const hidden = new Set(cfg.hide_entities);
  const exclude = new Set(cfg.exclude_platforms);

  const areaOf = (e) => e.area_id || (e.device_id && devices[e.device_id] ? devices[e.device_id].area_id : null);

  const usable = (e) => {
    const st = hass.states[e.entity_id];
    if (!st) return false;
    if (e.hidden || e.hidden_by || e.entity_category) return false;
    if (hidden.has(e.entity_id)) return false;
    if (exclude.has(e.platform)) return false;
    return true;
  };

  const all = Object.values(entities).filter(usable);
  const byArea = {};
  for (const e of all) {
    const a = areaOf(e);
    if (!a) continue;
    (byArea[a] = byArea[a] || []).push(e.entity_id);
  }

  const order = (list) => {
    const first = cfg.room_order.filter((id) => list.some((a) => a.area_id === id));
    const rest = list
      .filter((a) => !first.includes(a.area_id))
      .sort((x, y) => x.name.localeCompare(y.name));
    return [...first.map((id) => list.find((a) => a.area_id === id)), ...rest];
  };

  const roomDomains = new Set(cfg.room_domains);
  const extras = (cfg.extra_entities || []).filter((id) => hass.states[id] && !hidden.has(id));
  const extraArea = {};
  for (const id of extras) if (entities[id]) extraArea[id] = areaOf(entities[id]);
  const rooms = order(areas.filter((a) => !cfg.hide_areas.includes(a.area_id)))
    .map((a) => {
      const ents = (byArea[a.area_id] || []).filter((id) => roomDomains.has(domainOf(id)));
      for (const id of extras) if (extraArea[id] === a.area_id && !ents.includes(id)) ents.push(id);
      // shared_entities: also show these entities in this room (e.g. one Sonos amp covering two rooms).
      for (const id of (cfg.shared_entities || {})[a.area_id] || []) if (hass.states[id] && !ents.includes(id)) ents.push(id);
      return {
        id: a.area_id,
        name: cfg.room_names[a.area_id] || a.name,
        icon: cfg.room_icons[a.area_id] || a.icon || "mdi:home",
        image: cfg.room_images[a.area_id] || a.picture || null,
        floor: a.floor_id || null,
        entities: sortEntities(ents),
      };
    })
    .filter((r) => r.entities.length > 0);

  const roomOf = {};
  for (const r of rooms) for (const id of r.entities) roomOf[id] = r;

  // Cameras: every usable camera, whether or not it has an area.
  const cameras = Object.values(entities)
    .filter((e) => domainOf(e.entity_id) === "camera" && hass.states[e.entity_id] && !e.hidden && !e.hidden_by && !hidden.has(e.entity_id))
    .map((e) => e.entity_id);

  const climates = all.filter((e) => domainOf(e.entity_id) === "climate").map((e) => e.entity_id);

  const mediaByRoom = rooms
    .map((r) => ({ room: r, players: r.entities.filter((id) => domainOf(id) === "media_player") }))
    .filter((x) => x.players.length);

  const lights = rooms.flatMap((r) => r.entities.filter((id) => domainOf(id) === "light"));

  // Security: alarm panels and door/window/motion/smoke sensors, grouped by area.
  const alarms = all.filter((e) => domainOf(e.entity_id) === "alarm_control_panel").map((e) => e.entity_id);
  const classes = cfg.security_classes || [];
  const secByArea = {};
  for (const e of all) {
    if (domainOf(e.entity_id) !== "binary_sensor") continue;
    const dc = hass.states[e.entity_id].attributes.device_class;
    if (!classes.includes(dc)) continue;
    const a = areaOf(e) || "_none";
    if (cfg.hide_areas.includes(a)) continue;
    (secByArea[a] = secByArea[a] || []).push(e.entity_id);
  }
  const classRank = (id) => {
    const i = classes.indexOf(hass.states[id].attributes.device_class);
    return i < 0 ? 99 : i;
  };
  const areaName = (id) => (id === "_none" ? "Other" : cfg.room_names[id] || (hass.areas[id] || {}).name || id);
  const roomIndex = (id) => {
    const i = rooms.findIndex((r) => r.id === id);
    return i < 0 ? 999 : i;
  };
  const securityByRoom = Object.entries(secByArea)
    .map(([id, sensors]) => ({ id, name: areaName(id), sensors: sensors.sort((a, b) => classRank(a) - classRank(b) || a.localeCompare(b)) }))
    .sort((a, b) => roomIndex(a.id) - roomIndex(b.id) || a.name.localeCompare(b.name));

  const weather =
    cfg.weather_entity || Object.keys(hass.states).find((id) => domainOf(id) === "weather") || null;

  const basePath = "/" + (window.location.pathname.split("/")[1] || "lovelace");

  return { hass, rooms, roomOf, cameras, climates, mediaByRoom, lights, weather, basePath, alarms, securityByRoom };
}

function sortEntities(ids) {
  const rank = { climate: 0, media_player: 1, cover: 2, lock: 3, binary_sensor: 3, button: 3, vacuum: 4, light: 5, fan: 6, switch: 7 };
  return [...ids].sort((a, b) => (rank[domainOf(a)] ?? 9) - (rank[domainOf(b)] ?? 9) || a.localeCompare(b));
}

const isDimmable = (hass, id) => {
  const st = hass.states[id];
  return !!st && domainOf(id) === "light" && (st.attributes.supported_color_modes || []).some((m) => m !== "onoff");
};

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function navCard(items, base, width) {
  const card = {
    type: "custom:bubble-card",
    card_type: "horizontal-buttons-stack",
    auto_order: false,
    width_desktop: width && width !== "auto" ? width : `${Math.max(540, items.length * 160)}px`,
    // Phones: icons only, centred, so every page button fits on screen.
    styles:
      "@media (max-width: 600px) { .bubble-name { display: none !important; }" +
      " .horizontal-buttons-stack-container { display: flex !important; justify-content: center !important; gap: 8px !important; }" +
      " .bubble-button { position: relative !important; transform: none !important; left: auto !important; width: 52px !important; min-width: 52px !important;" +
      " padding: 0 !important; justify-content: center !important; } .bubble-icon { margin: 0 !important; } }",
  };
  items.forEach((it, i) => {
    card[`${i + 1}_name`] = it.name;
    card[`${i + 1}_icon`] = it.icon;
    card[`${i + 1}_link`] = `${base}/${it.path}`;
  });
  return card;
}

function action(tap) {
  // Bubble Card buttons use button_action for the card body and tap_action for the icon.
  return { tap_action: tap, button_action: { tap_action: tap } };
}

let NAMES = {};
let AUDIO_CARD = "default"; // "default" (HA media-control + volume) or "mediocre" (Mediocre Media Player Card)
let SPEAKERS = []; // every room speaker, for grouping in the Mediocre card

// Fills: instead of colouring the whole button, only the round icon behind the symbol is filled.
// ICON_FILL keeps Bubble Card's own state colour (e.g. red unlocked / blue locked): Bubble puts it in
// --bubble-button-background-color and fades in .bubble-button-background when "on"; we hide that layer and
// paint the icon circle with the same colour whenever the layer would have been visible.
const ICON_FILL =
  ".bubble-button-background { opacity: 0 !important; }" +
  " .bubble-button-background[style*='opacity']:not([style*='opacity: 0;']) ~ .bubble-content-container .bubble-main-icon-container" +
  " { background-color: var(--bubble-button-background-color) !important; }" +
  " .bubble-button-background[style*='opacity']:not([style*='opacity: 0;']) ~ .bubble-content-container .bubble-icon { color: #fff !important; }";

// Fill only the icon circle with `color` while `cond` (a JS expression evaluated by Bubble) is true.
function iconFillWhen(cond, color, iconColor = "#1c1c1c") {
  return (
    ".bubble-button-background { opacity: 0 !important; }" +
    " .bubble-main-icon-container { background-color: ${" + cond + " ? '" + color + "' : ''} !important; }" +
    " .bubble-icon { color: ${" + cond + " ? '" + iconColor + "' : ''} !important; }"
  );
}

// Lights that are on: the icon circle is filled with HA's standard light yellow.
const LIGHT_ON_STYLES = iconFillWhen("state === 'on'", "var(--state-light-active-color, #ffc107)");

function entityCard(hass, id, opts = {}) {
  const card = baseEntityCard(hass, id, opts);
  if (NAMES[id]) card.name = NAMES[id];
  if (card.type === "custom:bubble-card" && card.card_type === "button")
    card.styles = ((card.styles || "") + " " + (domainOf(id) === "light" ? LIGHT_ON_STYLES : ICON_FILL)).trim();
  return card;
}

function baseEntityCard(hass, id, opts = {}) {
  const d = domainOf(id);
  const full = { grid_options: { columns: "full" } };
  if (d === "media_player") return { type: "custom:bubble-card", card_type: "media-player", entity: id, ...full };
  if (d === "climate") return { type: "custom:bubble-card", card_type: "climate", entity: id, ...full };
  if (d === "cover") return { type: "custom:bubble-card", card_type: "cover", entity: id, ...full };
  if (d === "vacuum" || d === "lock")
    return { type: "tile", entity: id, ...full };
  if (d === "button") {
    const label = NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id;
    return {
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      entity: id,
      show_state: false,
      grid_options: { columns: opts.half ?? 6 },
      ...action({ action: "perform-action", perform_action: "button.press", target: { entity_id: id }, confirmation: { text: `${label}?` } }),
    };
  }
  if (d === "binary_sensor" || d === "sensor")
    return { type: "custom:bubble-card", card_type: "button", button_type: "state", entity: id, show_state: true, grid_options: { columns: opts.half ?? 6 }, ...action({ action: "more-info" }) };
  if (isDimmable(hass, id))
    return { type: "custom:bubble-card", card_type: "button", button_type: "slider", entity: id, show_state: true, grid_options: { columns: opts.half ?? 6 } };
  return { type: "custom:bubble-card", card_type: "button", button_type: "switch", entity: id, show_state: true, grid_options: { columns: opts.half ?? 6 } };
}

// Strip characters that would break a CSS content string.
const CSS_SAFE = ".replace(/[\"\\\\\\n]/g, \"'\")";

function roomTile(room, hass, span, statusSensors = [], locks = [], floorClimate = null) {
  const hash = "#" + slug(room.name);
  const nav = { action: "navigate", navigation_path: hash };
  const subs = [];
  const go = (h) => ({ action: "navigate", navigation_path: h });
  const firstLight = room.entities.find((id) => /^(light|switch)\./.test(id));
  const fans = roomFans(room);
  const { tvs, audio } = roomMediaSplit(room, hass);
  const media = audio[0];
  const tv = tvs[0];
  const climate =
    floorClimate === "none" ? null : roomClimates(room, hass)[0] || (floorClimate && hass.states[floorClimate] ? floorClimate : null);

  // Bottom row, built right → left: lights, fan, lock, TV, audio (audio furthest left).
  let lightIdx = 0, fanIdx = 0, lockedIdx = 0, unlockedIdx = 0, tvIdx = 0, mediaIdx = 0, climateIdx = 0;
  if (firstLight) {
    subs.push({ entity: firstLight, icon: "mdi:lightbulb-group", show_state: false, show_background: false, tap_action: go(hash + "-lights") });
    lightIdx = subs.length;
  }
  if (fans.length) {
    subs.push({ entity: fans[0], icon: "mdi:ceiling-fan", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-fans") });
    fanIdx = subs.length;
  }
  if (locks.length) {
    // Locked: the closed-door-lock icon. Any unlocked: a yellow open-lock icon. Either opens the room's Locks pop-up.
    subs.push({
      entity: locks[0], icon: "mdi:door-closed-lock", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-locks"),
      visibility: locks.map((id) => ({ condition: "state", entity: id, state_not: UNLOCKED_STATES })),
    });
    lockedIdx = subs.length;
    subs.push({
      entity: locks[0], icon: "mdi:lock-open-variant", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-locks"),
      visibility: [{ condition: "or", conditions: locks.map((id) => ({ condition: "state", entity: id, state: UNLOCKED_STATES })) }],
    });
    unlockedIdx = subs.length;
  }
  if (tv) {
    subs.push({ entity: tv, icon: "mdi:television", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-tv") });
    tvIdx = subs.length;
  }
  if (media) {
    subs.push({ entity: media, icon: "mdi:speaker", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-audio") });
    mediaIdx = subs.length;
  }
  // Top-left alert icons (in line with the temperature): a person icon when motion/occupancy was seen in the last
  // 5 minutes, then an icon per open door/window. Each shows only while relevant; tapping opens the room's activity history.
  const MOTION = ["motion", "occupancy", "presence"];
  const motionIds = statusSensors.filter((id) => MOTION.includes((hass.states[id] && hass.states[id].attributes.device_class) || ""));
  const openIds = statusSensors.filter((id) => !motionIds.includes(id));
  const OPEN_ICON = { door: "mdi:door-open", window: "mdi:window-open-variant", garage_door: "mdi:garage-open", opening: "mdi:square-rounded-outline" };
  const alerts = []; // [subIdx, showExpr]
  const recentMotion =
    "(" + JSON.stringify(motionIds) + ".some((e) => { const s = hass.states[e]; return s && (s.state === 'on' || Date.now() - new Date(s.last_changed).getTime() < 300000); }))";
  if (motionIds.length) {
    subs.push({ entity: motionIds[0], icon: "mdi:motion-sensor", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-activity") });
    alerts.push([subs.length, recentMotion]);
  }
  for (const id of openIds) {
    const dc = (hass.states[id] && hass.states[id].attributes.device_class) || "opening";
    subs.push({ entity: id, icon: OPEN_ICON[dc] || "mdi:door-open", show_icon: true, show_state: false, show_background: false, tap_action: go(hash + "-activity") });
    alerts.push([subs.length, "(hass.states['" + id + "'] && hass.states['" + id + "'].state === 'on')"]);
  }
  if (climate) {
    subs.push({ entity: climate, show_attribute: true, attribute: "current_temperature", show_icon: false, show_background: false, tap_action: go(thermostatHash(climate)) });
    climateIdx = subs.length;
  }

  const card = {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name: room.name,
    icon: room.icon,
    card_layout: "large-2-rows",
    sub_button: subs,
    grid_options: { columns: 3 * span, rows: 2 },
    ...action(nav),
  };
  const iconSel = (i) => `.bubble-sub-button-${i} .bubble-sub-button-icon, .bubble-sub-button-${i} ha-icon, .bubble-sub-button-${i} ha-state-icon`;
  // Icons turn the accent colour while any light is on / fan on / speaker playing / TV on.
  const live = (idx, ids, states) =>
    `${iconSel(idx)} { color: \${` +
    JSON.stringify(ids) + ".some((e) => hass.states[e] && " + JSON.stringify(states) + ".includes(hass.states[e].state))" +
    ` ? 'var(--accent-color)' : 'var(--primary-text-color)'} !important; } `;
  let styles = "";
  if (lightIdx) {
    const roomLightIds = room.entities.filter((id) => domainOf(id) === "light");
    styles += live(lightIdx, roomLightIds.length ? roomLightIds : [firstLight], ["on"]);
  }
  if (fanIdx) styles += live(fanIdx, fans, ["on"]);
  if (unlockedIdx) styles += `${iconSel(unlockedIdx)} { color: var(--accent-color) !important; } `;
  if (mediaIdx) styles += live(mediaIdx, audio, ["playing"]);
  if (tvIdx) styles += live(tvIdx, tvs, ["on", "playing", "paused", "idle", "buffering"]);
  if (climateIdx) {
    // Temperature text: blue while cooling, orange while heating, normal otherwise.
    const a = "(hass.states['" + climate + "'] && hass.states['" + climate + "'].attributes.hvac_action)";
    styles += `.bubble-sub-button-${climateIdx}, .bubble-sub-button-${climateIdx} * { color: \${${a} === 'cooling' ? 'var(--state-climate-cool-color, #2b9af9)' : ${a} === 'heating' ? 'var(--state-climate-heat-color, #ff8100)' : 'var(--primary-text-color)'} !important; } `;
  }
  // Layout: temperature pinned top-right; other icons in one row along the bottom from the right.
  if (subs.length) {
    styles +=
      ".bubble-sub-button-container { position: absolute !important; inset: 0 !important; display: grid !important; grid-template-columns: none !important;" +
      " grid-template-rows: none !important; grid-template-areas: none !important; grid-auto-flow: column !important; grid-auto-columns: max-content !important;" +
      " direction: rtl; align-content: end !important; justify-content: start !important; align-items: end !important; gap: 4px !important;" +
      " padding: 0 12px 10px 12px !important; margin: 0 !important; width: auto !important; height: auto !important; pointer-events: none; }" +
      " .bubble-sub-button { pointer-events: auto; direction: ltr; grid-row: 1 !important; grid-column: auto !important; } ";
    if (climateIdx)
      styles += `.bubble-sub-button.bubble-sub-button-${climateIdx} { grid-row: auto !important; grid-column: auto !important; position: absolute !important; top: 10px !important; right: 12px !important; bottom: auto !important; left: auto !important; } `;
  }
  // Top-left alerts: yellow, laid out left → right; each one's left offset counts the visible alerts before it.
  alerts.forEach(([idx, show], i) => {
    const before = alerts.slice(0, i).map((a) => a[1]);
    const offset = before.length ? "[" + before.join(", ") + "].filter(Boolean).length" : "0";
    styles +=
      `.bubble-sub-button.bubble-sub-button-${idx} { grid-row: auto !important; grid-column: auto !important; position: absolute !important;` +
      " top: 8px !important; right: auto !important; bottom: auto !important; height: 24px !important; min-width: 24px !important; padding: 0 !important;" +
      " left: ${14 + (" + offset + ") * 26}px !important; display: ${" + show + " ? 'flex' : 'none'} !important; }" +
      ` ${iconSel(idx)} { color: var(--accent-color) !important; --mdc-icon-size: 20px; } `;
  });
  // Larger room name and temperature.
  styles += ".bubble-name { font-size: 16px !important; } ";
  if (climateIdx) styles += `.bubble-sub-button-${climateIdx} .bubble-sub-button-name-container, .bubble-sub-button-${climateIdx} { font-size: 15px !important; } `;
  // Now playing: scrolls along the bottom, left of the icons.
  const players = [...audio, ...tvs];
  if (players.length) {
    const icons = [lightIdx, fanIdx, lockedIdx, tvIdx, mediaIdx].filter(Boolean).length;
    const np =
      "((() => { const p = " + JSON.stringify(players) + ".map((e) => hass.states[e]).find((s) => s && s.state === 'playing');" +
      " if (!p) return ''; const a = p.attributes; return [a.media_title, a.media_artist || a.media_series_title || a.app_name].filter(Boolean).join(' — ')" + CSS_SAFE + "; })())";
    styles +=
      ".bubble-button-card-container::after { content: \"${" + np + "}\"; display: ${" + np + " ? 'block' : 'none'}; position: absolute; left: 16px; bottom: 14px;" +
      ` right: ${icons * 36 + 20}px; white-space: nowrap; overflow: hidden; font-size: 12px; opacity: 0.85; pointer-events: none;` +
      " animation: pivit-now-playing ${Math.max(8, " + np + ".length * 0.35)}s linear infinite; }" +
      " @keyframes pivit-now-playing { from { text-indent: 100%; } to { text-indent: -${" + np + ".length}ch; } } ";
  }
  if (room.image) {
    styles += `.bubble-button-card-container { background: linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.55)), url('${room.image}') center / cover no-repeat !important; }`;
  }
  if (styles) card.styles = styles.trim();
  return card;
}

// The lights in one room: light.* entities, or (if the room has none) its switches/fans.
function roomLights(room) {
  const lights = room.entities.filter((id) => domainOf(id) === "light");
  return lights.length ? lights : room.entities.filter((id) => /^switch\./.test(id));
}

// Activity pop-up: recent history of a room's motion/occupancy and door/window sensors.
function roomActivityPopup(room, hass, sensors) {
  return popupShell("#" + slug(room.name) + "-activity", room.name + " Activity", "mdi:history", [
    { type: "history-graph", hours_to_show: 3, entities: sensors.map((id) => ({ entity: id, name: shortLabel(room, hass, id) })), grid_options: { columns: "full" } },
  ]);
}

// A room's climate entities, HVAC units (that can cool) before heat-only ones such as fireplaces.
function roomClimates(room, hass) {
  const cools = (id) => ((hass.states[id] && hass.states[id].attributes.hvac_modes) || []).some((m) => m === "cool" || m === "heat_cool" || m === "auto");
  return room.entities
    .filter((id) => domainOf(id) === "climate")
    .map((id, i) => [id, i])
    .sort((a, b) => Number(cools(b[0])) - Number(cools(a[0])) || a[1] - b[1])
    .map(([id]) => id);
}

// The fans in one room.
function roomFans(room) {
  return room.entities.filter((id) => domainOf(id) === "fan");
}

// Pop-up with one room's fans: a tile per fan with speed and direction controls.
function roomFansPopup(room, hass) {
  const cards = roomFans(room).map((id) => ({
    type: "tile",
    entity: id,
    name: shortLabel(room, hass, id),
    icon: "mdi:ceiling-fan",
    features: [{ type: "fan-speed" }, { type: "fan-direction" }],
    grid_options: { columns: "full" },
  }));
  return popupShell("#" + slug(room.name) + "-fans", room.name + " Fans", "mdi:ceiling-fan", cards);
}

// Pop-up with only one room's lights, opened from the lights icon on that room's tile.
function roomLightsPopup(room, hass) {
  const ids = roomLights(room);
  const cards = [];
  for (const id of ids) {
    const card = entityCard(hass, id, { half: "full" });
    const label = NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id;
    if (card.type === "custom:bubble-card" && !NAMES[id] && label.toLowerCase().startsWith(room.name.toLowerCase() + " "))
      card.name = label.slice(room.name.length + 1);
    cards.push(card);
  }
  const popup = popupShell("#" + slug(room.name) + "-lights", room.name + " Lights", "mdi:lightbulb-group", cards);
  return ids.length > 1 ? withHeaderAction(popup, "All Off", "mdi:power", ids, ["on"], "homeassistant.turn_off", { confirm: false }) : popup;
}

// A room's media players split into TVs and audio players.
function roomMediaSplit(room, hass) {
  const model = (id) => {
    const e = (hass.entities || {})[id];
    const d = e && (hass.devices || {})[e.device_id];
    return (d && d.model) || "";
  };
  const isTv = (id) =>
    hass.states[id] &&
    (hass.states[id].attributes.device_class === "tv" || /\btv\b|television/i.test(id + " " + (hass.states[id].attributes.friendly_name || "") + " " + model(id)));
  const media = room.entities.filter((id) => domainOf(id) === "media_player");
  return { tvs: media.filter(isTv), audio: media.filter((id) => !isTv(id)) };
}

function popupShell(hash, name, icon, cards) {
  return { type: "custom:bubble-card", card_type: "pop-up", hash, name, icon, bg_opacity: "85", bg_blur: "14", close_by_clicking_outside: true, cards };
}

// Strip a redundant "<Room> " prefix from a card's label.
function shortLabel(room, hass, id) {
  const label = NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id;
  return !NAMES[id] && label.toLowerCase().startsWith(room.name.toLowerCase() + " ") ? label.slice(room.name.length + 1) : label;
}

// Doors & windows pop-up: the room's door/window sensors plus its locks.
function roomDoorsPopup(room, hass, openings) {
  const cards = [];
  for (const id of [...openings, ...room.entities.filter((e) => domainOf(e) === "lock")]) {
    const card = entityCard(hass, id, { half: "full" });
    if (card.type === "custom:bubble-card") card.name = shortLabel(room, hass, id);
    cards.push(card);
  }
  return popupShell("#" + slug(room.name) + "-doors", room.name + " Doors & Windows", "mdi:door", cards);
}

// Cards for one speaker: album-art media-control card, volume slider, and (if it has a TV input) Play TV Audio.
function audioCards(room, hass, id, multi = false, massive = false) {
  if (AUDIO_CARD === "mediocre") {
    // Mediocre Media Player Card (HACS: antontanderup/mediocre-hass-media-player-cards): album art, grouping, browse, volume.
    const tvSource = ((hass.states[id] && hass.states[id].attributes.source_list) || []).includes("TV");
    return [
      {
        // Massive card (Audio pop-ups): big art and the volume slider always visible. Standard card elsewhere.
        type: massive ? "custom:mediocre-massive-media-player-card" : "custom:mediocre-media-player-card",
        entity_id: id,
        use_art_colors: true,
        ...(massive ? { mode: "card" } : { tap_opens_popup: false }), // tapping does not open the big (massive) player
        speaker_group: { entity_id: id, entities: SPEAKERS.filter((e) => e !== id) },
        media_browser: [{ entity_id: id, name: shortLabel(room, hass, id) }],
        options: { show_volume_step_buttons: true },
        ...(tvSource
          ? { custom_buttons: [{ name: "Play TV Audio", icon: "mdi:television-speaker", tap_action: { action: "perform-action", perform_action: "media_player.select_source", target: { entity_id: id }, data: { source: "TV" } } }] }
          : {}),
        grid_options: { columns: "full" },
      },
    ];
  }
  return [
      // HA media-control card: full album art with title/artist and transport controls.
      { type: "media-control", entity: id, grid_options: { columns: "full" } },
      // Volume slider underneath.
      {
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "slider",
        entity: id,
        name: multi ? shortLabel(room, hass, id) + " Volume" : "Volume",
        icon: "mdi:volume-high",
        show_state: true,
        grid_options: { columns: "full" },
      },
      // Speakers with a TV input (e.g. Sonos soundbars): switch to TV audio. Yellow while TV is the source.
      ...((hass.states[id] && hass.states[id].attributes.source_list) || []).filter((src) => src === "TV").map((src) => ({
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "name",
        name: "Play TV Audio",
        icon: "mdi:television-speaker",
        grid_options: { columns: "full" },
        styles: iconFillWhen("hass.states['" + id + "'] && hass.states['" + id + "'].attributes.source === 'TV'", "var(--accent-color)"),
        ...action({ action: "perform-action", perform_action: "media_player.select_source", target: { entity_id: id }, data: { source: src } }),
      })),
  ];
}

// Audio pop-up: the speaker cards for each speaker in the room.
function roomAudioPopup(room, hass, audio) {
  return popupShell("#" + slug(room.name) + "-audio", room.name + " Audio", "mdi:speaker", audio.flatMap((id) => audioCards(room, hass, id, audio.length > 1)));
}

// Remote entity for a TV: one on the same device, else the only/first remote.* in the same room.
function tvRemote(hass, tv, roomId) {
  const ents = hass.entities || {};
  const areaOfEnt = (id) => { const e = ents[id]; if (!e) return null; return e.area_id || ((hass.devices || {})[e.device_id] || {}).area_id || null; };
  const remotes = Object.keys(hass.states).filter((id) => domainOf(id) === "remote");
  const dev = ents[tv] && ents[tv].device_id;
  return remotes.find((r) => dev && ents[r] && ents[r].device_id === dev) || remotes.find((r) => areaOfEnt(r) === roomId) || null;
}

// Remote command names per integration (Android/Google TV remote is the default).
const REMOTE_COMMANDS = {
  androidtv_remote: { up: "DPAD_UP", down: "DPAD_DOWN", left: "DPAD_LEFT", right: "DPAD_RIGHT", ok: "DPAD_CENTER", back: "BACK", home: "HOME" },
  apple_tv: { up: "up", down: "down", left: "left", right: "right", ok: "select", back: "menu", home: "home" },
  roku: { up: "up", down: "down", left: "left", right: "right", ok: "select", back: "back", home: "home" },
  webostv: { up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT", ok: "ENTER", back: "BACK", home: "HOME" },
  samsungtv: { up: "KEY_UP", down: "KEY_DOWN", left: "KEY_LEFT", right: "KEY_RIGHT", ok: "KEY_ENTER", back: "KEY_RETURN", home: "KEY_HOME" },
};

// TV remote pop-up: power, the TV's media card, and (when a remote entity exists) a d-pad + back/home + volume.
function roomTvPopup(room, hass, tvs) {
  const cards = [];
  for (const tv of tvs) {
    const remote = tvRemote(hass, tv, room.id);
    const label = shortLabel(room, hass, tv);
    const btn = (icon, tap, cols = 4, name = "") => ({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name,
      icon,
      show_name: !!name,
      grid_options: { columns: cols },
      styles: name ? "" : ".bubble-button-card-container { justify-content: center; } .bubble-content-container { justify-content: center; } .bubble-name-container { display: none !important; }",
      ...action(tap),
    });
    const power = remote
      ? { action: "perform-action", perform_action: "remote.toggle", target: { entity_id: remote } }
      : { action: "perform-action", perform_action: "media_player.toggle", target: { entity_id: tv } };
    cards.push(btn("mdi:power", power, 12, tvs.length > 1 ? `${label} Power` : "Power"));
    cards.push({ type: "custom:bubble-card", card_type: "media-player", entity: tv, name: label, grid_options: { columns: "full" } });
    if (remote) {
      const platform = (hass.entities[remote] || {}).platform;
      const c = REMOTE_COMMANDS[platform] || REMOTE_COMMANDS.androidtv_remote;
      const send = (cmd) => ({ action: "perform-action", perform_action: "remote.send_command", target: { entity_id: remote }, data: { command: cmd } });
      const blank = { type: "custom:bubble-card", card_type: "empty-column", grid_options: { columns: 4 } };
      cards.push(
        btn("mdi:arrow-left-circle-outline", send(c.back)), btn("mdi:chevron-up", send(c.up)), btn("mdi:home-outline", send(c.home)),
        btn("mdi:chevron-left", send(c.left)), btn("mdi:circle-outline", send(c.ok)), btn("mdi:chevron-right", send(c.right)),
        blank, btn("mdi:chevron-down", send(c.down)), blank,
        btn("mdi:volume-minus", { action: "perform-action", perform_action: "media_player.volume_down", target: { entity_id: tv } }),
        btn("mdi:volume-mute", { action: "perform-action", perform_action: "media_player.volume_mute", target: { entity_id: tv }, data: { is_volume_muted: true } }),
        btn("mdi:volume-plus", { action: "perform-action", perform_action: "media_player.volume_up", target: { entity_id: tv } })
      );
    }
  }
  return popupShell("#" + slug(room.name) + "-tv", room.name + " TV", "mdi:television", cards);
}

// Thermostat controls pop-up for one climate entity (opened by tapping a temperature).
function thermostatHash(id) {
  return "#thermostat-" + id.split(".")[1].replace(/_/g, "-");
}
function thermostatPopup(hass, id) {
  const st = hass.states[id];
  const name = NAMES[id] || (st && st.attributes.friendly_name) || "Thermostat";
  const card = { type: "thermostat", entity: id, ...(NAMES[id] ? { name: NAMES[id] } : {}), features: [{ type: "climate-hvac-modes" }] };
  if (st && (st.attributes.fan_modes || []).length) card.features.push({ type: "climate-fan-modes", style: "dropdown" });
  return popupShell(thermostatHash(id), name, "mdi:thermostat", [{ ...card, grid_options: { columns: "full" } }]);
}

// Intercom / gate pop-up: live camera, unlock, one-tap spoken messages, and a typed message.
function intercomHash(ic) {
  return "#" + slug(ic.name || "intercom");
}
// Gate open/closed indicator (a sub-button showing the status sensor's state with an open/closed icon).
// Gate open/closed indicator: two sub-buttons (closed gate / open gate icon) shown by state, with the state text.
function intercomStatusSubs(ic, tap) {
  const base = { entity: ic.status_sensor, show_state: true, show_icon: true, show_background: false, tap_action: tap || { action: "more-info" } };
  return [
    { ...base, icon: "mdi:gate", visibility: [{ condition: "state", entity: ic.status_sensor, state_not: "on" }] },
    { ...base, icon: "mdi:gate-open", visibility: [{ condition: "state", entity: ic.status_sensor, state: "on" }] },
  ];
}
// Yellow while open (the open sub-button is the second of the pair starting at `idx`).
function intercomStatusStyles(ic, idx) {
  const o = idx + 1;
  return `.bubble-sub-button-${o}, .bubble-sub-button-${o} ha-icon, .bubble-sub-button-${o} ha-state-icon { color: var(--accent-color) !important; }`;
}
function intercomPopup(ic) {
  const cards = [];
  if (ic.camera)
    cards.push({
      type: "picture-entity",
      entity: ic.camera,
      camera_view: "live",
      aspect_ratio: ic.aspect_ratio || "4:3", // intercom cameras are often portrait; crop so the buttons stay on screen
      fit_mode: "cover",
      show_name: false,
      show_state: false,
      tap_action: { action: "more-info" },
      grid_options: { columns: "full" },
    });
  if (ic.unlock)
    cards.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: ic.unlock_name || "Open " + (ic.name || "Gate"),
      icon: "mdi:gate-open",
      grid_options: { columns: ic.lock_rule ? 6 : "full" },
      ...action({
        action: "perform-action",
        perform_action: domainOf(ic.unlock) === "lock" ? "lock.unlock" : "button.press",
        target: { entity_id: ic.unlock },
        ...(ic.unlock_confirm ? { confirmation: { text: `Open ${ic.name || "the gate"}?` } } : {}),
      }),
    });
  // Hold open via a lock-rule select (e.g. UniFi Access: keep_unlock / reset). One full-width button that swaps:
  //   not held → "Hold Open" (asks to confirm);  held → yellow "Held Open - Press to Cancel" (resets, no confirm).
  if (ic.lock_rule) {
    const rule = (option, confirmText) => ({
      action: "perform-action",
      perform_action: "select.select_option",
      target: { entity_id: ic.lock_rule },
      data: { option },
      ...(confirmText ? { confirmation: { text: confirmText } } : {}),
    });
    const status = ic.lock_rule_sensor || ic.lock_rule;
    const heldStates = [ic.hold_option || "keep_unlock", "custom"];
    const btn = (name, icon, tap, extra = {}) => ({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name,
      icon,
      grid_options: { columns: 6 },
      ...extra,
      ...action(tap),
    });
    cards.push({
      type: "conditional",
      conditions: [{ condition: "state", entity: status, state_not: heldStates }],
      card: btn("Hold Open", "mdi:gate-open", rule(ic.hold_option || "keep_unlock", `Hold ${ic.name || "the gate"} open until you cancel it?`)),
      grid_options: { columns: 6 },
    });
    cards.push({
      type: "conditional",
      conditions: [{ condition: "state", entity: status, state: heldStates }],
      card: btn(ic.held_name || "Held Open - Press to Cancel", "mdi:gate-open", rule(ic.normal_option || "reset"), {
        styles: iconFillWhen("true", "var(--accent-color)"),
      }),
      grid_options: { columns: 6 },
    });
    if (ic.close_button)
      cards.push(btn(ic.normal_name || "Close Gate", "mdi:gate", rule(ic.normal_option || "reset")));
    // Optional: hold open until a chosen time (time picker + script).
    if (ic.hold_until_entity && ic.hold_until_script) {
      cards.push({ type: "entities", entities: [{ entity: ic.hold_until_entity, name: "Until" }], grid_options: { columns: 8 } });
      cards.push({
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "name",
        name: "Hold Until",
        icon: "mdi:clock-end",
        grid_options: { columns: 4 },
        ...action({
          action: "perform-action",
          perform_action: "script.turn_on",
          target: { entity_id: ic.hold_until_script },
          confirmation: { text: `Hold ${ic.name || "the gate"} open until the chosen time?` },
        }),
      });
    }
    if (ic.hold_end_sensor && ic.lock_rule_sensor)
      cards.push({
        type: "conditional",
        conditions: [{ condition: "state", entity: ic.lock_rule_sensor, state: "custom" }],
        card: { type: "tile", entity: ic.hold_end_sensor, name: "Open until", icon: "mdi:timer-sand", vertical: false },
        grid_options: { columns: "full" },
      });
  }
  if (ic.speaker && ic.tts) {
    const say = (message) => ({
      action: "perform-action",
      perform_action: "tts.speak",
      target: { entity_id: ic.tts },
      data: { media_player_entity_id: ic.speaker, message, cache: true },
    });
    for (const m of ic.messages || [])
      cards.push({ type: "custom:bubble-card", card_type: "button", button_type: "name", name: m, icon: "mdi:message-text-outline", grid_options: { columns: 6 }, ...action(say(m)) });
    if (ic.message_entity && ic.say_script) {
      cards.push({ type: "entities", entities: [{ entity: ic.message_entity, name: "Type a message" }], grid_options: { columns: 9 } });
      cards.push({
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "name",
        name: "Say",
        icon: "mdi:account-voice",
        grid_options: { columns: 3 },
        ...action({ action: "perform-action", perform_action: "script.turn_on", target: { entity_id: ic.say_script } }),
      });
    }
  }
  const popup = popupShell(intercomHash(ic), ic.name || "Intercom", ic.icon || "mdi:doorbell-video", cards);
  // Open/closed indicator in the pop-up header (yellow while open).
  if (ic.status_sensor) {
    popup.sub_button = intercomStatusSubs(ic);
    popup.styles = intercomStatusStyles(ic, 1);
  }
  if (ic.ring_entity) Object.assign(popup, { trigger_entity: ic.ring_entity, trigger_state: "on", trigger_close: true });
  return popup;
}

function roomPopup(room, hass) {
  const switchable = room.entities.filter((id) => /^(light|switch|fan)\./.test(id));
  const cards = [];
  const { audio, tvs } = roomMediaSplit(room, hass);
  // Order: climate and locks above All Off; then lights, fans, shades, TV, audio; then anything else.
  const group = (id) => {
    const d = domainOf(id);
    if (d === "climate") return 0 + roomClimates(room, hass).indexOf(id) / 100;
    if (d === "lock") return 1;
    if (d === "light" || d === "switch") return 3;
    if (d === "fan") return 4;
    if (d === "cover") return 5;
    if (tvs.includes(id)) return 6;
    if (audio.includes(id)) return 7;
    return 8;
  };
  const ordered = room.entities.map((id, i) => [id, i]).sort((a, b) => group(a[0]) - group(b[0]) || a[1] - b[1]).map(([id]) => id);
  const card = (id) => (audio.includes(id) ? audioCards(room, hass, id, audio.length > 1) : [entityCard(hass, id)]);
  const locks = room.entities.filter((id) => domainOf(id) === "lock");
  // Door unlock buttons (e.g. UniFi Access "… Unlock") go in the title bar too.
  const unlockButtons = room.entities.filter((id) => domainOf(id) === "button" && /unlock/i.test(id + " " + ((hass.states[id] && hass.states[id].attributes.friendly_name) || "")));
  // Door/window/motion sensors are shown on the room card (top-left, when open/active), not in the pop-up.
  const STATUS = ["door", "garage_door", "window", "opening", "motion", "occupancy", "presence"];
  const isStatus = (id) => domainOf(id) === "binary_sensor" && STATUS.includes((hass.states[id] && hass.states[id].attributes.device_class) || "");
  for (const id of ordered.filter((id) => domainOf(id) !== "lock" && !unlockButtons.includes(id) && !isStatus(id))) cards.push(...card(id));
  const popup = popupShell("#" + slug(room.name), room.name, room.icon, cards);
  // Door lock status in the title bar, before All Off: green lock when all locked, red open lock when any is unlocked.
  // Tapping it opens the room's Locks pop-up.
  if (locks.length) {
    const toLocks = { action: "navigate", navigation_path: "#" + slug(room.name) + "-locks" };
    popup.sub_button = [
      { entity: locks[0], icon: "mdi:lock", show_icon: true, show_name: false, show_state: false, show_background: false, tap_action: toLocks,
        visibility: locks.map((id) => ({ condition: "state", entity: id, state_not: UNLOCKED_STATES })) },
      { entity: locks[0], icon: "mdi:lock-open-variant", show_icon: true, show_name: false, show_state: false, show_background: false, tap_action: toLocks,
        visibility: [{ condition: "or", conditions: locks.map((id) => ({ condition: "state", entity: id, state: UNLOCKED_STATES })) }] },
    ];
    popup.styles =
      ".bubble-sub-button-1 ha-icon, .bubble-sub-button-1 .bubble-sub-button-icon { color: var(--green-color, #4caf50) !important; }" +
      " .bubble-sub-button-2 ha-icon, .bubble-sub-button-2 .bubble-sub-button-icon { color: var(--red-color, #f44336) !important; }";
  }
  for (const id of unlockButtons) {
    const label = ((NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id) + "").replace(/\s*unlock$/i, "");
    popup.sub_button = [
      ...(popup.sub_button || []),
      { entity: id, icon: "mdi:door-closed-lock", show_icon: true, show_name: false, show_state: false, show_background: false,
        tap_action: { action: "perform-action", perform_action: "button.press", target: { entity_id: id }, confirmation: { text: `Unlock ${label}?` } } },
    ];
  }
  // All Off in the title bar: lights/switches/fans that are on, TVs that are on, speakers that are playing (never climate, locks or shades).
  // All Off also turns off TVs that are on and pauses speakers that are playing.
  const extra = [
    ...(tvs.length ? [{ ids: tvs, states: ["on", "playing", "paused", "idle", "buffering"], service: "media_player.turn_off" }] : []),
    ...(audio.length ? [{ ids: audio, states: ["playing"], service: "media_player.media_pause" }] : []),
  ];
  return switchable.length + tvs.length + audio.length > 1
    ? withHeaderAction(popup, "All Off", "mdi:power", switchable, ["on"], "homeassistant.turn_off", { confirm: false, extra })
    : popup;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

// JS expression (evaluated by Bubble Card in styles) counting lights that are on.
function lightsOnExpr(lights) {
  return "(" + JSON.stringify(lights) + ".filter((e) => hass.states[e] && hass.states[e].state === 'on').length)";
}

// "Act on only what's on" buttons. A dashboard strategy is built once, so a normal action would target every
// entity. Instead the button's own action is "none", and a tiny hook in Bubble Card's styles template (which has
// `card` and live `hass`) listens for taps, picks the entities currently in one of `states`, and fires HA's
// standard hass-action with that list (so HA's own confirmation dialog shows the live count).
// Taps on sub-buttons (e.g. the "N on ›" count) are ignored by the hook.
function liveBulk(ids, states, service, opts = {}) {
  const confirm = opts.confirm !== false;
  const hook =
    "${(card.__pvH = hass, card.__pv" + (opts.sub || "") + " || (card.__pv" + (opts.sub || "") + " = 1, card.addEventListener('click', function (ev) {" +
    (opts.sub
      ? " if (!ev.composedPath().some(function (n) { return n.classList && n.classList.contains('bubble-sub-button-" + opts.sub + "'); })) return;"
      : " if (ev.composedPath().some(function (n) { return n.classList && n.classList.contains('bubble-sub-button'); })) return;") +
    " var h = card.__pvH; var ids = " + JSON.stringify(ids) + ".filter(function (e) { return h.states[e] && " + JSON.stringify(states) + ".includes(h.states[e].state); });" +
    (opts.extra || [])
      .map(
        (g) =>
          " var x = " + JSON.stringify(g.ids) + ".filter(function (e) { return h.states[e] && " + JSON.stringify(g.states) + ".includes(h.states[e].state); });" +
          " if (x.length) card.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { action: 'tap', config: { tap_action:" +
          " { action: 'perform-action', perform_action: " + JSON.stringify(g.service) + ", target: { entity_id: x } } } } }));"
      )
      .join("") +
    " if (!ids.length) return;" +
    " var t = { action: 'perform-action', perform_action: " + JSON.stringify(service) + ", target: { entity_id: ids } };" +
    (confirm
      ? " t.confirmation = { text: " + JSON.stringify(opts.verb || "") + " + ' ' + ids.length + ' ' + (ids.length === 1 ? " + JSON.stringify(opts.one) + " : " + JSON.stringify(opts.many) + ") + '?' };"
      : "") +
    " card.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { action: 'tap', config: { tap_action: t } } }));" +
    " })), '')}";
  return { hook, actions: { tap_action: { action: "none" }, button_action: { tap_action: { action: "none" } } } };
}

// Pop-up listing only the lights that are on, each with its room, to turn off one at a time.
// Put a bulk action ("All Off", "Lock All") in a pop-up's title bar as a labelled sub-button.
// It acts only on entities currently in `states` (see liveBulk); nothing happens if none are.
function withHeaderAction(popup, label, icon, ids, states, service, opts = {}) {
  const idx = (popup.sub_button || []).length + 1;
  const bulk = liveBulk(ids, states, service, { ...opts, sub: idx });
  popup.sub_button = [...(popup.sub_button || []), { name: label, icon, show_name: true, show_icon: true, show_background: true, tap_action: { action: "none" } }];
  popup.styles = ((popup.styles || "") + " " + bulk.hook).trim();
  return popup;
}

function lightsOnPopup(ctx) {
  const cards = [];
  for (const room of ctx.rooms)
    for (const id of room.entities.filter((e) => domainOf(e) === "light")) {
      const label = NAMES[id] || (ctx.hass.states[id] && ctx.hass.states[id].attributes.friendly_name) || id;
      const card = entityCard(ctx.hass, id, { half: "full" });
      card.name = label.toLowerCase().includes(room.name.toLowerCase()) ? label : `${room.name} · ${label}`;
      cards.push({ type: "conditional", conditions: [{ condition: "state", entity: id, state: "on" }], card, grid_options: { columns: "full" } });
    }
  return withHeaderAction(
    popupShell("#lights-on", "Lights On", "mdi:lightbulb-on-outline", cards),
    "All Off", "mdi:power", ctx.lights, ["on"], "light.turn_off", { verb: "Turn off", one: "light", many: "lights" }
  );
}

const UNLOCKED_STATES = ["unlocked", "open", "opening", "unlocking", "jammed"];

// JS expression (evaluated by Bubble Card in styles) counting locks that are not locked.
function unlockedExpr(locks) {
  return "(" + JSON.stringify(locks) + ".filter((e) => hass.states[e] && " + JSON.stringify(UNLOCKED_STATES) + ".includes(hass.states[e].state)).length)";
}

// Pop-up listing only the unlocked doors, each with its room, to lock one at a time.
// Locks pop-up: every lock, unlocked ones first (conditional cards), with "Lock All Unlocked" when there are several.
// Tapping an unlocked lock locks it; tapping a locked one unlocks it (with confirmation).
function locksPopup(hass, hash, title, entries) {
  // entries: [{ id, label }]
  const cards = [];
  const lockCard = (id, label, tap) => ({
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "switch",
    entity: id,
    name: label,
    show_state: true,
    // No fill: just the lock icon, red when unlocked and green when locked.
    styles:
      ".bubble-button-background { opacity: 0 !important; }" +
      " .bubble-main-icon-container { background-color: var(--card-background-color, #1c1c1c) !important; }" +
      " .bubble-icon { color: ${" + JSON.stringify(UNLOCKED_STATES) + ".includes(state) ? 'var(--red-color, #f44336)' : 'var(--green-color, #4caf50)'} !important; }",
    grid_options: { columns: "full" },
    ...action(tap),
  });
  for (const { id, label } of entries)
    cards.push({
      type: "conditional",
      conditions: [{ condition: "state", entity: id, state: UNLOCKED_STATES }],
      card: lockCard(id, label, { action: "perform-action", perform_action: "lock.lock", target: { entity_id: id } }),
      grid_options: { columns: "full" },
    });
  for (const { id, label } of entries)
    cards.push({
      type: "conditional",
      conditions: [{ condition: "state", entity: id, state_not: UNLOCKED_STATES }],
      card: lockCard(id, label, { action: "perform-action", perform_action: "lock.unlock", target: { entity_id: id }, confirmation: { text: `Unlock ${label}?` } }),
      grid_options: { columns: "full" },
    });
  const popup = popupShell(hash, title, "mdi:lock", cards);
  return entries.length > 1
    ? withHeaderAction(popup, "Lock All", "mdi:lock", entries.map((e) => e.id), UNLOCKED_STATES, "lock.lock", { verb: "Lock", one: "door", many: "doors" })
    : popup;
}

// House-wide Locks pop-up (opened from the Rooms-page Locks button).
function unlockedPopup(ctx, locks) {
  const entries = [];
  for (const room of ctx.rooms)
    for (const id of room.entities.filter((e) => locks.includes(e))) {
      const label = NAMES[id] || (ctx.hass.states[id] && ctx.hass.states[id].attributes.friendly_name) || id;
      entries.push({ id, label: label.toLowerCase().includes(room.name.toLowerCase()) ? label : `${room.name} · ${label}` });
    }
  return locksPopup(ctx.hass, "#doors-unlocked", "Locks", entries);
}

function roomsView(cfg, ctx, nav) {
  const SPAN = 4;
  const greeting = cfg.name ? `, ${cfg.name}` : "";
  const header = {
    type: "markdown",
    text_only: true,
    grid_options: { columns: "full" },
    content:
      "<h1 style='font-weight:300;font-size:2.6em;margin:0'>{{ now().strftime('%-I:%M') }} <span style='font-size:.45em;opacity:.6'>{{ now().strftime('%p') }}</span></h1>\n" +
      "<div style='opacity:.7;font-size:1.1em'>{% set h=now().hour %}Good {{ 'morning' if h<12 else 'afternoon' if h<18 else 'evening' }}" +
      greeting +
      " · {{ now().strftime('%A, %B %-d') }}</div>",
  };
  const top = [header];
  if (ctx.weather)
    top.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "state",
      entity: ctx.weather,
      name: "Outside",
      show_state: true,
      show_attribute: true,
      attribute: "temperature",
      card_layout: "large",
      grid_options: { columns: 3 * SPAN },
      ...action({ action: "more-info" }),
    });

  // Alarm panels: icon-only buttons pinned to the top-right corner of the Rooms page.
  const cornerAlarms = (cfg.corner_alarm && cfg.pages.includes("security") ? ctx.alarms : []).map((id, i) => ({
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "state",
    entity: id,
    name: NAMES[id] || "Alarm",
    show_name: false,
    show_state: false,
    show_icon: true,
    grid_options: { columns: 1, rows: 1 },
    styles:
      `.bubble-button-card-container { position: fixed !important; top: calc(var(--header-height, 56px) + 12px); right: ${20 + i * 64}px; width: 56px !important; height: 56px !important; border-radius: 50% !important; z-index: 5; }` +
      " .bubble-content-container { justify-content: center; } .bubble-name-container { display: none !important; } .bubble-main-icon-container { position: absolute !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%); margin: 0 !important; }",
    ...action({ action: "navigate", navigation_path: `${ctx.basePath}/security` }),
  }));

  const roomLocksOf = (r) =>
    r.entities.filter((id) => domainOf(id) === "lock" && (!cfg.room_lock_platforms || cfg.room_lock_platforms.includes(((ctx.hass.entities || {})[id] || {}).platform)));
  const statusOf = (r) => {
    const sec = ctx.securityByRoom.find((x) => x.id === r.id);
    return sec ? sec.sensors.filter((id) => (cfg.room_status_classes || []).includes(ctx.hass.states[id].attributes.device_class)) : [];
  };
  const openingsOf = (r) => {
    const sec = ctx.securityByRoom.find((x) => x.id === r.id);
    return sec ? sec.sensors.filter((id) => (cfg.room_openings || []).includes(ctx.hass.states[id].attributes.device_class)) : [];
  };
  const quick = [];
  // Rooms-page summary buttons: tapping opens a pop-up; a live status reads on the right.
  const summaryButton = (name, icon, hash, statusExpr) => ({
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name,
    icon,
    card_layout: "large",
    grid_options: { columns: 3 * SPAN },
    // The count is display-only (the whole button opens the pop-up).
    sub_button: [{ icon: "mdi:circle-small", show_icon: false, show_background: false, tap_action: { action: "navigate", navigation_path: hash } }],
    styles:
      ".bubble-sub-button-1 { display: flex !important; flex-direction: row !important; width: auto !important; padding: 0 12px; pointer-events: none !important; }" +
      " .bubble-sub-button-1 ha-icon, .bubble-sub-button-1 .bubble-sub-button-icon { display: none !important; }" +
      " .bubble-sub-button-1::before { content: \"${" + statusExpr + "}\"; font-size: 13px; font-weight: 600; }",
    ...action({ action: "navigate", navigation_path: hash }),
  });
  if (cfg.all_lights_off && ctx.lights.length) {
    const n = lightsOnExpr(ctx.lights);
    quick.push(summaryButton(cfg.lights_button_name || "Lights", "mdi:lightbulb-group", "#lights-on", "(" + n + " ? " + n + " + ' on' : 'All off')"));
  }
  const extraPopups = [];
  const locks = Object.keys(ctx.hass.states).filter((id) => domainOf(id) === "lock" && ctx.roomOf[id]);
  const manyLocks = locks.length > cfg.max_quick_locks;
  if (manyLocks) {
    const n = unlockedExpr(locks);
    quick.push(summaryButton(cfg.locks_button_name || "Locks", "mdi:lock", "#doors-unlocked", "(" + n + " ? " + n + " + ' unlocked' : 'All locked')"));
    extraPopups.push(unlockedPopup(ctx, locks));
  }
  // Climate: one button for all zones with a live "2 cooling" style status; opens a pop-up with every zone's controls.
  // climate_zones entries: "climate.x" or { entity: "climate.x", name: "Living Room" }.
  const zoneEntries = (cfg.climate_zones || []).map((z) => (typeof z === "string" ? { entity: z } : z)).filter((z) => ctx.hass.states[z.entity]);
  const climateZones = zoneEntries.map((z) => z.entity);
  if (climateZones.length) {
    const status =
      "(() => { const a = " + JSON.stringify(climateZones) + ".map((e) => hass.states[e] && hass.states[e].attributes.hvac_action);" +
      " const h = a.filter((x) => x === 'heating').length, c = a.filter((x) => x === 'cooling').length, p = [];" +
      " if (h) p.push(h + ' heating'); if (c) p.push(c + ' cooling'); return p.length ? p.join(' · ') : 'Idle'; })()";
    quick.push(summaryButton(cfg.climate_button_name || "Climate", "mdi:thermostat", "#climate-zones", status));
    extraPopups.push(
      popupShell(
        "#climate-zones",
        cfg.climate_button_name || "Climate",
        "mdi:thermostat",
        zoneEntries.map(({ entity: id, name }) => ({
          type: "thermostat",
          entity: id,
          ...(name || NAMES[id] ? { name: name || NAMES[id] } : {}),
          features: [{ type: "climate-hvac-modes" }],
          grid_options: { columns: climateZones.length > 1 ? 6 : "full" },
        }))
      )
    );
  }
  const autoQuick = [
    ...Object.keys(ctx.hass.states).filter((id) => domainOf(id) === "cover" && /garage/i.test(id + (ctx.hass.states[id].attributes.device_class || ""))),
    ...(climateZones.length ? [] : cfg.main_thermostat ? [cfg.main_thermostat] : ctx.climates.slice(0, 1)),
    ...(manyLocks ? [] : locks),
  ];
  const quickNames = {};
  const quickIds = cfg.quick_actions.map((q) => {
    if (typeof q === "string") return q;
    if (q.name) quickNames[q.entity] = q.name;
    return q.entity;
  });
  for (const id of [...new Set([...autoQuick, ...quickIds])].filter((id) => !climateZones.includes(id))) {
    if (!ctx.hass.states[id]) continue;
    const d = domainOf(id);
    quick.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "state",
      entity: id,
      name: quickNames[id] || NAMES[id] || (d === "climate" ? "Thermostat" : undefined),
      show_state: d !== "climate",
      show_attribute: d === "climate",
      attribute: d === "climate" ? "current_temperature" : undefined,
      card_layout: "large",
      grid_options: { columns: 3 * SPAN },
      ...action(d === "climate" ? { action: "navigate", navigation_path: thermostatHash(id) } : { action: "more-info" }),
    });
  }
  for (const ic of cfg.intercoms || [])
    quick.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: ic.camera ? "state" : "name",
      ...(ic.camera ? { entity: ic.camera, show_state: false } : {}),
      name: ic.name || "Intercom",
      icon: ic.icon || "mdi:doorbell-video",
      card_layout: "large",
      grid_options: { columns: 3 * SPAN },
      ...(ic.status_sensor ? { sub_button: intercomStatusSubs(ic, { action: "navigate", navigation_path: intercomHash(ic) }), styles: intercomStatusStyles(ic, 1) } : {}),
      ...action({ action: "navigate", navigation_path: intercomHash(ic) }),
    });
  // Custom summary buttons (e.g. Sprinklers): live "N <on_word>" / off text, tap opens a pop-up with the given cards.
  for (const sm of cfg.summaries || []) {
    const ids = (sm.entities || []).filter((id) => ctx.hass.states[id]);
    const onStates = sm.on_states || ["on"];
    const n = "(" + JSON.stringify(ids) + ".filter((e) => hass.states[e] && " + JSON.stringify(onStates) + ".includes(hass.states[e].state)).length)";
    const hash = sm.hash || "#" + slug(sm.name || "summary");
    // Spacer only on wide screens (two buttons per row); on phones the buttons stack and a spacer would add a gap.
    if (sm.spacer_before)
      quick.push({
        type: "custom:bubble-card",
        card_type: "empty-column",
        grid_options: { columns: 3 * SPAN },
        visibility: [{ condition: "screen", media_query: "(min-width: 768px)" }],
      });
    quick.push(summaryButton(sm.name, sm.icon || "mdi:dots-grid", hash, "(" + n + " ? " + n + " + ' " + (sm.on_word || "on") + "' : '" + (sm.off_text || "All off") + "')"));
    extraPopups.push(popupShell(hash, sm.name, sm.icon || "mdi:dots-grid", (sm.cards || []).map((c) => ({ grid_options: { columns: 6 }, ...c }))));
    extraPopups.push(...(sm.popups || []));
  }
  for (const a of cfg.alerts) {
    const cond = { condition: a.state !== undefined ? "state" : "numeric_state", entity: a.entity };
    if (a.state !== undefined) cond.state = a.state;
    if (a.above !== undefined) cond.above = a.above;
    if (a.below !== undefined) cond.below = a.below;
    quick.push({
      type: "tile",
      entity: a.entity,
      name: a.name,
      icon: a.icon || "mdi:alert",
      color: "red",
      visibility: [cond],
      grid_options: { columns: "full" },
    });
  }

  const sections = [{ type: "grid", column_span: SPAN, cards: top }];
  if (quick.length)
    sections.push({ type: "grid", column_span: SPAN, cards: [{ type: "heading", heading: "Home", heading_style: "subtitle" }, ...quick] });
  sections.push({
    type: "grid",
    column_span: SPAN,
    cards: [{ type: "heading", heading: "Rooms", heading_style: "title" }, ...ctx.rooms.filter((r) => !(cfg.hide_room_tiles || []).includes(r.id)).map((r) => {
      return roomTile(r, ctx.hass, SPAN, statusOf(r), roomLocksOf(r), (cfg.room_thermostats || {})[r.id] ?? (cfg.floor_thermostats || {})[r.floor]);
    })],
  });
  sections.push({ type: "grid", cards: [...ctx.rooms.map((r) => roomPopup(r, ctx.hass)), ...ctx.rooms.filter((r) => roomLights(r).length).map((r) => roomLightsPopup(r, ctx.hass)),
    ...ctx.rooms.filter((r) => roomFans(r).length).map((r) => roomFansPopup(r, ctx.hass)),
    ...ctx.rooms.filter((r) => statusOf(r).length).map((r) => roomActivityPopup(r, ctx.hass, statusOf(r))),
    ...ctx.rooms.filter((r) => roomLocksOf(r).length).map((r) => locksPopup(ctx.hass, "#" + slug(r.name) + "-locks", r.name + " Locks", roomLocksOf(r).map((id) => ({ id, label: NAMES[id] || (ctx.hass.states[id] && ctx.hass.states[id].attributes.friendly_name) || id })))),
    ...[...new Set([
      ...Object.keys(ctx.hass.states).filter((id) => domainOf(id) === "climate" && ctx.roomOf[id]),
      ...Object.values(cfg.floor_thermostats || {}),
      ...Object.values(cfg.room_thermostats || {}),
      ...cfg.quick_actions.map((q) => (typeof q === "string" ? q : q.entity)),
      ...(cfg.main_thermostat ? [cfg.main_thermostat] : []),
    ])].filter((id) => domainOf(id) === "climate" && ctx.hass.states[id]).map((id) => thermostatPopup(ctx.hass, id)),
    ...ctx.rooms.map((r) => [r, roomMediaSplit(r, ctx.hass)]).filter(([, m]) => m.audio.length).map(([r, m]) => roomAudioPopup(r, ctx.hass, m.audio)),
    ...ctx.rooms.map((r) => [r, roomMediaSplit(r, ctx.hass)]).filter(([, m]) => m.tvs.length).map(([r, m]) => roomTvPopup(r, ctx.hass, m.tvs)), ...(cfg.all_lights_off && ctx.lights.length ? [lightsOnPopup(ctx)] : []), ...extraPopups, ...cornerAlarms] });
  sections.push({ type: "grid", column_span: SPAN, cards: [nav] });

  return { title: "Rooms", path: "rooms", type: "sections", max_columns: SPAN, dense_section_placement: true, top_margin: true, background: cfg.background, sections };
}

function climateView(cfg, ctx, nav) {
  const byRoom = {};
  for (const id of ctx.climates) {
    const r = ctx.roomOf[id];
    const key = r ? r.name : "Other";
    (byRoom[key] = byRoom[key] || []).push(id);
  }
  const fans = ctx.rooms.flatMap((r) => r.entities.filter((id) => domainOf(id) === "fan"));
  const sections = Object.entries(byRoom).map(([name, ids]) => ({
    type: "grid",
    cards: [{ type: "heading", heading: name, heading_style: "title" }, ...ids.map((id) => ({ type: "thermostat", entity: id, ...(NAMES[id] ? { name: NAMES[id] } : {}) }))],
  }));
  if (fans.length)
    sections.push({ type: "grid", cards: [{ type: "heading", heading: "Fans", heading_style: "title" }, ...fans.map((id) => entityCard(ctx.hass, id))] });
  sections.push({ type: "grid", column_span: 3, cards: [nav] });
  return { title: "Climate", path: "climate", type: "sections", max_columns: 3, background: cfg.background, sections };
}

function securityView(cfg, ctx, nav) {
  const sections = [];
  if (ctx.alarms.length)
    sections.push({
      type: "grid",
      column_span: 3,
      cards: [
        { type: "heading", heading: "Alarm", heading_style: "title" },
        ...ctx.alarms.map((id) => ({
          type: "tile",
          entity: id,
          ...(NAMES[id] ? { name: NAMES[id] } : {}),
          features: [{ type: "alarm-modes", modes: cfg.alarm_modes }],
          grid_options: { columns: "full" },
        })),
      ],
    });
  for (const room of ctx.securityByRoom)
    sections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: room.name, heading_style: "title" },
        ...room.sensors.map((id) => ({ type: "tile", entity: id, ...(NAMES[id] ? { name: NAMES[id] } : {}), grid_options: { columns: 6 } })),
      ],
    });
  sections.push({ type: "grid", column_span: 3, cards: [nav] });
  return { title: "Security", path: "security", type: "sections", max_columns: 3, background: cfg.background, sections };
}

function camerasView(cfg, ctx, nav) {
  const cards = ctx.cameras.map((id) => {
    const st = ctx.hass.states[id];
    const name = (st.attributes.friendly_name || id).replace(/\s+(High|Medium|Low) resolution channel$/i, "");
    return { type: "picture-entity", entity: id, camera_view: "auto", show_state: false, name, grid_options: { columns: 12 } };
  });
  return {
    title: "Cameras",
    path: "cameras",
    type: "sections",
    max_columns: 2,
    background: cfg.background,
    sections: [
      { type: "grid", column_span: 2, cards: [{ type: "heading", heading: "Cameras", heading_style: "title" }, ...cards] },
      { type: "grid", column_span: 2, cards: [nav] },
    ],
  };
}

function mediaView(cfg, ctx, nav) {
  const sections = ctx.mediaByRoom.map(({ room, players }) => ({
    type: "grid",
    cards: [
      { type: "heading", heading: room.name, heading_style: "title", icon: room.icon },
      ...players.flatMap((id) => {
        if (AUDIO_CARD !== "mediocre") return [entityCard(ctx.hass, id)];
        // Same Mediocre cards as the pop-ups: speakers get grouping/browse/Play TV Audio; TVs a plain Mediocre card.
        const { tvs } = roomMediaSplit(room, ctx.hass);
        if (!tvs.includes(id)) return audioCards(room, ctx.hass, id, players.length > 1);
        return [{ type: "custom:mediocre-media-player-card", entity_id: id, use_art_colors: true, tap_opens_popup: false, options: { show_volume_step_buttons: true }, grid_options: { columns: "full" } }];
      }),
    ],
  }));
  sections.push({ type: "grid", column_span: 3, cards: [nav] });
  return { title: "Media", path: "media", type: "sections", max_columns: 3, background: cfg.background, sections };
}


/* ------------------------------------------------------------------ */
/* PivIT ELAN — an ELAN-style variant (separate strategy, same devices) */
/* ------------------------------------------------------------------ */
//
//   strategy:
//     type: custom:pivit-elan
//
// Takes the same options as custom:pivit-home (plus elan_background). Modelled on the ELAN g! / ELAN 8 touch-panel UI
// (as shown by myEasytek): a translucent subsystem menu down the left (Home, Security, Climate, Lighting, Media,
// Irrigation, Video, Pool…), a centred page title over a thin rule, and translucent zone rows — line icon with a blue
// underline, large light name with a small-caps subtitle, big status value on the right and a ›.
// Tapping a zone opens the same pop-ups the PivIT Home dashboard uses.

const ELAN_ACCENT = "#2f7fe0";
const ELAN_BACKGROUND =
  "center / cover no-repeat fixed radial-gradient(ellipse at 70% 15%, rgba(120,110,190,.55) 0%, rgba(40,46,92,0) 45%)," +
  " radial-gradient(ellipse at 15% 85%, rgba(70,120,170,.35) 0%, rgba(20,24,48,0) 50%), linear-gradient(175deg, #2a2f5a 0%, #171a33 45%, #0b0d1a 100%)";
const ELAN_WIDE = "(min-width: 1000px)";
const ELAN_NARROW = "(max-width: 999px)";
const ELAN_ROW_BG = "rgba(12,14,22,.72)";

// Translucent ELAN row look, shared by the row helpers below.
const ELAN_ROW_STYLE =
  `.bubble-button-card-container, .bubble-container { background: ${ELAN_ROW_BG} !important; border: 1px solid rgba(255,255,255,.06); border-radius: 6px !important; }` +
  " .bubble-button-background { opacity: 0 !important; }" +
  ` .bubble-main-icon-container { background: transparent !important; border-radius: 0 !important; box-shadow: inset 0 -3px 0 ${ELAN_ACCENT}; }` +
  " .bubble-icon { color: #e9eef7 !important; --mdc-icon-size: 26px; }" +
  " .bubble-name { font-size: 19px !important; font-weight: 300 !important; letter-spacing: .01em; }" +
  // Phones: smaller type, slimmer LOCK/UNLOCK, setpoints hidden (the row opens the full thermostat controls).
  " @media (max-width: 520px) { .bubble-name { font-size: 16px !important; } .bubble-sub-button-1::before { font-size: 20px !important; }" +
  " .bubble-sub-button-1 * { font-size: 20px !important; } .bubble-sub-button-container .bubble-sub-button[class*='bubble-sub-button-'] { min-width: 0; }" +
  " .bubble-temperature-container, .bubble-target-temperature-container { display: none !important; } .bubble-buttons-container::before { font-size: 30px !important; } }";

const elanTitle = (text) => ({
  type: "custom:bubble-card",
  card_type: "button",
  button_type: "name",
  name: text,
  show_icon: false,
  grid_options: { columns: "full" },
  styles:
    ".bubble-button-card-container { background: none !important; border-radius: 0 !important; border-bottom: 1px solid rgba(255,255,255,.45); }" +
    " .bubble-button-background, .bubble-main-icon-container { display: none !important; }" +
    " .bubble-name-container { margin: 0 auto !important; align-items: center !important; } .bubble-name { font-size: 26px !important; font-weight: 300 !important; text-align: center; line-height: 1.35 !important; overflow: visible !important; }",
  tap_action: { action: "none" },
  button_action: { tap_action: { action: "none" } },
});
const elanSubhead = (text) => ({ type: "heading", heading: text, heading_style: "subtitle" });

// Small-caps subtitle under the row name (static text or a JS expression).
const elanSubtitle = (sub) =>
  sub == null
    ? ""
    : " .bubble-name-container::after { content: \"" + (sub.expr ? "${" + sub.expr + "}" : sub) + "\"; display: block; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; opacity: .6; margin-top: 1px; }";

// Zone row: icon, name, subtitle; big value (+ small label) on the right; › chevron. tap: action config.
function elanRow({ name, icon, sub, value, label, tap, extra = {} }) {
  const valueStyles = value
    ? " .bubble-sub-button-1 { display: flex !important; flex-direction: column !important; align-items: flex-end !important; width: auto !important; padding: 0 10px; pointer-events: none !important; }" +
      " .bubble-sub-button-1 ha-icon, .bubble-sub-button-1 .bubble-sub-button-icon { display: none !important; }" +
      " .bubble-sub-button-1::before { content: \"${" + value + "}\"; font-size: 28px; font-weight: 300; line-height: 1; }" +
      (label ? " .bubble-sub-button-1::after { content: \"${" + label + "}\"; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; opacity: .6; margin-top: 2px; }" : "")
    : "";
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name,
    icon,
    grid_options: { columns: "full" },
    sub_button: [
      ...(value ? [{ icon: "mdi:circle-small", show_icon: false, show_background: false, tap_action: tap }] : []),
      { icon: "mdi:chevron-right", show_background: false, tap_action: tap },
    ],
    styles: ELAN_ROW_STYLE + elanSubtitle(sub) + valueStyles,
    ...extra,
    ...action(tap),
  };
}

// Left-hand ELAN menu; the current page is highlighted with a lighter panel.
function elanNav(items, base, current) {
  return items.map((it) => ({
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name: it.name,
    icon: it.icon,
    grid_options: { columns: "full" },
    styles:
      ".bubble-button-background { opacity: 0 !important; }" +
      ` .bubble-button-card-container { background: ${it.path === current ? "rgba(255,255,255,.16)" : "rgba(10,12,20,.62)"} !important; border-radius: 4px !important; }` +
      " .bubble-main-icon-container { background: transparent !important; } .bubble-icon { color: #f2f5fa !important; --mdc-icon-size: 28px; }" +
      " .bubble-name { font-size: 19px !important; font-weight: 300 !important; }",
    ...action({ action: "navigate", navigation_path: `${base}/${it.path}` }),
  }));
}

const titleCase = (x) => "(((" + x + ") || '') + '').replace(/_/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase())";


// ELAN pool/spa page: one panel per body of water (big water temperature, red heat setpoint with − / +, heater
// on/off), then every pump, light and water feature as a large toggle (blue when on), then remaining readings.
function elanPool(hass, cards, bodies) {
  const used = new Set();
  const ent = (id) => hass.states[id];
  const ids = cards.map((c) => c.entity).filter(Boolean);
  const nameOf = (c) => c.name || NAMES[c.entity] || (ent(c.entity) && ent(c.entity).attributes.friendly_name) || c.entity;
  const out = [];
  for (const b of bodies) {
    const key = /spa/i.test(b.entity + " " + (b.name || "")) ? "spa" : "pool";
    const temp = ids.find((id) => domainOf(id) === "sensor" && new RegExp(`(^|_)${key}_temp`).test(id)) ||
      Object.keys(hass.states).find((id) => domainOf(id) === "sensor" && new RegExp(`_${key}_temp$`).test(id));
    const heater = ids.find((id) => domainOf(id) === "switch" && new RegExp(`${key}_heater`).test(id));
    used.add(b.entity); if (temp) used.add(temp); if (heater) used.add(heater);
    const title = key === "spa" ? "Spa" : "Pool";
    const tempExpr = temp
      ? "((s) => s && !isNaN(parseFloat(s.state)) ? Math.round(parseFloat(s.state)) + '°' : '--')(hass.states['" + temp + "'])"
      : "((s) => s && s.attributes.current_temperature != null ? Math.round(s.attributes.current_temperature) + '°' : '--')(hass.states['" + b.entity + "'])";
    const heaterOn = heater ? "(hass.states['" + heater + "'] && hass.states['" + heater + "'].state === 'on')" : "false";
    out.push({
      type: "custom:bubble-card",
      card_type: "climate",
      entity: b.entity,
      name: title,
      show_state: false,
      grid_options: { columns: "full", rows: 2 },
      sub_button: [
        ...(heater
          ? [{ entity: heater, name: "Heater", icon: "mdi:fire", show_name: true, show_icon: true, show_background: true, tap_action: { action: "toggle" } }]
          : []),
      ],
      styles:
        ELAN_ROW_STYLE +
        " .bubble-color-background { opacity: 0 !important; }" +
        " .bubble-high-temp-container, .bubble-low-temp-container, .bubble-target-temperature-container { background: rgba(200,40,40,.6) !important; border-radius: 4px !important; }" +
        " .bubble-climate-temp-display, .bubble-climate-temp-display * { color: #fff !important; }" +
        " .bubble-name { font-size: 24px !important; }" +
        elanSubtitle({ expr: "(" + heaterOn + " ? 'Heater on' : 'Heater off') + ' · set ' + ((hass.states['" + b.entity + "'] || { attributes: {} }).attributes.temperature || '--') + '°'" }) +
        " .bubble-buttons-container::before { content: \"${" + tempExpr + "}\"; font-size: 46px; font-weight: 200; line-height: 1; margin-right: 18px; align-self: center; }" +
        " @media (max-width: 520px) { .bubble-buttons-container::before { font-size: 30px; margin-right: 8px; } .bubble-sub-button-1 .bubble-sub-button-name-container { display: none !important; } }" +
        (heater
          ? " .bubble-sub-button-1 { background: ${" + heaterOn + " ? 'rgba(200,40,40,.85)' : 'rgba(255,255,255,.08)'} !important; border-radius: 4px !important; }" +
            " .bubble-sub-button-1 ha-icon { color: ${" + heaterOn + " ? '#fff' : '#f5a442'} !important; }"
          : ""),
    });
  }
  // Toggles: pumps, lights, features.
  const toggles = cards.filter((c) => c.entity && ["switch", "light", "fan", "input_boolean"].includes(domainOf(c.entity)) && !used.has(c.entity));
  toggles.forEach((c) => used.add(c.entity));
  if (toggles.length)
    out.push({
      type: "grid",
      columns: 3,
      square: false,
      grid_options: { columns: "full" },
      cards: toggles.map((c) => {
        const on = "(hass.states['" + c.entity + "'] && hass.states['" + c.entity + "'].state === 'on')";
        return {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          entity: c.entity,
          name: nameOf(c),
          show_state: true,
          styles:
            ".bubble-button-background { opacity: 0 !important; }" +
            " .bubble-button-card-container { background: ${" + on + " ? '" + ELAN_ACCENT + "' : '" + ELAN_ROW_BG + "'} !important; border: 1px solid rgba(255,255,255,.08); border-radius: 4px !important; }" +
            " .bubble-main-icon-container { background: transparent !important; } .bubble-icon { color: #f2f5fa !important; }" +
            " .bubble-name { font-size: 15px !important; } .bubble-state { font-size: 11px !important; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }" +
            " @media (max-width: 520px) { .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin-left: 10px !important; } .bubble-name { font-size: 13px !important; } }",
          ...action({ action: "toggle" }),
        };
      }),
    });
  // Everything else (air temperature, salinity, cover…) as plain ELAN rows.
  for (const c of cards) {
    if (!c.entity || used.has(c.entity) || c.type === "heading") continue;
    out.push(
      elanRow({
        name: nameOf(c),
        icon: (ent(c.entity) && ent(c.entity).attributes.icon) || (domainOf(c.entity) === "sensor" ? "mdi:thermometer" : "mdi:information-outline"),
        value: "((s) => s ? s.state + (s.attributes.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : '') : '--')(hass.states['" + c.entity + "'])",
        tap: { action: "more-info" },
        extra: { entity: c.entity },
      })
    );
  }
  return out;
}

// Re-skin a PivIT Home pop-up for the ELAN dashboard: deep navy panel, squarer corners, dark translucent rows.
// Bubble Card and HA card variables cascade to every card inside the pop-up, so one style covers them all.
const ELAN_POPUP_STYLE =
  ".bubble-pop-up { --bubble-pop-up-border-radius: 10px; --bubble-border-radius: 6px; --bubble-sub-button-border-radius: 4px;" +
  " --bubble-main-background-color: rgba(255,255,255,.08); --bubble-pop-up-main-background-color: rgba(255,255,255,.08);" +
  " --bubble-secondary-background-color: rgba(255,255,255,.08); --bubble-media-player-buttons-border-radius: 4px;" +
  " --ha-card-background: rgba(255,255,255,.06); --ha-card-border-radius: 6px; --card-background-color: rgba(255,255,255,.06); }" +
  " .bubble-header-container .bubble-name { font-weight: 300 !important; font-size: 19px !important; }";
function elanPopup(pp) {
  return { ...pp, bg_color: "#161b36", bg_opacity: "94", styles: ((pp.styles || "") + " " + ELAN_POPUP_STYLE).trim() };
}

class PivitElanStrategy extends HTMLElement {
  static async generate(userConfig, hass) {
    const cfg = { ...DEFAULTS, ...(userConfig || {}) };
    NAMES = cfg.entity_names || {};
    AUDIO_CARD = cfg.audio_card || "default";
    const ctx = buildContext(cfg, hass);
    SPEAKERS = ctx.rooms.flatMap((r) => roomMediaSplit(r, hass).audio);
    const base = ctx.basePath;
    const bg = cfg.elan_background || ELAN_BACKGROUND;
    const label = (id) => NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id;
    const go = (h) => ({ action: "navigate", navigation_path: h });

    // Reuse the PivIT Home Rooms view for every pop-up (lights, audio, TV, thermostats, locks, sprinkler timers…).
    const savant = roomsView(cfg, ctx, { type: "markdown", content: " " });
    const popups = savant.sections.flatMap((sec) => sec.cards).filter((c) => c.card_type === "pop-up");
    const popupsWhere = (test) => popups.filter((pp) => test(pp.hash || ""));

    // What this home has.
    const lightRooms = ctx.rooms.filter((r) => roomLights(r).length);
    const shadeRooms = ctx.rooms.filter((r) => r.entities.some((id) => domainOf(id) === "cover" && !/garage|gate/i.test((hass.states[id] && hass.states[id].attributes.device_class) || "")));
    const mediaRooms = ctx.rooms.filter((r) => { const m = roomMediaSplit(r, hass); return m.audio.length || m.tvs.length; });
    const zoneEntries = (cfg.climate_zones || []).map((z) => (typeof z === "string" ? { entity: z } : z)).filter((z) => hass.states[z.entity]);
    const climateZones = zoneEntries.length ? zoneEntries : ctx.climates.filter((id) => hass.states[id]).map((entity) => ({ entity }));
    const locks = ctx.rooms.flatMap((r) => r.entities.filter((id) => domainOf(id) === "lock"));
    const garages = Object.keys(hass.states).filter((id) => domainOf(id) === "cover" && ctx.roomOf[id] && /garage|gate/i.test(hass.states[id].attributes.device_class || ""));
    const intercoms = cfg.intercoms || [];
    const summaries = cfg.summaries || [];
    const extra = (cfg.extra_views || []).map((v) => ({ ...v, path: v.path || slug(v.title || "view") }));

    const items = [{ name: "Home", icon: "mdi:home-outline", path: "home" }];
    if (ctx.alarms.length || locks.length || intercoms.length || garages.length) items.push({ name: "Security", icon: "mdi:lock-outline", path: "security" });
    if (climateZones.length) items.push({ name: "Climate", icon: "mdi:thermometer", path: "climate" });
    if (lightRooms.length || shadeRooms.length) items.push({ name: "Lighting", icon: "mdi:lightbulb-outline", path: "lighting" });
    if (mediaRooms.length) items.push({ name: "Media", icon: "mdi:play-circle-outline", path: "media" });
    for (const sm of summaries) items.push({ name: /sprinkl/i.test(sm.name) ? "Irrigation" : sm.name, icon: /sprinkl/i.test(sm.name) ? "mdi:water-outline" : sm.icon || "mdi:dots-grid", path: slug(sm.name) });
    if (ctx.cameras.length) items.push({ name: "Video", icon: "mdi:cctv", path: "video" });
    for (const v of extra) items.push({ name: v.title, icon: v.icon || "mdi:view-dashboard", path: v.path });
    if ((cfg.elan_order || []).length) {
      const rank = (pth) => { const i = cfg.elan_order.indexOf(pth); return i < 0 ? 999 : i; };
      items.sort((a, b) => rank(a.path) - rank(b.path));
    }
    // Below 1000px the ELAN menu becomes a bar of square icon buttons along the bottom (every page fits, even on phones).
    const phoneNavBase = navCard(items, base, cfg.nav_width);
    const phoneNav = {
      ...phoneNavBase,
      styles:
        ".bubble-name { display: none !important; }" +
        " .horizontal-buttons-stack-container { display: flex !important; justify-content: center !important; gap: 6px !important; }" +
        " .bubble-button { position: relative !important; transform: none !important; left: auto !important; width: 48px !important; min-width: 48px !important;" +
        " padding: 0 !important; justify-content: center !important; border-radius: 6px !important; background: rgba(12,14,22,.85) !important; border: 1px solid rgba(255,255,255,.12); }" +
        " .bubble-button.highlight { background: rgba(255,255,255,.2) !important; } .bubble-icon { margin: 0 !important; color: #f2f5fa !important; }" +
        " .bubble-button .bubble-background-color, .bubble-button .bubble-background { border-radius: 6px !important; }" +
        " @media (max-width: 430px) { .horizontal-buttons-stack-container { gap: 3px !important; padding: 0 !important; } .bubble-button { width: 36px !important; min-width: 36px !important; height: 36px !important; } .bubble-icon { --mdc-icon-size: 20px; } }",
      visibility: [{ condition: "screen", media_query: ELAN_NARROW }],
    };

    // One view = ELAN menu (left column, wide screens) + one content column; pop-ups in their own section.
    // ELAN menu (left) and page content (right) sit side by side inside one full-width section; below 1000px the menu
    // hides, the content takes the full width and the bottom nav bar appears instead.
    const view = (path, title, content, viewPopups = [], navPath = path) => ({
      title,
      path,
      ...(navPath !== path ? { subview: true, back_path: `${base}/${navPath}` } : {}),
      type: "sections",
      max_columns: 2,
      background: bg,
      sections: [
        {
          type: "grid",
          column_span: 2,
          cards: [
            { type: "vertical-stack", cards: elanNav(items, base, navPath), grid_options: { columns: 6, rows: "auto" }, visibility: [{ condition: "screen", media_query: ELAN_WIDE }] },
            // Beside the menu on wide screens; full width (menu replaced by the bottom bar) on narrower ones.
            { type: "vertical-stack", cards: content, grid_options: { columns: 18, rows: "auto" }, visibility: [{ condition: "screen", media_query: ELAN_WIDE }] },
            { type: "vertical-stack", cards: content, grid_options: { columns: "full", rows: "auto" }, visibility: [{ condition: "screen", media_query: ELAN_NARROW }] },
            ...viewPopups.map(elanPopup),
            ...intercoms.map(intercomPopup).map(elanPopup),
            phoneNav,
          ],
        },
      ],
    });
    const views = [];

    // HOME — big thin clock and date in the middle (as on the ELAN home screen), weather underneath.
    const wx = ctx.weather
      ? " + ' · ' + Math.round((hass.states['" + ctx.weather + "'] || { attributes: {} }).attributes.temperature) + '° ' + " + titleCase("hass.states['" + ctx.weather + "'] && hass.states['" + ctx.weather + "'].state.replace('partlycloudy', 'partly cloudy')")
      : "";
    views.push(
      view("home", "Home", [
        {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          name: (cfg.elan_brand || cfg.title || "Home").toUpperCase(),
          show_icon: false,
          grid_options: { columns: "full", rows: 6 },
          tap_action: { action: "none" },
          button_action: { tap_action: { action: "none" } },
          styles:
            ".bubble-button-card-container { background: none !important; height: 62vh !important; } .bubble-button-background, .bubble-main-icon-container { display: none !important; }" +
            " .bubble-button-card { justify-content: center !important; } .bubble-name-container { margin: 0 auto !important; align-items: center !important; text-align: center; }" +
            " .bubble-name { font-size: 30px !important; font-weight: 300 !important; letter-spacing: .35em; opacity: .95; line-height: 1.4 !important; overflow: visible !important; }" +
            " .bubble-name-container::after { content: \"${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}\"; display: block; font-size: 84px; font-weight: 200; line-height: 1.15; opacity: .85; }" +
            " .bubble-button-card-container::after { content: \"${new Date().toLocaleDateString([], { weekday: 'long' }) + ' · ' + new Date().toLocaleDateString([], { month: 'long', day: 'numeric' })" + wx + "}\";" +
            " position: absolute; left: 0; right: 0; bottom: 14%; text-align: center; font-size: 18px; opacity: .7; }",
        },
      ])
    );

    // SECURITY — alarm, gate(s), garage doors, then every lock with LOCK / UNLOCK.
    if (items.some((i) => i.path === "security")) {
      const content = [elanTitle("Security")];
      for (const id of ctx.alarms) {
        const st = "hass.states['" + id + "'] ? hass.states['" + id + "'].state : ''";
        content.push(
          elanRow({
            name: NAMES[id] || "Home Security",
            icon: "mdi:shield-lock-outline",
            sub: "Security partition",
            value: "((s) => s.startsWith('armed') ? 'Armed' : " + titleCase("s") + ")(" + st + ")",
            label: "((s) => s.startsWith('armed_') ? s.slice(6).replace(/_/g, ' ') : '')(" + st + ")",
            tap: { action: "more-info" },
            extra: { entity: id },
          })
        );
      }
      for (const ic of intercoms)
        content.push(
          elanRow({
            name: ic.name || "Gate",
            icon: "mdi:gate",
            sub: "Gate",
            value: ic.status_sensor ? "(hass.states['" + ic.status_sensor + "'] && hass.states['" + ic.status_sensor + "'].state === 'on' ? 'Open' : 'Closed')" : null,
            tap: go(intercomHash(ic)),
          })
        );
      for (const id of garages)
        content.push(
          elanRow({ name: label(id), icon: "mdi:garage-variant", sub: "Door control", value: titleCase("hass.states['" + id + "'] && hass.states['" + id + "'].state"), tap: { action: "toggle" }, extra: { entity: id } })
        );
      // Locks: LOCK / UNLOCK segmented buttons; the current state is filled blue.
      for (const id of locks) {
        const unlocked = JSON.stringify(UNLOCKED_STATES) + ".includes(hass.states['" + id + "'] && hass.states['" + id + "'].state)";
        const seg = (n, on) =>
          ` .bubble-sub-button-${n} { width: 84px !important; height: 34px !important; border-radius: 3px !important; justify-content: center !important;` +
          ` background: \${${on} ? '${ELAN_ACCENT}' : 'rgba(255,255,255,.06)'} !important; border: 1px solid rgba(255,255,255,.18); }` +
          ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon { display: none !important; }` +
          ` .bubble-sub-button-${n} .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .1em; text-transform: uppercase; color: #fff !important; opacity: 1 !important; overflow: visible !important; }` +
          ` @media (max-width: 520px) { .bubble-sub-button-${n} { width: 58px !important; } .bubble-sub-button-${n} .bubble-sub-button-name-container { font-size: 10px !important; letter-spacing: .04em !important; } }`;
        content.push({
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          entity: id,
          name: label(id),
          icon: "mdi:door-closed-lock",
          grid_options: { columns: "full" },
          sub_button: [
            { name: "Lock", icon: "mdi:lock", show_name: true, show_icon: false, show_background: true, tap_action: { action: "perform-action", perform_action: "lock.lock", target: { entity_id: id } } },
            { name: "Unlock", icon: "mdi:lock-open-variant", show_name: true, show_icon: false, show_background: true,
              tap_action: { action: "perform-action", perform_action: "lock.unlock", target: { entity_id: id }, confirmation: { text: `Unlock ${label(id)}?` } } },
          ],
          styles: ELAN_ROW_STYLE + elanSubtitle("Door lock") + seg(1, "!" + unlocked) + seg(2, unlocked) + " .bubble-sub-button-container { gap: 0 !important; }",
          ...action({ action: "more-info" }),
        });
      }
      views.push(view("security", "Security", content, []));
    }

    // CLIMATE — each zone: name, big current temperature, heat/cool setpoints (Bubble climate card), › to full controls.
    if (items.some((i) => i.path === "climate"))
      views.push(
        view(
          "climate",
          "Climate",
          [
            elanTitle("Climate"),
            ...climateZones.map(({ entity: id, name }) => ({
              type: "custom:bubble-card",
              card_type: "climate",
              entity: id,
              name: name || label(id),
              show_state: false,
              grid_options: { columns: "full" },
              sub_button: [
                { entity: id, show_attribute: true, attribute: "current_temperature", show_icon: false, show_background: false, tap_action: go(thermostatHash(id)) },
                { icon: "mdi:chevron-right", show_background: false, tap_action: go(thermostatHash(id)) },
              ],
              styles:
                ELAN_ROW_STYLE +
                " .bubble-color-background { opacity: 0 !important; }" +
                " .bubble-low-temp-container { background: rgba(200,40,40,.55) !important; } .bubble-high-temp-container { background: rgba(47,127,224,.6) !important; }" +
                " .bubble-low-temp-container, .bubble-high-temp-container, .bubble-temperature-container { border-radius: 4px !important; }" +
                " .bubble-climate-temp-display, .bubble-climate-temp-display * { color: #fff !important; }" +
                elanSubtitle({ expr: titleCase("hass.states['" + id + "'] && (hass.states['" + id + "'].attributes.hvac_action || hass.states['" + id + "'].state)") }) +
                " .bubble-sub-button-1 { font-size: 30px !important; font-weight: 300 !important; } .bubble-sub-button-1 * { font-size: 30px !important; font-weight: 300 !important; }" +
                " @media (max-width: 520px) { .bubble-sub-button-1, .bubble-sub-button-1 * { font-size: 21px !important; } }",
              ...action(go(thermostatHash(id))),
            })),
          ],
          popupsWhere((h) => h.startsWith("#thermostat-"))
        )
      );

    // LIGHTING — rooms with the number of devices on; shades follow (ELAN keeps shades under lighting).
    if (items.some((i) => i.path === "lighting")) {
      const content = [elanTitle("Lighting")];
      for (const r of lightRooms) {
        const n = lightsOnExpr(roomLights(r));
        content.push(elanRow({ name: r.name, icon: "mdi:lightbulb-outline", value: n, label: "'Devices on'", tap: go(`${base}/lighting-${slug(r.name)}`) }));
      }
      if (shadeRooms.length) {
        content.push(elanSubhead("Shades"));
        for (const r of shadeRooms)
          for (const id of r.entities.filter((e) => domainOf(e) === "cover" && !/garage|gate/i.test(hass.states[e].attributes.device_class || ""))) {
            const c = entityCard(hass, id);
            c.styles = ((c.styles || "") + " " + ELAN_ROW_STYLE).trim();
            content.push(c);
          }
      }
      views.push(view("lighting", "Lighting", content, popupsWhere((h) => h.endsWith("-lights"))));
    }

    // LIGHTING ROOM PAGES — "◀ Room ▶" switcher, a wide slider per dimmer, on/off loads, the room's scenes,
    // and a wide dark-red "<Room> All Off" (acts only on what is on), as on the ELAN lighting room screen.
    if (items.some((i) => i.path === "lighting"))
      lightRooms.forEach((r, i) => {
        const prev = lightRooms[(i - 1 + lightRooms.length) % lightRooms.length];
        const next = lightRooms[(i + 1) % lightRooms.length];
        const loads = [...roomLights(r), ...r.entities.filter((id) => domainOf(id) === "fan")];
        const scenes = r.entities.filter((id) => ["scene", "script"].includes(domainOf(id)));
        const content = [
          elanTitle("Lighting"),
          {
            type: "custom:bubble-card",
            card_type: "button",
            button_type: "name",
            name: r.name,
            icon: "mdi:chevron-left",
            grid_options: { columns: "full" },
            tap_action: go(`${base}/lighting-${slug(prev.name)}`),
            button_action: { tap_action: { action: "none" } },
            sub_button: [{ icon: "mdi:chevron-right", show_background: false, tap_action: go(`${base}/lighting-${slug(next.name)}`) }],
            styles:
              ".bubble-button-card-container { background: none !important; } .bubble-button-background { opacity: 0 !important; }" +
              " .bubble-main-icon-container { background: transparent !important; } .bubble-icon, .bubble-sub-button ha-icon { --mdc-icon-size: 34px; color: #f2f5fa !important; }" +
              " .bubble-name-container { margin: 0 auto !important; align-items: center !important; } .bubble-name { font-size: 24px !important; font-weight: 300 !important; line-height: 1.35 !important; overflow: visible !important; }",
          },
        ];
        for (const id of loads) {
          const c = entityCard(hass, id, { half: "full" });
          c.name = shortLabel(r, hass, id);
          c.grid_options = { columns: "full" };
          c.styles =
            (c.styles || "") +
            " " + ELAN_ROW_STYLE +
            " .bubble-range-fill { background: rgba(47,127,224,.28) !important; border-right: 2px solid " + ELAN_ACCENT + "; }" +
            " .bubble-state { font-size: 13px !important; opacity: .7; }";
          content.push(c);
        }
        if (scenes.length) {
          content.push(elanSubhead("Scenes"));
          content.push({
            type: "grid",
            columns: 3,
            square: false,
            cards: scenes.map((id) => ({
              type: "custom:bubble-card",
              card_type: "button",
              button_type: "name",
              entity: id,
              name: shortLabel(r, hass, id),
              show_icon: false,
              styles:
                `.bubble-button-card-container { background: ${domainOf(id) === "scene" ? "rgba(40,150,90,.55)" : "rgba(255,255,255,.12)"} !important; border-radius: 4px !important; }` +
                " .bubble-button-background, .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin: 0 auto !important; align-items: center !important; }",
              ...action({ action: "perform-action", perform_action: domainOf(id) === "scene" ? "scene.turn_on" : "script.turn_on", target: { entity_id: id } }),
            })),
          });
        }
        const off = liveBulk(loads, ["on"], "homeassistant.turn_off", { confirm: false });
        content.push({
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          name: `${r.name} All Off`,
          show_icon: false,
          grid_options: { columns: "full" },
          styles:
            ".bubble-button-card-container { background: rgba(140,22,22,.85) !important; border-radius: 4px !important; } .bubble-button-background, .bubble-main-icon-container { display: none !important; }" +
            " .bubble-name-container { margin: 0 auto !important; align-items: center !important; } .bubble-name { font-size: 18px !important; font-weight: 400 !important; } " + off.hook,
          ...off.actions,
        });
        views.push(view(`lighting-${slug(r.name)}`, r.name, content, [], "lighting"));
      });

    // MEDIA — "All Zones Off", what's playing, then every zone with its source and a volume bar (› opens the zone).
    if (items.some((i) => i.path === "media")) {
      const allAudio = mediaRooms.flatMap((r) => roomMediaSplit(r, hass).audio);
      const allTvs = mediaRooms.flatMap((r) => roomMediaSplit(r, hass).tvs);
      const off = liveBulk(allAudio, ["playing"], "media_player.media_pause", {
        confirm: false,
        extra: allTvs.length ? [{ ids: allTvs, states: ["on", "playing", "paused", "idle", "buffering"], service: "media_player.turn_off" }] : [],
      });
      const content = [
        elanTitle("Media Zones"),
        { type: "custom:bubble-card", card_type: "button", button_type: "name", name: "All Zones Off", icon: "mdi:power", grid_options: { columns: "full" }, styles: ELAN_ROW_STYLE + " " + off.hook, ...off.actions },
        // Now playing: one card per speaker, shown only while it plays.
        ...[...new Set(allAudio)].map((id) => ({
          type: "conditional",
          conditions: [{ condition: "state", entity: id, state: "playing" }],
          card: AUDIO_CARD === "mediocre"
            ? { type: "custom:mediocre-media-player-card", entity_id: id, use_art_colors: true, tap_opens_popup: false, options: { show_volume_step_buttons: true } }
            : { type: "media-control", entity: id },
          grid_options: { columns: "full" },
        })),
      ];
      for (const r of mediaRooms) {
        const m = roomMediaSplit(r, hass);
        const id = m.audio[0] || m.tvs[0];
        const players = [...m.audio, ...m.tvs];
        const src =
          "((() => { const p = " + JSON.stringify(players) + ".map((e) => hass.states[e]).filter(Boolean); const a = p.find((s) => s.state === 'playing');" +
          " if (a) return (a.attributes.source || a.attributes.app_name || 'Music') + ''; if (p.some((s) => ['on', 'idle'].includes(s.state) && " + JSON.stringify(m.tvs) + ".includes(s.entity_id))) return 'TV'; return 'Off'; })())";
        content.push({
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "slider",
          entity: id,
          name: r.name,
          icon: r.icon,
          show_state: false,
          grid_options: { columns: "full" },
          sub_button: [{ icon: "mdi:chevron-right", show_background: false, tap_action: go("#" + slug(r.name) + (m.audio.length ? "-audio" : "-tv")) }],
          styles: ELAN_ROW_STYLE + elanSubtitle({ expr: src }) + " .bubble-range-fill { background: rgba(47,127,224,.22) !important; border-right: 2px solid #2f7fe0; }",
        });
      }
      views.push(view("media", "Media", content, popupsWhere((h) => h.endsWith("-audio") || h.endsWith("-tv"))));
    }

    // Summaries (e.g. Sprinklers → "Irrigation"): one row per zone, RUNNING / OFF, › opens the zone's own pop-up.
    for (const sm of summaries) {
      const path = slug(sm.name);
      const byEntity = {};
      for (const pp of sm.popups || []) if (pp.entity) byEntity[pp.entity] = pp.hash;
      const title = /sprinkl/i.test(sm.name) ? "Irrigation" : sm.name;
      const content = [elanTitle(title)];
      for (const id of sm.entities || []) {
        if (!hass.states[id]) continue;
        const card = (sm.cards || []).find((c) => c.entity === id) || {};
        content.push(
          elanRow({
            name: card.name || label(id),
            icon: card.icon || sm.icon || "mdi:sprinkler-variant",
            sub: "Zone",
            value: "(hass.states['" + id + "'] && hass.states['" + id + "'].state === 'on' ? 'Running' : 'Off')",
            tap: byEntity[id] ? go(byEntity[id]) : { action: "more-info" },
            extra: byEntity[id] ? {} : { entity: id },
          })
        );
      }
      views.push(view(path, title, content, sm.popups || []));
    }

    // VIDEO — camera list; selecting one opens it full screen.
    if (items.some((i) => i.path === "video"))
      views.push(
        view("video", "Video", [
          elanTitle("Video"),
          ...ctx.cameras.map((id) =>
            elanRow({ name: label(id).replace(/\s+(High|Medium|Low) resolution channel$/i, ""), icon: "mdi:cctv", sub: "Camera", tap: { action: "more-info" }, extra: { entity: id } })
          ),
        ])
      );

    // Extra views (e.g. Pool) keep their own content, inside the ELAN frame.
    for (const v of extra) {
      const cards = (v.sections || []).flatMap((x) => x.cards || []);
      // Drop a heading that only repeats the page title (the ELAN title already shows it).
      if (cards[0] && cards[0].type === "heading" && (cards[0].heading || "").toLowerCase() === (v.title || "").toLowerCase()) cards.shift();
      const bodies = cards.filter((c) => ["thermostat", "custom:bubble-card"].includes(c.type) && domainOf(c.entity || "") === "climate" && /pool|spa/i.test(c.entity + " " + (c.name || "")));
      views.push(view(v.path, v.title, bodies.length ? [elanTitle(v.title), ...elanPool(hass, cards, bodies)] : [elanTitle(v.title), ...cards]));
    }

    return { title: cfg.title, views };
  }
}

/* ------------------------------------------------------------------ */

if (!customElements.get("ll-strategy-dashboard-pivit-home")) {
  customElements.define("ll-strategy-dashboard-pivit-home", PivitHomeStrategy);
  console.info(`%c PivIT Home %c v${VERSION} `, "background:#1f6feb;color:#fff;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
}

if (!customElements.get("ll-strategy-dashboard-pivit-elan")) {
  customElements.define("ll-strategy-dashboard-pivit-elan", PivitElanStrategy);
}
