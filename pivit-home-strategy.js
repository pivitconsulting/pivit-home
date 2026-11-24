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

const VERSION = "1.1.89";

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
  camera_order: [], // camera entity_ids shown first (in this order) on camera pages; the rest follow
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
    cfg.intercoms = enrichIntercoms(cfg.intercoms, hass);
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
    return { title: cfg.title, views, kiosk_mode: kioskMode(cfg) };
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
  // camera_order: listed cameras first (in that order), then the rest as found.
  const camOrder = cfg.camera_order || [];
  const camRank = (id) => (camOrder.indexOf(id) === -1 ? camOrder.length : camOrder.indexOf(id));
  cameras.sort((a, b) => camRank(a) - camRank(b));

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

// Resolve what the hold-open picker needs: the UniFi Access device behind the lock-rule select (custom durations go
// through unifi_access.set_lock_rule) and an input_datetime that records when the hold ends (for the countdown):
// `hold_end_entity`, or input_datetime.pivit_<gate name>_open_until when it exists.
// Kiosk Mode (NemesisRE/kiosk-mode, when installed) reads `kiosk_mode` from the dashboard config: by default the
// Home Assistant header and sidebar are hidden for non-admin users (e.g. a wall iPad or family phones); admins keep
// them. Override with the `kiosk_mode` option, or `kiosk_mode: false` to turn it off. `?disable_km` shows the menus.
function kioskMode(cfg) {
  if (cfg.kiosk_mode === false) return undefined;
  return cfg.kiosk_mode || { non_admin_settings: { hide_header: true, hide_sidebar: true } };
}

function enrichIntercoms(intercoms, hass) {
  return (intercoms || []).map((ic) => {
    const ent = ic.lock_rule && hass.entities && hass.entities[ic.lock_rule];
    const dev = ent && ent.platform === "unifi_access" ? ent.device_id : null;
    const autoEnd = `input_datetime.pivit_${slug(ic.name || "gate").replace(/-/g, "_")}_open_until`;
    return { ...ic, hold_device_id: ic.hold_device_id || dev, hold_end_entity: ic.hold_end_entity || (hass.states[autoEnd] ? autoEnd : null) };
  });
}

// "Held Open · 23 min" countdown text (JS expression for Bubble templates).
function holdRemainingExpr(ic) {
  if (!ic.hold_end_entity) return "''";
  return "((e) => { var p = e ? String(e.state).split(':').map(Number) : []; if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) return ''; var d = new Date(); d.setHours(p[0], p[1], p[2] || 0, 0);" +
    " var m = Math.ceil((d - Date.now()) / 60000); if (m < -720) m += 1440; if (m <= 0) return ''; return m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; })(hass.states['" + ic.hold_end_entity + "'])";
}
function holdHeldExpr(ic) {
  const status = ic.lock_rule_sensor || ic.lock_rule;
  return "(" + JSON.stringify([ic.hold_option || "keep_unlock", "custom"]) + ".includes(hass.states['" + status + "'] && hass.states['" + status + "'].state))";
}

function intercomStatusSubs(ic, tap) {
  const base = { entity: ic.status_sensor, show_state: true, show_icon: true, show_background: false, tap_action: tap || { action: "more-info" } };
  const status = ic.lock_rule_sensor || ic.lock_rule;
  const held = [ic.hold_option || "keep_unlock", "custom"];
  const notHeld = status ? [{ condition: "state", entity: status, state_not: held }] : [];
  return [
    { ...base, icon: "mdi:gate", visibility: [{ condition: "state", entity: ic.status_sensor, state_not: "on" }, ...notHeld] },
    { ...base, icon: "mdi:gate-open", visibility: [{ condition: "state", entity: ic.status_sensor, state: "on" }, ...notHeld] },
    // While a hold is active: "Held Open · 23 min" (text drawn by intercomStatusStyles).
    ...(status ? [{ ...base, entity: status, icon: "mdi:gate-open", show_state: false, show_name: false, visibility: [{ condition: "state", entity: status, state: held }] }] : []),
  ];
}
// Yellow while open (the open sub-button is the second of the pair starting at `idx`).
function intercomStatusStyles(ic, idx) {
  const o = idx + 1;
  const h = idx + 2;
  return `.bubble-sub-button-${o}, .bubble-sub-button-${o} ha-icon, .bubble-sub-button-${o} ha-state-icon { color: var(--accent-color) !important; }` +
    ` .bubble-sub-button-${h}, .bubble-sub-button-${h} ha-icon { color: var(--accent-color) !important; }` +
    ` .bubble-sub-button-${h}::after { content: "\${'Held Open' + ((r) => r ? ' · ' + r : '')(${holdRemainingExpr(ic)})}"; margin-left: 4px; white-space: nowrap; }`;
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
    const key = slug(ic.name || "gate");
    let holdPicker = null; // shown under the Open / Hold Open row
    if (ic.hold_device_id) {
      // Hold Open shows a picker of how long to hold the gate open; picking one holds it through UniFi Access
      // (custom lock rule for that many minutes, or keep_unlock for "Until cancelled") and records the end time.
      const durations = ic.hold_durations || [15, 30, 60, 120, 240, 0];
      const labelOf = (m) => (m === 0 ? "Until cancelled" : m < 60 ? m + " min" : m / 60 + " hr");
      const toggleHook =
        "${(card.__pvHk || (card.__pvHk = 1, card.addEventListener('click', function () { var W = (window.__pvHold = window.__pvHold || {});" +
        " W[" + JSON.stringify(key) + "] = !W[" + JSON.stringify(key) + "]; window.dispatchEvent(new CustomEvent('pv-hold-" + key + "')); })), '')}";
      cards.push({
        type: "conditional",
        conditions: [{ condition: "state", entity: status, state_not: heldStates }],
        card: { ...btn("Hold Open", "mdi:gate-open", { action: "none" }), styles: toggleHook },
        grid_options: { columns: 6 },
      });
      const pickHook =
        "${(card.__pvPk || (card.__pvPk = 1, (function () { var key = " + JSON.stringify(key) + ", W = (window.__pvHold = window.__pvHold || {});" +
        " var outer = function () { var n = card.getRootNode().host; for (var i = 0; i < 6 && n && n.parentElement; i++) { if (n.parentElement.classList && (n.parentElement.classList.contains('bubble-cards-grid') || n.parentElement.classList.contains('bubble-cards-container'))) return n; n = n.parentElement; } return card.getRootNode().host; };" +
        " var sync = function () { var o = outer(); if (o) o.style.display = W[key] ? '' : 'none'; };" +
        " window.addEventListener('pv-hold-' + key, sync); window.addEventListener('hashchange', function () { W[key] = false; sync(); }); setTimeout(sync, 0); setTimeout(sync, 400);" +
        " var mins = " + JSON.stringify(durations) + ";" +
        " card.addEventListener('click', function (ev) { var path = ev.composedPath(), n = 0;" +
        "   for (var i = 1; i <= mins.length; i++) if (path.some(function (e) { return e.classList && e.classList.contains('bubble-sub-button-' + i); })) n = i;" +
        "   if (!n) return; var m = mins[n - 1];" +
        "   var act = function (svc, data) { card.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { action: 'tap', config: { tap_action: { action: 'perform-action', perform_action: svc, data: data } } } })); };" +
        "   if (m) act('unifi_access.set_lock_rule', { device_id: " + JSON.stringify(ic.hold_device_id) + ", rule: 'custom', interval: { hours: Math.floor(m / 60), minutes: m % 60 } });" +
        "   else act('unifi_access.set_lock_rule', { device_id: " + JSON.stringify(ic.hold_device_id) + ", rule: " + JSON.stringify(ic.hold_option || "keep_unlock") + " });" +
        (ic.hold_end_entity
          ? "   if (m) { var d = new Date(Date.now() + m * 60000), z = function (x) { return (x < 10 ? '0' : '') + x; };" +
            "     act('input_datetime.set_datetime', { entity_id: " + JSON.stringify(ic.hold_end_entity) + ", time: z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()) }); }"
          : "") +
        "   W[key] = false; sync(); });" +
        " })()), '')}";
      holdPicker = {
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "name",
        name: "Hold open for",
        show_icon: false,
        grid_options: { columns: "full" },
        sub_button: durations.map((m) => ({ name: labelOf(m), icon: "mdi:timer-outline", show_name: true, show_icon: false, show_background: true, tap_action: { action: "none" } })),
        styles:
          ".bubble-button-card-container { height: 132px !important; } .bubble-button-card { flex-direction: column !important; align-items: stretch !important; padding: 10px 12px !important; height: 100%; box-sizing: border-box; gap: 8px; }" +
          " .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin: 0 !important; } .bubble-name { font-size: 13px !important; opacity: .75; text-transform: uppercase; letter-spacing: .08em; }" +
          " .bubble-sub-button-container { display: grid !important; grid-template-columns: repeat(3, 1fr); gap: 6px !important; width: 100% !important; position: static !important; margin: 0 !important; }" +
          " .bubble-sub-button { height: 38px !important; width: auto !important; margin: 0 !important; justify-content: center !important; }" +
          " .bubble-sub-button .bubble-sub-button-name-container { font-size: 13px !important; opacity: 1 !important; }" +
          " " + pickHook,
        tap_action: { action: "none" },
        button_action: { tap_action: { action: "none" } },
      };
    } else
      cards.push({
        type: "conditional",
        conditions: [{ condition: "state", entity: status, state_not: heldStates }],
        card: btn("Hold Open", "mdi:gate-open", rule(ic.hold_option || "keep_unlock", `Hold ${ic.name || "the gate"} open until you cancel it?`)),
        grid_options: { columns: 6 },
      });
    cards.push({
      type: "conditional",
      conditions: [{ condition: "state", entity: status, state: heldStates }],
      card: btn(ic.held_name || "Held Open", "mdi:gate-open", rule(ic.normal_option || "reset"), {
        styles:
          iconFillWhen("true", "var(--accent-color)") +
          " .bubble-name-container::after { content: \"${((r) => r ? r + ' left · ' : '')(" + holdRemainingExpr(ic) + ") + 'Press to cancel'}\"; display: block; font-size: 11px; opacity: .7; }",
      }),
      grid_options: { columns: 6 },
    });
    if (holdPicker) cards.push(holdPicker);
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
const ELAN_HEAT = "#d23c3c";
const ELAN_COOL_BOX = "rgba(28,36,140,.9)"; // ELAN climate setpoint boxes: cool navy, heat dark red
const ELAN_HEAT_BOX = "rgba(120,26,26,.9)";
const ELAN_WIDE = "(min-width: 1000px)";
const ELAN_NARROW = "(max-width: 999px)";
const ELAN_ROW_BG = "rgba(12,14,22,.72)";

// Translucent ELAN row look, shared by the row helpers below.
const ELAN_ROW_STYLE =
  `.bubble-button-card-container, .bubble-container { background: ${ELAN_ROW_BG} !important; border: 1px solid rgba(255,255,255,.06); border-radius: 6px !important; --bubble-border-radius: 6px; --bubble-button-border-radius: 6px; --bubble-card-type-border-radius: 6px; --bubble-media-player-border-radius: 6px; --bubble-sub-slider-border-radius: 4px; --bubble-select-button-border-radius: 4px; }` +
  " .bubble-range-slider, .bubble-background { border-radius: 6px !important; }" +
  " .bubble-button-background { opacity: 0 !important; }" +
  ` .bubble-main-icon-container { background: transparent !important; border-radius: 0 !important; box-shadow: inset 0 -3px 0 ${ELAN_ACCENT}; }` +
  " .bubble-icon { color: #e9eef7 !important; --mdc-icon-size: 26px; }" +
  " .bubble-name { font-size: 19px !important; font-weight: 300 !important; letter-spacing: .01em; line-height: 1.35 !important; padding-bottom: 1px; }" +
  // Phones: smaller type, slimmer LOCK/UNLOCK, setpoints hidden (the row opens the full thermostat controls).
  " @media (max-width: 520px) { .bubble-name { font-size: 16px !important; } .bubble-sub-button-1::before { font-size: 20px !important; }" +
  " .bubble-sub-button-1 * { font-size: 20px !important; } .bubble-sub-button-container .bubble-sub-button[class*='bubble-sub-button-'] { min-width: 0; }" +
  " .bubble-temperature-container, .bubble-target-temperature-container { display: none !important; } .bubble-buttons-container::before { font-size: 30px !important; } }";

// Mediocre media cards and other standard HA cards in ELAN colours (see the card's CSS variables).
const ELAN_CARD_VARS =
  " --mmpc-card: rgba(12,14,22,.72); --mmpc-on-card: #f2f5fa; --mmpc-on-card-muted: rgba(242,245,250,.6); --mmpc-on-card-divider: rgba(255,255,255,.12);" +
  " --mmpc-dialog: #1d2244; --mmpc-on-dialog: #f2f5fa; --mmpc-on-dialog-muted: rgba(242,245,250,.6); --mmpc-on-dialog-divider: rgba(255,255,255,.12);" +
  " --mmpc-art-border-radius: 4px; --mmpc-chip-background: rgba(255,255,255,.08); --mmpc-chip-foreground: #f2f5fa;" +
  ` --slider-on-fill-color: ${ELAN_ACCENT}; --primary-color: ${ELAN_ACCENT}; --accent-color: ${ELAN_ACCENT}; --state-media_player-active-color: ${ELAN_ACCENT};` +
  " --divider-color: rgba(255,255,255,.12); --secondary-background-color: rgba(255,255,255,.08); --card-background-color: #1d2244; --ha-card-border-radius: 6px;";
// Set on each ELAN page by its title card, so cards outside pop-ups (e.g. the Media page's now-playing cards) follow.
const ELAN_PAGE_VARS = ELAN_CARD_VARS + " --ha-card-background: rgba(12,14,22,.72); --ha-card-border-width: 1px; --ha-card-border-color: rgba(255,255,255,.06);";
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
    " .bubble-name-container { margin: 0 auto !important; align-items: center !important; } .bubble-name { font-size: 26px !important; font-weight: 300 !important; text-align: center; line-height: 1.35 !important; overflow: visible !important; }" +
    // Once on screen, put the ELAN card colours on the page (the sections view) so standard cards on it follow them.
    " ${(card.__pvTheme || (card.__pvTheme = 1, (function paint(tries) { var n = card; for (var i = 0; i < 60 && n; i++) { n = n.parentNode || n.host;" +
    " if (n && n.tagName === 'HUI-SECTIONS-VIEW') { if (!n.__pvElan) { n.__pvElan = 1; n.style.cssText += " + JSON.stringify(ELAN_PAGE_VARS) + "; } return; } }" +
    " if (tries < 20) setTimeout(function () { paint(tries + 1); }, 250); })(0)), '')}",
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
// Keeps the ELAN menu in the vertical middle of the screen (wide layout): the menu's stack is fixed at 50% of the
// window, lined up with its column (re-measured on resize). Added to the first menu button.
// Keeps the ELAN menu in the vertical middle of the screen (wide layout). The menu's grid cell gets a top margin that
// centres it in the window at the top of the page, and sticks at that height while the page scrolls (HA's view
// container breaks position: fixed, so this uses margin + sticky). Re-measured on resize. Added to the first menu button.
// Vertical centring hook: the card's vertical-stack (menu or page content) is centred in the window by a top margin on
// its grid cell; with sticky, it also stays there while the page scrolls (menu). Re-measured on resize and whenever the
// stack changes height (e.g. Home alert chips appearing). HA's view container breaks position: fixed, hence margin.
const elanCenterHook = (flag, sticky, visTopSel) =>
  " ${(card." + flag + " || (card." + flag + " = 1, (function pin(tries) {" +
  " var up = function (n) { return n.parentElement || (n.parentNode && n.parentNode.host) || null; };" +
  " var n = card, stack = null; for (var i = 0; i < 40 && n; i++) { n = up(n); if (n && n.tagName === 'HUI-VERTICAL-STACK-CARD') { stack = n; break; } }" +
  " var item = stack; while (item && up(item) && getComputedStyle(up(item)).display !== 'grid') item = up(item);" +
  " if (!item || !stack.getBoundingClientRect().height) { if (tries < 30) setTimeout(function () { pin(tries + 1); }, 300); return; }" +
  " var hdrEl = null; for (var m = card, j = 0; j < 60 && m; j++) { m = up(m); if (m && m.tagName === 'HUI-ROOT') { hdrEl = m.shadowRoot && m.shadowRoot.querySelector('.header'); break; } }" +
  " var place = function () { var h = stack.getBoundingClientRect().height; if (!h) return; item.style.marginTop = '0px';" +
  // Centre in the visible area: below Home Assistant's header bar when it shows (admins), the whole window when hidden.
  " var hb = hdrEl ? hdrEl.getBoundingClientRect() : null; var areaTop = hb && hb.height && getComputedStyle(hdrEl).display !== 'none' ? Math.max(0, hb.bottom) : 0;" +
  // visTopSel: centre from where the visible content starts (e.g. the Home clock card has empty space above "HOME").
  " var off = 0; " + (visTopSel
    ? "var vt = card.querySelector(" + JSON.stringify(visTopSel) + ") || card.getRootNode().querySelector(" + JSON.stringify(visTopSel) + "); var st0 = stack.getBoundingClientRect().top;" +
      // Visible bottom: the lowest drawn element in the stack (alert chips can spill past their card's box).
      " var bot = stack.getBoundingClientRect().bottom; (function walk(r) { r.querySelectorAll('*').forEach(function (e) { var b = e.getBoundingClientRect(); if (b.height && b.width && b.bottom > bot && b.bottom < st0 + 3000) bot = b.bottom; if (e.shadowRoot) walk(e.shadowRoot); }); })(stack.shadowRoot || stack);" +
      " if (vt) { off = Math.max(0, vt.getBoundingClientRect().top - st0); } h = bot - st0 - off;"
    : "") +
  " var top0 = item.getBoundingClientRect().top + (window.scrollY || 0) + off; var want = areaTop + Math.max(0, (window.innerHeight - areaTop - h) / 2);" +
  " item.style.alignSelf = 'start';" + (sticky ? " item.style.position = 'sticky'; item.style.top = want + 'px'; item.style.zIndex = '2';" : "") +
  " item.style.marginTop = Math.max(0, want - top0) + 'px'; };" +
  " place(); setTimeout(place, 800); window.addEventListener('resize', place); if (window.ResizeObserver) new ResizeObserver(place).observe(stack); })(0)), '')}";
const ELAN_MENU_CENTER = elanCenterHook("__pvMenu", true);
function elanNav(items, base, current) {
  return items.map((it, idx) => ({
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
      " .bubble-name { font-size: 19px !important; font-weight: 300 !important; line-height: 1.35 !important; padding-bottom: 1px; }" +
      (idx === 0 ? ELAN_MENU_CENTER : ""),
    ...action({ action: "navigate", navigation_path: `${base}/${it.path}` }),
  }));
}

const titleCase = (x) => "(((" + x + ") || '') + '').replace(/_/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase())";


// Effect drop-down for lights that have effects (e.g. pool/spa colour shows): a palette sub-button with the light's
// effect list, ELAN-coloured, plus the current effect after the state. n = the sub-button's 1-based position.
const hasEffects = (hass, id) => domainOf(id) === "light" && hass.states[id] && (hass.states[id].attributes.effect_list || []).length > 0;
const effectSubButton = (id) => ({ entity: id, select_attribute: "effect_list", icon: "mdi:palette", show_icon: true, show_name: false, show_state: false, show_attribute: false, show_arrow: true, show_background: true });
const effectStyles = (id, n) =>
  // Narrow buttons (e.g. three across in a pop-up): drop the bulb icon so the name has room beside the drop-down.
  " .bubble-button-card-container { container-type: inline-size; } @container (max-width: 240px) { .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin-left: 10px !important; min-width: 0 !important; }" +
  " .bubble-name { white-space: normal !important; line-height: 1.15 !important; overflow: visible !important; } .bubble-name .scrolling-container, .bubble-name .bubble-scroll-separator { animation: none !important; transform: none !important; } }" +
  ` .bubble-sub-button-${n} { background: rgba(255,255,255,.12) !important; border-radius: 4px !important; } .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} ha-svg-icon { color: #f2f5fa !important; }` +
  " .bubble-state::after { content: \"${((s) => s && s.state === 'on' && s.attributes.effect ? ' · ' + s.attributes.effect : '')(hass.states['" + id + "'])}\"; }" +
  ` .bubble-sub-button-${n}, .bubble-dropdown-container, mwc-list, ha-list-item, mwc-list-item { --mdc-theme-surface: #1d2244; --mdc-theme-text-primary-on-background: #f2f5fa; --primary-text-color: #f2f5fa; --mdc-theme-primary: ${ELAN_ACCENT}; }`;

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
    // The body's mode switch (pool pump → Pool Mode, spa pump → Spa Mode) sits in its panel beside Heater.
    const mode = ids.find((id) => domainOf(id) === "switch" && new RegExp(`${key}_pump`).test(id));
    used.add(b.entity); if (temp) used.add(temp); if (heater) used.add(heater); if (mode) used.add(mode);
    const modeOn = mode ? "(hass.states['" + mode + "'] && hass.states['" + mode + "'].state === 'on')" : "false";
    const hIdx = mode ? 2 : 1; // heater sub-button position
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
      ...action({ action: "more-info" }),
      sub_button: [
        ...(mode
          ? [{ entity: mode, name: `${title} Mode`, icon: "mdi:pump", show_name: true, show_icon: true, show_background: true, tap_action: { action: "toggle" } }]
          : []),
        ...(heater
          ? [{ entity: heater, name: "Heater", icon: "mdi:fire", show_name: true, show_icon: true, show_background: true, tap_action: { action: "toggle" } }]
          : []),
      ],
      styles:
        ELAN_ROW_STYLE +
        " .bubble-color-background { opacity: 0 !important; }" +
        " .bubble-high-temp-container, .bubble-low-temp-container, .bubble-target-temperature-container, .bubble-temperature-container { background: rgba(200,40,40,.6) !important; border-radius: 4px !important; }" +
        " .bubble-climate-temp-display, .bubble-climate-temp-display * { color: #fff !important; }" +
        " .bubble-name { font-size: 24px !important; }" +
        elanSubtitle({ expr: "(" + heaterOn + " ? 'Heater on' : 'Heater off') + ' · set ' + ((hass.states['" + b.entity + "'] || { attributes: {} }).attributes.temperature || '--') + '°'" }) +
        " .bubble-buttons-container::before { content: \"${" + tempExpr + "}\"; font-size: 46px; font-weight: 200; line-height: 1; margin-right: 18px; align-self: center; }" +
        // Phones: keep the − / + setpoint controls (they win over the row style's phone rule); the water temperature
        // moves into the subtitle to make room.
        " @media (max-width: 520px) { .bubble-temperature-container, .bubble-target-temperature-container { display: flex !important; }" +
        " .bubble-buttons-container::before { content: none !important; } .bubble-sub-button .bubble-sub-button-name-container { display: none !important; }" +
        " .bubble-name-container::after { content: \"${" + tempExpr + " + ' · ' + (" + heaterOn + " ? 'heating' : 'heater off')}\" !important; } }" +
        (heater
          ? ` .bubble-sub-button-${hIdx} { background: \${` + heaterOn + ` ? 'rgba(200,40,40,.85)' : 'rgba(255,255,255,.08)'} !important; border-radius: 4px !important; }` +
            ` .bubble-sub-button-${hIdx} ha-icon { color: \${` + heaterOn + ` ? '#fff' : '#f5a442'} !important; }`
          : "") +
        (mode
          ? " .bubble-sub-button-1 { background: ${" + modeOn + " ? '" + ELAN_ACCENT + "' : 'rgba(255,255,255,.08)'} !important; border-radius: 4px !important; }" +
            " .bubble-sub-button-1 ha-icon { color: ${" + modeOn + " ? '#fff' : '#9cc5f5'} !important; }"
          : ""),
    });
  }
  // "All Pool Off" (like Media's All Zones Off): turns off every pump, light, feature and heater on the card that is on.
  const offIds = [...new Set(cards.map((c) => c.entity).filter((e) => e && ["switch", "light", "fan", "input_boolean"].includes(domainOf(e))))];
  if (offIds.length) {
    const off = liveBulk(offIds, ["on"], "homeassistant.turn_off", { confirm: false });
    out.unshift({
      type: "custom:bubble-card", card_type: "button", button_type: "name", name: "All Pool Off", icon: "mdi:power", grid_options: { columns: "full" },
      styles: ELAN_ROW_STYLE + " .bubble-name-container::after { content: \"${" + JSON.stringify(offIds) + ".filter((e) => (hass.states[e] || {}).state === 'on').length ? " + JSON.stringify(offIds) + ".filter((e) => (hass.states[e] || {}).state === 'on').length + ' on' : 'All off'}\"; display: block; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; opacity: .6; } " + off.hook,
      ...off.actions,
    });
  }
  // Toggles: pumps, lights, features.
  const toggles = cards.filter((c) => c.entity && ["switch", "light", "fan", "input_boolean", "sensor"].includes(domainOf(c.entity)) && !used.has(c.entity));
  toggles.forEach((c) => used.add(c.entity));
  if (toggles.length)
    out.push({
      type: "grid",
      columns: 3,
      square: false,
      grid_options: { columns: "full" },
      cards: toggles.map((c) => {
        // Readings (e.g. Air Temp): same size as the buttons, value in whole degrees, not tappable.
        if (domainOf(c.entity) === "sensor") {
          const val = "((s) => !s ? '--' : !isNaN(parseFloat(s.state)) && /°|temperature/.test((s.attributes.unit_of_measurement || '') + (s.attributes.device_class || '')) ? Math.round(parseFloat(s.state)) + '°' : s.state + (s.attributes.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : ''))(hass.states['" + c.entity + "'])";
          return {
            type: "custom:bubble-card",
            card_type: "button",
            button_type: "name",
            name: nameOf(c),
            icon: (ent(c.entity) && ent(c.entity).attributes.icon) || "mdi:thermometer",
            styles:
              ".bubble-button-background { opacity: 0 !important; }" +
              " .bubble-button-card-container { background: " + ELAN_ROW_BG + " !important; border: 1px solid rgba(255,255,255,.08); border-radius: 4px !important; }" +
              " .bubble-main-icon-container { background: transparent !important; } .bubble-icon { color: #f2f5fa !important; }" +
              " .bubble-name { font-size: 15px !important; } .bubble-name-container::after { content: \"${" + val + "}\"; display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }" +
              " @media (max-width: 520px) { .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin-left: 10px !important; } .bubble-name { font-size: 13px !important; } }",
            tap_action: { action: "none" },
            button_action: { tap_action: { action: "none" } },
          };
        }
        const on = "(hass.states['" + c.entity + "'] && hass.states['" + c.entity + "'].state === 'on')";
        const fx = hasEffects(hass, c.entity);
        return {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          entity: c.entity,
          name: nameOf(c),
          show_state: true,
          ...(fx ? { sub_button: [effectSubButton(c.entity)] } : {}),
          styles:
            (fx ? effectStyles(c.entity, 1) : "") +
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
        value: "((s) => !s ? '--' : /°|temperature/.test((s.attributes.unit_of_measurement || '') + (s.attributes.device_class || '')) && !isNaN(parseFloat(s.state)) ? Math.round(parseFloat(s.state)) + '°' : s.state + (s.attributes.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : ''))(hass.states['" + c.entity + "'])",
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
  ".bubble-pop-up { --bubble-pop-up-border-radius: 10px; --bubble-border-radius: 6px; --bubble-button-border-radius: 6px; --bubble-card-type-border-radius: 6px; --bubble-media-player-border-radius: 6px; --bubble-sub-slider-border-radius: 4px; --bubble-select-button-border-radius: 4px; --bubble-sub-button-border-radius: 4px;" +
  " --bubble-main-background-color: rgba(255,255,255,.08);" +
  " --bubble-secondary-background-color: rgba(255,255,255,.08); --bubble-media-player-buttons-border-radius: 4px;" +
  " --ha-card-background: rgba(255,255,255,.06); --ha-card-border-radius: 6px; --card-background-color: #1d2244;" +
  // ELAN palette: heat red, everything else that is "active" ELAN blue (HA thermostat dial, mode buttons, light/fan/switch fills).
  ` --primary-color: ${ELAN_ACCENT}; --accent-color: ${ELAN_ACCENT}; --state-active-color: ${ELAN_ACCENT}; --state-icon-active-color: ${ELAN_ACCENT};` +
  ` --state-climate-heat-color: ${ELAN_HEAT}; --state-climate-cool-color: ${ELAN_ACCENT}; --state-climate-heat_cool-color: ${ELAN_ACCENT};` +
  ` --state-climate-auto-color: ${ELAN_ACCENT}; --state-climate-dry-color: ${ELAN_ACCENT}; --state-climate-fan_only-color: ${ELAN_ACCENT};` +
  ` --state-light-active-color: ${ELAN_ACCENT}; --state-light-on-color: ${ELAN_ACCENT}; --state-fan-active-color: ${ELAN_ACCENT}; --state-switch-active-color: ${ELAN_ACCENT};` +
  ` --state-input_boolean-active-color: ${ELAN_ACCENT}; --state-media_player-active-color: ${ELAN_ACCENT}; --state-cover-active-color: ${ELAN_ACCENT};` +
  ` --state-lock-locked-color: ${ELAN_ACCENT}; --state-lock-unlocked-color: ${ELAN_HEAT}; --bubble-accent-color: ${ELAN_ACCENT}; --switch-checked-color: ${ELAN_ACCENT};` +
  ` --state-alarm_control_panel-disarmed-color: ${ELAN_ACCENT}; --state-alarm_control_panel-armed_home-color: ${ELAN_HEAT}; --state-alarm_control_panel-armed_away-color: ${ELAN_HEAT};` +
  ` --state-alarm_control_panel-armed_night-color: ${ELAN_HEAT}; --state-alarm_control_panel-armed_vacation-color: ${ELAN_HEAT}; --state-alarm_control_panel-triggered-color: ${ELAN_HEAT};` +
  ` --mdc-theme-primary: ${ELAN_ACCENT}; --secondary-background-color: rgba(255,255,255,.08); --divider-color: rgba(255,255,255,.12);` +
  ELAN_CARD_VARS.replace('--card-background-color: #1d2244;', '') + ' }' +
  // The panel itself: ELAN night-sky navy (Bubble would otherwise paint it with the row colour → grey).
  " .bubble-pop-up-background { background: linear-gradient(175deg, rgba(42,47,92,.97) 0%, rgba(23,26,51,.97) 55%, rgba(13,15,30,.97) 100%) !important; }" +
  " .bubble-header-container .bubble-name { font-weight: 300 !important; font-size: 19px !important; line-height: 1.35 !important; height: auto !important; padding-bottom: 1px; }" +
  // Bubble's 18px line box clips descenders (g, y) at 19px: give the title room.
  " .bubble-header-container .bubble-name-container { line-height: 1.35 !important; height: auto !important; min-width: 0 !important; }" +
  // Phones: smaller title so it clears the title-bar buttons (All Off, lock).
  " @media (max-width: 520px) { .bubble-header-container .bubble-name { font-size: 16px !important; white-space: nowrap; overflow: hidden !important; text-overflow: ellipsis; } }";
// Phones: names in pop-up buttons wrap onto two lines instead of scrolling (e.g. "Master Bedroom LEDs" in a half-width button).
const ELAN_PHONE_NAME_STYLE =
  " @media (max-width: 520px) { .bubble-name { white-space: normal !important; line-height: 1.2 !important; overflow: visible !important; }" +
  " .bubble-name .scrolling-container, .bubble-name .bubble-scroll-separator { animation: none !important; transform: none !important; } }";
// Sliders inside pop-ups fill with ELAN blue (not the bulb's own colour), like the ELAN rows.
const ELAN_SLIDER_STYLE =
  ` .bubble-range-fill { background: rgba(47,127,224,.35) !important; border-right: 2px solid ${ELAN_ACCENT}; opacity: 1 !important; }`;
// Home Assistant's own thermostat card shows decimals (e.g. "Currently 70.9 °F"); on ELAN every thermostat in a pop-up
// becomes the ELAN climate row (whole degrees, ▲ / ▼) plus mode buttons (no system-fan control: left on Auto).
let ELAN_HASS = null;
const ELAN_THERMO_CARDS = new WeakSet(); // cards made by elanThermostat / elanFanCard (for ordering in pop-ups)
const ELAN_FAN_CARDS = new WeakSet();
function elanThermostat(id, name) {
  const st = ELAN_HASS && ELAN_HASS.states[id];
  const label = name || NAMES[id] || (st && st.attributes.friendly_name) || "Thermostat";
  const MODE_NAME = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Auto", auto: "Auto", dry: "Dry", fan_only: "Fan" };
  const modes = (st && st.attributes.hvac_modes) || [];
  const cards = [elanClimateRow(id, label, thermostatHash(id))];
  if (modes.length)
    cards.push({
      type: "grid",
      columns: Math.min(modes.length, 5),
      square: false,
      cards: modes.map((m) => ({
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "name",
        name: MODE_NAME[m] || m,
        show_icon: false,
        styles:
          ".bubble-button-background, .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin: 0 auto !important; align-items: center !important; }" +
          " .bubble-button-card-container { border-radius: 4px !important; border: 1px solid rgba(255,255,255,.1); background: ${(hass.states['" + id + "'] || {}).state === '" + m + "' ? '" +
          (m === "heat" ? ELAN_HEAT : m === "off" ? "rgba(255,255,255,.28)" : ELAN_ACCENT) + "' : 'rgba(255,255,255,.08)'} !important; }",
        ...action({ action: "perform-action", perform_action: "climate.set_hvac_mode", target: { entity_id: id }, data: { hvac_mode: m } }),
      })),
    });
  const out = { type: "vertical-stack", cards, grid_options: { columns: "full" } };
  ELAN_THERMO_CARDS.add(out);
  return out;
}
// Ceiling fans on ELAN: a row with OFF / LOW / MED / HIGH instead of a speed slider. Speeds come from the fan's step
// count (e.g. 7 speeds → low 2, medium 4, high 7); the button nearest the current speed lights up. Tap the name to toggle.
function elanFanCard(id, name) {
  const st = ELAN_HASS && ELAN_HASS.states[id];
  const label = name || NAMES[id] || (st && st.attributes.friendly_name) || id;
  const step = (st && st.attributes.percentage_step) || 100 / 3;
  const n = Math.max(1, Math.round(100 / step));
  const pct = (k) => Math.min(100, Math.round(k * step * 100) / 100);
  const speeds = n >= 3 ? [["Low", pct(Math.max(1, Math.round(n * 0.3)))], ["Med", pct(Math.round(n * 0.57))], ["High", 100]] : [["Low", pct(1)], ["High", 100]];
  const P = "((hass.states['" + id + "'] || {}).state === 'on' ? ((hass.states['" + id + "'] || { attributes: {} }).attributes.percentage || 0) : 0)";
  // Which button is lit: off when off; otherwise the speed with the nearest percentage.
  const lit = (i) =>
    i === 0
      ? "(" + P + " === 0)"
      : "(" + P + " > 0 && " + JSON.stringify(speeds.map((x) => x[1])) + ".reduce((b, v, j, a) => Math.abs(v - " + P + ") < Math.abs(a[b] - " + P + ") ? j : b, 0) === " + (i - 1) + ")";
  const subs = [
    { name: "Off", show_name: true, show_icon: false, show_background: true, tap_action: { action: "perform-action", perform_action: "fan.turn_off", target: { entity_id: id } } },
    ...speeds.map(([nm, v]) => ({ name: nm, show_name: true, show_icon: false, show_background: true, tap_action: { action: "perform-action", perform_action: "fan.set_percentage", target: { entity_id: id }, data: { percentage: v } } })),
  ];
  const card = {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity: id,
    name: label,
    icon: "mdi:ceiling-fan",
    show_state: false,
    grid_options: { columns: "full" },
    sub_button: subs,
    styles:
      ELAN_ROW_STYLE +
      " .bubble-sub-button-container { gap: 6px !important; margin-right: 8px !important; }" +
      " .bubble-sub-button { width: 64px !important; height: 36px !important; justify-content: center !important; border-radius: 4px !important; border: 1px solid rgba(255,255,255,.12); }" +
      " .bubble-sub-button .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .1em; text-transform: uppercase; color: #f2f5fa !important; opacity: 1 !important; }" +
      " @media (max-width: 520px) { .bubble-sub-button { width: 46px !important; } .bubble-sub-button .bubble-sub-button-name-container { font-size: 10px !important; letter-spacing: .03em; } }" +
      subs.map((_, i) => ` .bubble-sub-button-${i + 1} { background: \${${lit(i)} ? '${i === 0 ? "rgba(255,255,255,.28)" : ELAN_ACCENT}' : 'rgba(255,255,255,.06)'} !important; }`).join("") +
      " .bubble-icon { color: ${(hass.states['" + id + "'] || {}).state === 'on' ? '" + ELAN_ACCENT + "' : '#e9eef7'} !important; }",
    ...action({ action: "toggle" }),
  };
  ELAN_FAN_CARDS.add(card);
  return card;
}
function elanCards(cards) {
  return (cards || []).map((c) => {
    if (!c || typeof c !== "object") return c;
    let out = { ...c };
    if (out.type === "custom:mediocre-media-player-card") {
      out.use_art_colors = false; // ELAN palette, not album colours
      out.action = out.action || { tap_action: { action: "none" } }; // already in the room's pop-up: no grey media dialog
    }
    if (out.entity && domainOf(out.entity) === "fan" && ["custom:bubble-card", "tile"].includes(out.type)) return elanFanCard(out.entity, out.name);
    if (out.type === "thermostat" && out.entity) return elanThermostat(out.entity, out.name);
    if (out.type === "custom:bubble-card" && out.card_type === "climate" && out.entity && !/pool|spa/i.test(out.entity)) return elanThermostat(out.entity, out.name);
    if (out.type === "custom:bubble-card" && out.card_type === "button" && out.button_type === "slider")
      out.styles = ((out.styles || "") + ELAN_SLIDER_STYLE).trim();
    if (out.type === "custom:bubble-card" && out.card_type === "button") out.styles = ((out.styles || "") + ELAN_PHONE_NAME_STYLE).trim();
    if (Array.isArray(out.cards)) out.cards = elanCards(out.cards);
    if (out.card && typeof out.card === "object") out.card = elanCards([out.card])[0];
    return out;
  });
}
function elanPopup(pp) {
  // Title-bar lock icons (room pop-ups): the same gold padlocks as the ELAN lock buttons, instead of green / red.
  const lockIcons = (pp.sub_button || [])
    .map((sb, i) => (/^mdi:lock(-open-variant)?$/.test(sb.icon || "") ? ` .bubble-sub-button-${i + 1} ha-icon, .bubble-sub-button-${i + 1} .bubble-sub-button-icon { color: #f2c12e !important; }` : ""))
    .join("");
  // Ceiling fans sit just below the thermostat.
  let cards = elanCards(pp.cards);
  const fans = cards.filter((c) => ELAN_FAN_CARDS.has(c));
  const lastThermo = cards.map((c) => ELAN_THERMO_CARDS.has(c)).lastIndexOf(true);
  if (fans.length && lastThermo >= 0) {
    const rest = cards.filter((c) => !ELAN_FAN_CARDS.has(c));
    const at = rest.map((c) => ELAN_THERMO_CARDS.has(c)).lastIndexOf(true) + 1;
    cards = [...rest.slice(0, at), ...fans, ...rest.slice(at)];
  }
  return { ...pp, cards, bg_color: "#161b36", bg_opacity: "94", styles: ((pp.styles || "") + " " + ELAN_POPUP_STYLE + lockIcons).trim() };
}

// ELAN climate row (as on the ELAN climate screen): name, big current temperature, a setpoint block — cool (navy) over
// heat (dark red) when the zone has two setpoints, or one tall box with the mode ("Heat 60°") — grey ▲ / ▼, and a ›.
// Tap the cool or heat box to choose which one the arrows change. Arrow taps are added up and sent as one
// climate.set_temperature about 0.8 s after the last tap; the box shows the new value straight away.
function elanClimateRow(id, name, hash) {
  const S = "hass.states['" + id + "']";
  const A = "(" + S + " || { attributes: {} }).attributes";
  const ST = "(" + S + " ? " + S + ".state : 'off')";
  const DUAL = "(" + A + ".target_temp_low != null && " + A + ".target_temp_high != null)";
  const fmt = (x) => "((v) => v == null || isNaN(v) ? '--' : Math.round(v) + '°')(" + x + ")"; // whole degrees
  const MODE = "(({ heat: 'Heat', cool: 'Cool', heat_cool: 'Auto', auto: 'Auto', dry: 'Dry', fan_only: 'Fan', off: 'Off' })[" + ST + "] || '')";
  const SINGLE_BG = "(" + ST + " === 'cool' ? '" + ELAN_COOL_BOX + "' : " + ST + " === 'heat' ? '" + ELAN_HEAT_BOX + "' : 'rgba(255,255,255,.12)')";
  const SEL = "(card.__pvSel || 'cool')";
  const nav = { action: "navigate", navigation_path: hash };
  const none = { action: "none" };
  // card is the row's ha-card; its sub-buttons live in the Bubble Card shadow root around it.
  // Pending values stay on screen until the thermostat reports them (Daikin reports about once a minute) or 90 s pass.
  const hook =
    "${(card.__pvH = hass, card.__pvSync && card.__pvSync(), card.__pvC || (card.__pvC = 1," +
    " card.__pvQ = function (n) { var r = card.querySelector('.bubble-sub-button-' + n) ? card : card.getRootNode(); return r.querySelector('.bubble-sub-button-' + n); }," +
    " card.__pvSync = function () { var P = card.__pvP; if (!P) return; var s = card.__pvH.states[" + JSON.stringify(id) + "]; var a = s ? s.attributes : {};" +
    "   var near = function (x, y) { return x != null && y != null && Math.abs(x - y) < 0.95; };" +
    "   var done = Date.now() - P.t > 90000 || (P.v != null ? near(a.temperature, P.v) : near(a.target_temp_low, P.lo) && near(a.target_temp_high, P.hi));" +
    "   if (done) { card.__pvP = null; [2, 3].forEach(function (n) { var el = card.__pvQ(n); if (el) el.style.removeProperty('--pv-v'); }); } }," +
    " card.addEventListener('click', function (ev) {" +
    " var path = ev.composedPath(); var hit = function (n) { return path.some(function (e) { return e.classList && e.classList.contains('bubble-sub-button-' + n); }); };" +
    " var h = card.__pvH, s = h.states[" + JSON.stringify(id) + "]; if (!s) return; var a = s.attributes;" +
    " var dual = a.target_temp_low != null && a.target_temp_high != null; var q = card.__pvQ;" +
    " var mark = function () { [2, 3].forEach(function (n) { var el = q(n); if (el) el.classList.toggle('pv-sel', dual && ((card.__pvSel || 'cool') === (n === 2 ? 'cool' : 'heat'))); }); };" +
    " if (hit(2)) { card.__pvSel = 'cool'; mark(); return; } if (hit(3)) { card.__pvSel = 'heat'; mark(); return; }" +
    " var dir = hit(4) ? 1 : hit(5) ? -1 : 0; if (!dir) return;" +
    " var step = a.target_temp_step || ((h.config.unit_system || {}).temperature === '°C' ? 0.5 : 1);" +
    " var lo = a.min_temp != null ? a.min_temp : -100, hiLim = a.max_temp != null ? a.max_temp : 200;" +
    " var clamp = function (v) { return Math.min(hiLim, Math.max(lo, Math.round(v / step) * step)); };" +
    " var now = Date.now(); var p = card.__pvP; var data, shown;" +
    " if (dual) { var L = p && p.lo != null ? p.lo : clamp(a.target_temp_low), H = p && p.hi != null ? p.hi : clamp(a.target_temp_high);" +
    "   if ((card.__pvSel || 'cool') === 'cool') H = clamp(H + dir * step); else L = clamp(L + dir * step);" +
    "   card.__pvP = { t: now, lo: L, hi: H }; data = { target_temp_low: L, target_temp_high: H }; shown = { 2: H, 3: L };" +
    " } else { if (a.temperature == null) return; var T = clamp((p && p.v != null ? p.v : a.temperature) + dir * step);" +
    "   card.__pvP = { t: now, v: T }; data = { temperature: T }; shown = { 3: T }; }" +
    " Object.keys(shown).forEach(function (n) { var el = q(n); if (el) el.style.setProperty('--pv-v', '\"' + Math.round(shown[n]) + '°\"'); });" +
    " clearTimeout(card.__pvT); card.__pvT = setTimeout(function () {" +
    "   card.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { action: 'tap', config: { tap_action:" +
    "   { action: 'perform-action', perform_action: 'climate.set_temperature', target: { entity_id: " + JSON.stringify(id) + " }, data: data } } } }));" +
    " }, 800);" +
    " })), '')}";
  const box = (n) =>
    ` .bubble-sub-button-${n} { display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; line-height: 1.1;` +
    ` align-self: stretch !important; justify-self: stretch !important; height: 100% !important; box-sizing: border-box; }` +
    ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon, .bubble-sub-button-${n} .bubble-sub-button-name-container { display: none !important; }`;
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity: id,
    name,
    show_icon: false,
    show_state: false,
    grid_options: { columns: "full" },
    sub_button: [
      { icon: "mdi:circle-small", show_icon: false, show_background: false, tap_action: nav },
      { icon: "mdi:circle-small", show_icon: false, show_background: true, tap_action: none },
      { icon: "mdi:circle-small", show_icon: false, show_background: true, tap_action: none },
      { icon: "mdi:menu-up", show_icon: true, show_background: true, tap_action: none },
      { icon: "mdi:menu-down", show_icon: true, show_background: true, tap_action: none },
      { icon: "mdi:chevron-right", show_background: false, tap_action: nav },
    ],
    styles:
      ELAN_ROW_STYLE +
      " .bubble-button-card-container { height: 110px !important; } .bubble-main-icon-container { display: none !important; }" +
      // Long names wrap onto two lines (and shrink a little) instead of scrolling under the temperature.
      " .bubble-name-container { margin-left: 16px !important; min-width: 0 !important; flex: 1 1 auto !important; overflow: hidden; }" +
      " .bubble-name { font-size: 22px !important; white-space: normal !important; overflow: visible !important; line-height: 1.2 !important; word-break: normal; }" +
      " .bubble-name .scrolling-container, .bubble-name .bubble-scroll-separator { animation: none !important; transform: none !important; }" +
      " @media (max-width: 1400px) { .bubble-name { font-size: 19px !important; } }" +
      elanSubtitle({ expr: titleCase(A + ".hvac_action || " + ST) }) +
      " .bubble-sub-button-container { display: grid !important; grid-template-columns: auto 104px 58px 34px; grid-template-rows: 1fr 1fr; gap: 2px 0;" +
      " height: 98px !important; align-self: center; margin-right: 4px; }" +
      " .bubble-sub-button { height: auto !important; min-height: 0 !important; width: auto !important; min-width: 0 !important; margin: 0 !important; border-radius: 0 !important; padding: 0 !important; }" +
      " .bubble-sub-button-1 { grid-column: 1; grid-row: 1 / span 2; background: none !important; padding: 0 22px !important; pointer-events: none !important; display: flex !important; align-items: center !important; }" +
      " .bubble-sub-button-1 ha-icon, .bubble-sub-button-1 .bubble-sub-button-icon { display: none !important; }" +
      " .bubble-sub-button-1::before { content: \"${" + fmt(A + ".current_temperature") + "}\"; font-size: 52px; font-weight: 300; }" +
      box(2) + box(3) +
      ` .bubble-sub-button-2 { grid-column: 2; grid-row: 1; background: ${ELAN_COOL_BOX} !important; }` +
      ` .bubble-sub-button-3 { grid-column: 2; grid-row: 2; background: ${ELAN_HEAT_BOX} !important; }` +
      // Setpoint text always white (pop-ups otherwise inherit a dark text colour).
      " .bubble-sub-button-2, .bubble-sub-button-3, .bubble-sub-button-2::after, .bubble-sub-button-3::after, .bubble-sub-button-3::before { color: #fff !important; }" +
      " @media (max-width: 1400px) { .bubble-sub-button-1 { padding: 0 12px !important; } .bubble-sub-button-1::before { font-size: 46px !important; } }" +
      " .bubble-sub-button-2::after { content: var(--pv-v, \"${" + fmt(A + ".target_temp_high") + "}\"); font-size: 25px; font-weight: 300; }" +
      " .bubble-sub-button-3::after { content: var(--pv-v, \"${" + DUAL + " ? " + fmt(A + ".target_temp_low") + " : (" + ST + " === 'off' ? '' : " + fmt(A + ".temperature") + ")}\"); font-size: 25px; font-weight: 300; }" +
      " .bubble-sub-button-3::before { content: \"${" + DUAL + " ? '' : " + MODE + "}\"; font-size: 19px; font-weight: 300; }" +
      " ${" + DUAL + " ? '' : '.bubble-sub-button-2 { display: none !important; } .bubble-sub-button-3 { grid-row: 1 / span 2 !important; background: ' + " + SINGLE_BG + " + ' !important; }'}" +
      " ${" + DUAL + " ? '.bubble-sub-button-' + (" + SEL + " === 'heat' ? 3 : 2) + ' { box-shadow: inset 0 0 0 2px rgba(255,255,255,.7); }' : ''}" +
      " .pv-sel { box-shadow: inset 0 0 0 2px rgba(255,255,255,.7) !important; }" +
      " .bubble-sub-button-4, .bubble-sub-button-5 { background: rgba(255,255,255,.24) !important; display: flex !important; align-items: center !important; justify-content: center !important; }" +
      " .bubble-sub-button-4 ha-icon, .bubble-sub-button-5 ha-icon { --mdc-icon-size: 34px; color: #f2f5fa !important; }" +
      " .bubble-sub-button-6 { grid-column: 4; grid-row: 1 / span 2; background: none !important; display: flex !important; align-items: center !important; justify-content: center !important; }" +
      " .bubble-sub-button-4 { grid-column: 3; grid-row: 1; } .bubble-sub-button-5 { grid-column: 3; grid-row: 2; }" +
      " ${" + ST + " === 'off' ? '.bubble-sub-button-4, .bubble-sub-button-5 { opacity: .35; pointer-events: none !important; }' : ''}" +
      " @media (max-width: 520px) { .bubble-button-card-container { height: 80px !important; } .bubble-name { font-size: 16px !important; }" +
      " .bubble-sub-button-container { grid-template-columns: auto 62px 40px 0; height: 68px !important; } .bubble-sub-button-6 { display: none !important; }" +
      " .bubble-sub-button-1 { padding: 0 10px !important; } .bubble-sub-button-1::before { font-size: 28px !important; }" +
      " .bubble-sub-button-2::after, .bubble-sub-button-3::after { font-size: 16px; } .bubble-sub-button-3::before { font-size: 14px; }" +
      " .bubble-sub-button-4 ha-icon, .bubble-sub-button-5 ha-icon { --mdc-icon-size: 26px; } }" +
      " " + hook,
    ...action(nav),
  };
}

// ELAN alarm controls for the Home Security pop-up: ARM HOME / ARM AWAY / DISARM as ELAN segmented buttons with gold
// icons (current mode filled blue, like LOCK / UNLOCK), and — when the alarm needs a code — an ELAN keypad. The code
// typed on the keypad is held in the browser only until a button is tapped, then sent with that command and cleared.
function elanAlarmCards(hass, id) {
  const st = hass.states[id];
  const feat = (st && st.attributes.supported_features) || 0;
  const needsCode = !!(st && st.attributes.code_format);
  const S = "(hass.states['" + id + "'] ? hass.states['" + id + "'].state : '')";
  const modes = [
    [1, "Arm Home", "mdi:shield-home-outline", "alarm_arm_home", "armed_home"],
    [2, "Arm Away", "mdi:shield-lock-outline", "alarm_arm_away", "armed_away"],
    [4, "Arm Night", "mdi:shield-moon-outline", "alarm_arm_night", "armed_night"],
  ].filter(([b]) => feat & b);
  const buttons = [...modes, [0, "Disarm", "mdi:shield-off-outline", "alarm_disarm", "disarmed"]];
  const store = "(window.__pvAlarm = window.__pvAlarm || {})";
  const none = { action: "none" };
  const segHook =
    "${(card.__pvH = hass, card.__pvC || (card.__pvC = 1, card.addEventListener('click', function (ev) {" +
    " var path = ev.composedPath(); var svc = " + JSON.stringify(buttons.map((b) => b[3])) + ";" +
    " var n = 0; for (var i = 1; i <= svc.length; i++) if (path.some(function (e) { return e.classList && e.classList.contains('bubble-sub-button-' + i); })) n = i;" +
    " if (!n) return; var A = " + store + "; var code = A[" + JSON.stringify(id) + "] || '';" +
    (needsCode
      ? " if (!code) { var kp = A[" + JSON.stringify(id + ":pad") + "]; if (kp) kp('Enter code first'); return; }"
      : "") +
    " var data = code ? { code: code } : {};" +
    " card.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { action: 'tap', config: { tap_action:" +
    " { action: 'perform-action', perform_action: 'alarm_control_panel.' + svc[n - 1], target: { entity_id: " + JSON.stringify(id) + " }, data: data } } } }));" +
    " A[" + JSON.stringify(id) + "] = ''; var pad = A[" + JSON.stringify(id + ":pad") + "]; if (pad) pad('');" +
    " })), '')}";
  const seg = (n, stateName) =>
    ` .bubble-sub-button-${n} { height: 46px !important; width: auto !important; border-radius: 3px !important; justify-content: center !important; gap: 8px !important; margin: 0 !important;` +
    ` background: \${${S} === '${stateName}' ? '${ELAN_ACCENT}' : 'rgba(255,255,255,.06)'} !important; border: 1px solid rgba(255,255,255,.18); }` +
    ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon { color: #f2c12e !important; --mdc-icon-size: 19px; display: inline-flex !important; }` +
    ` .bubble-sub-button-${n} .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .1em; text-transform: uppercase; color: #fff !important; opacity: 1 !important; overflow: visible !important; }`;
  const segCard = {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity: id,
    name: NAMES[id] || "Home Security",
    show_icon: false,
    show_state: false,
    grid_options: { columns: "full" },
    sub_button: buttons.map(([, label, icon]) => ({ name: label, icon, show_name: true, show_icon: true, show_background: true, tap_action: none })),
    styles:
      ELAN_ROW_STYLE +
      // Just the buttons: the pop-up header already names the alarm, and the lit button shows its mode.
      " .bubble-button-card-container { height: 72px !important; } .bubble-button-card { flex-direction: column !important; align-items: stretch !important; justify-content: center !important; padding: 12px !important; height: 100%; box-sizing: border-box; }" +
      " .bubble-main-icon-container, .bubble-name-container { display: none !important; }" +
      ` .bubble-sub-button-container { display: grid !important; grid-template-columns: repeat(${buttons.length}, 1fr); gap: 6px !important; width: 100% !important; position: static !important; margin: 0 !important; }` +
      buttons.map(([, , , , stateName], i) => seg(i + 1, stateName)).join("") +
      " @media (max-width: 520px) { .bubble-sub-button .bubble-sub-button-name-container { font-size: 10px !important; letter-spacing: .04em !important; } .bubble-sub-button { gap: 4px !important; } }" +
      " " + segHook,
    tap_action: none,
    button_action: { tap_action: none },
  };
  if (!needsCode) return [segCard];
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C"];
  const padHook =
    "${(card.__pvC || (card.__pvC = 1, (function () {" +
    " var A = " + store + "; var root = function () { return card.querySelector('.bubble-sub-button-container') ? card : card.getRootNode(); };" +
    " var show = function (msg) { var c = root().querySelector('.bubble-sub-button-container'); if (!c) return; var code = A[" + JSON.stringify(id) + "] || '';" +
    "   c.style.setProperty('--pv-code', '\"' + (msg || (code ? code.replace(/./g, '●  ').trim() : 'Enter code')) + '\"');" +
    "   if (msg) setTimeout(function () { show(''); }, 1800); };" +
    " A[" + JSON.stringify(id + ":pad") + "] = show;" +
    " card.addEventListener('click', function (ev) { var path = ev.composedPath(); var keys = " + JSON.stringify(keys) + "; var n = 0;" +
    "   for (var i = 1; i <= keys.length; i++) if (path.some(function (e) { return e.classList && e.classList.contains('bubble-sub-button-' + i); })) n = i;" +
    "   if (!n) return; var k = keys[n - 1]; var code = A[" + JSON.stringify(id) + "] || '';" +
    "   if (k === 'C') code = ''; else if (k === '⌫') code = code.slice(0, -1); else if (code.length < 12) code += k;" +
    "   A[" + JSON.stringify(id) + "] = code; show(''); });" +
    " })()), '')}";
  const padCard = {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name: " ",
    show_icon: false,
    grid_options: { columns: "full" },
    sub_button: keys.map((k) => ({ name: k, icon: "mdi:circle-small", show_name: true, show_icon: false, show_background: true, tap_action: none })),
    styles:
      ELAN_ROW_STYLE +
      " .bubble-button-card-container { height: 322px !important; } .bubble-button-card { flex-direction: column !important; align-items: stretch !important; padding: 12px !important; height: 100%; box-sizing: border-box; }" +
      " .bubble-main-icon-container, .bubble-name-container { display: none !important; }" +
      " .bubble-sub-button-container { display: grid !important; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 54px; gap: 6px !important; width: 100% !important; position: static !important; margin: 0 !important; }" +
      " .bubble-sub-button-container::before { content: var(--pv-code, \"Enter code\"); grid-column: 1 / -1; display: flex; align-items: center; justify-content: center;" +
      " font-size: 20px; letter-spacing: .12em; border-bottom: 1px solid rgba(255,255,255,.35); color: #f2f5fa; }" +
      " .bubble-sub-button { height: 54px !important; width: auto !important; margin: 0 !important; border-radius: 4px !important; justify-content: center !important;" +
      " background: rgba(255,255,255,.1) !important; border: 1px solid rgba(255,255,255,.12); }" +
      " .bubble-sub-button:active { background: " + ELAN_ACCENT + " !important; }" +
      " .bubble-sub-button .bubble-sub-button-name-container { font-size: 24px !important; font-weight: 300 !important; color: #fff !important; opacity: 1 !important; }" +
      " .bubble-sub-button-10 .bubble-sub-button-name-container, .bubble-sub-button-12 .bubble-sub-button-name-container { font-size: 18px !important; }" +
      " " + padHook,
    tap_action: none,
    button_action: { tap_action: none },
  };
  return [segCard, padCard];
}

// ELAN lock pop-up: big LOCK / UNLOCK buttons (gold padlocks, current state filled blue, unlock confirms) and the
// lock's recent activity — who locked or unlocked it and when — in place of Home Assistant's grey dialog.
// Door lock state for ELAN rows: "Locked" (white, closed padlock) / "Unlocked" (red, open padlock, red edge) /
// "Jammed" (amber) / "Locking…" / "Unlocking…". One outlined button offers the opposite action: LOCK when unlocked,
// UNLOCK (confirms) when locked.
const LOCK_COLORS = { unlocked: ELAN_HEAT, open: ELAN_HEAT, jammed: "#f0a020" };
function lockStateExpr(id) {
  return "((s) => ({ locked: 'Locked', unlocked: 'Unlocked', open: 'Open', jammed: 'Jammed', locking: 'Locking…', unlocking: 'Unlocking…', opening: 'Opening…' })[s] || (s || '').replace(/_/g, ' '))(hass.states['" + id + "'] && hass.states['" + id + "'].state)";
}
function lockColorExpr(id) {
  return "((s) => (" + JSON.stringify(LOCK_COLORS) + ")[s] || '#f2f5fa')(hass.states['" + id + "'] && hass.states['" + id + "'].state)";
}
function lockActionButtons(id, label) {
  const isUnlocked = { condition: "state", entity: id, state: ["unlocked", "open", "jammed"] };
  const isLocked = { condition: "state", entity: id, state_not: ["unlocked", "open", "jammed"] };
  return [
    { name: "Lock", icon: "mdi:lock", show_name: true, show_icon: true, show_background: true, visibility: [isUnlocked],
      tap_action: { action: "perform-action", perform_action: "lock.lock", target: { entity_id: id } } },
    { name: "Unlock", icon: "mdi:lock-open-variant", show_name: true, show_icon: true, show_background: true, visibility: [isLocked],
      tap_action: { action: "perform-action", perform_action: "lock.unlock", target: { entity_id: id }, confirmation: { text: `Unlock ${label}?` } } },
  ];
}
function lockButtonStyles(h, w, wPhone) {
  const base = (n) =>
    ` .bubble-sub-button-${n} { width: ${w}px !important; height: ${h}px !important; border-radius: 3px !important; justify-content: center !important; gap: 8px !important; }` +
    ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon { --mdc-icon-size: 17px; display: inline-flex !important; }` +
    ` .bubble-sub-button-${n} .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .1em; text-transform: uppercase; color: #fff !important; opacity: 1 !important; overflow: visible !important; }` +
    ` @media (max-width: 520px) { .bubble-sub-button-${n} { width: ${wPhone}px !important; gap: 4px !important; } .bubble-sub-button-${n} .bubble-sub-button-name-container { font-size: 10px !important; letter-spacing: .04em !important; } }`;
  return (
    base(1) + base(2) +
    // LOCK and UNLOCK look the same: outlined, gold padlock.
    " .bubble-sub-button-1, .bubble-sub-button-2 { background: rgba(255,255,255,.04) !important; border: 1px solid rgba(255,255,255,.35); }" +
    " .bubble-sub-button-1 ha-icon, .bubble-sub-button-2 ha-icon { color: #f2c12e !important; }"
  );
}
function elanLockRow(hass, id, label, tap) {
  const col = lockColorExpr(id);
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity: id,
    name: label,
    grid_options: { columns: "full" },
    sub_button: lockActionButtons(id, label),
    styles:
      ELAN_ROW_STYLE +
      // State on its own line under the name, in colour; unlocked rows get a red edge and tint.
      " .bubble-name-container::after { content: \"${" + lockStateExpr(id) + "}\"; display: block; font-size: 15px; font-weight: 500; letter-spacing: .04em; margin-top: 2px; color: ${" + col + "}; }" +
      " .bubble-icon { color: ${" + col + "} !important; }" +
      lockButtonStyles(38, 112, 82),
    ...action(tap),
  };
}
// Top of the lock list: "3 doors unlocked" (red) or "All doors locked", with Lock All when any are unlocked.
function elanLocksSummary(locks) {
  const openCount = "(" + JSON.stringify(locks) + ".filter((e) => hass.states[e] && ['unlocked', 'open'].includes(hass.states[e].state)).length)";
  const bulk = liveBulk(locks, ["unlocked", "open"], "lock.lock", { sub: 1, verb: "Lock", one: "door", many: "doors" });
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name: "Doors",
    icon: "mdi:door-closed-lock",
    grid_options: { columns: "full" },
    sub_button: [
      { name: "Lock All", icon: "mdi:lock", show_name: true, show_icon: true, show_background: true, tap_action: { action: "none" },
        visibility: [{ condition: "or", conditions: locks.map((e) => ({ condition: "state", entity: e, state: ["unlocked", "open"] })) }] },
    ],
    styles:
      ELAN_ROW_STYLE +
      " .bubble-name-container::after { content: \"${((n) => n ? n + (n === 1 ? ' door unlocked' : ' doors unlocked') : 'All doors locked')(" + openCount + ")}\"; display: block; font-size: 15px; font-weight: 500; margin-top: 2px;" +
      " color: ${" + openCount + " ? '" + ELAN_HEAT + "' : '#f2f5fa'}; }" +
      " .bubble-sub-button-1 { width: 124px !important; height: 38px !important; border-radius: 3px !important; justify-content: center !important; gap: 8px !important; background: rgba(255,255,255,.04) !important; border: 1px solid rgba(255,255,255,.35); }" +
      " .bubble-sub-button-1 ha-icon { color: #f2c12e !important; --mdc-icon-size: 17px; } .bubble-sub-button-1 .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .1em; text-transform: uppercase; color: #fff !important; opacity: 1 !important; }" +
      " " + bulk.hook,
    ...bulk.actions,
  };
}

function elanLockPopup(hass, id, label) {
  const col = lockColorExpr(id);
  const buttons = {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity: id,
    name: label,
    grid_options: { columns: "full" },
    sub_button: lockActionButtons(id, label),
    styles:
      ELAN_ROW_STYLE +
      " .bubble-button-card-container { height: 84px !important; } .bubble-name { display: none !important; } .bubble-icon { color: ${" + col + "} !important; --mdc-icon-size: 34px; }" +
      " .bubble-name-container::after { content: \"${" + lockStateExpr(id) + "}\"; display: block; font-size: 30px; font-weight: 300; color: ${" + col + "}; }" +
      lockButtonStyles(46, 140, 110),
    tap_action: { action: "none" },
    button_action: { tap_action: { action: "none" } },
  };
  return popupShell(`#lock-${slug(id.split(".")[1])}`, label, "mdi:door-closed-lock", [
    buttons,
    { type: "heading", heading: "Recent activity", heading_style: "subtitle", grid_options: { columns: "full" } },
    { type: "logbook", target: { entity_id: [id] }, hours_to_show: 24, grid_options: { columns: "full" } },
  ]);
}

// ELAN shade row and pop-up. Row: name, position under it, ▲ ■ ▼ buttons; tapping the row opens the pop-up.
// Pop-up: OPEN / STOP / CLOSE buttons (gold icons, fully open or closed fills blue), a position slider when the shade
// supports it, and the shade's recent activity.
const shadeHash = (id) => `#shade-${slug(id.split(".")[1])}`;
function shadeStateExpr(id) {
  const S = "hass.states['" + id + "']";
  return "((s) => !s ? '' : s.attributes.current_position != null && s.state !== 'opening' && s.state !== 'closing' ? (s.attributes.current_position >= 100 ? 'Open' : s.attributes.current_position <= 0 ? 'Closed' : s.attributes.current_position + '% open') : s.state.replace(/^./, (c) => c.toUpperCase()))(" + S + ")";
}
function elanShadeRow(hass, id, label) {
  const svc = (s) => ({ action: "perform-action", perform_action: "cover." + s, target: { entity_id: id } });
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity: id,
    name: label,
    icon: "mdi:roller-shade",
    show_state: false,
    grid_options: { columns: "full" },
    sub_button: [
      { icon: "mdi:arrow-up", show_background: true, tap_action: svc("open_cover") },
      { icon: "mdi:stop", show_background: true, tap_action: svc("stop_cover") },
      { icon: "mdi:arrow-down", show_background: true, tap_action: svc("close_cover") },
    ],
    styles:
      ELAN_ROW_STYLE +
      elanSubtitle({ expr: shadeStateExpr(id) }) +
      " .bubble-sub-button { width: 46px !important; height: 38px !important; border-radius: 3px !important; background: rgba(255,255,255,.08) !important; border: 1px solid rgba(255,255,255,.16); }" +
      " .bubble-sub-button ha-icon { color: #f2f5fa !important; }",
    ...action({ action: "navigate", navigation_path: shadeHash(id) }),
  };
}
function elanShadePopup(hass, id, label) {
  const st = hass.states[id];
  const feat = (st && st.attributes.supported_features) || 0;
  const P = "((hass.states['" + id + "'] || { attributes: {} }).attributes)";
  const S = "(hass.states['" + id + "'] ? hass.states['" + id + "'].state : '')";
  const isOpen = "(" + P + ".current_position != null ? " + P + ".current_position >= 100 : " + S + " === 'open')";
  const isClosed = "(" + P + ".current_position != null ? " + P + ".current_position <= 0 : " + S + " === 'closed')";
  const svc = (s) => ({ action: "perform-action", perform_action: "cover." + s, target: { entity_id: id } });
  const btns = [
    [1, "Open", "mdi:arrow-up-bold-box-outline", "open_cover", isOpen],
    [8, "Stop", "mdi:stop-circle-outline", "stop_cover", "false"],
    [2, "Close", "mdi:arrow-down-bold-box-outline", "close_cover", isClosed],
  ].filter(([b]) => feat & b);
  const seg = (n, on) =>
    ` .bubble-sub-button-${n} { height: 50px !important; width: auto !important; border-radius: 3px !important; justify-content: center !important; gap: 10px !important; margin: 0 !important;` +
    ` background: \${${on} ? '${ELAN_ACCENT}' : 'rgba(255,255,255,.06)'} !important; border: 1px solid rgba(255,255,255,.18); }` +
    ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon { color: #f2c12e !important; --mdc-icon-size: 20px; display: inline-flex !important; }` +
    ` .bubble-sub-button-${n} .bubble-sub-button-name-container { font-size: 13px !important; letter-spacing: .12em; text-transform: uppercase; color: #fff !important; opacity: 1 !important; overflow: visible !important; }`;
  const cards = [
    {
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      entity: id,
      name: label,
      show_icon: false,
      show_state: false,
      grid_options: { columns: "full" },
      sub_button: btns.map(([, name, icon, s]) => ({ name, icon, show_name: true, show_icon: true, show_background: true, tap_action: svc(s) })),
      styles:
        ELAN_ROW_STYLE +
        " .bubble-button-card-container { height: 76px !important; } .bubble-button-card { flex-direction: column !important; align-items: stretch !important; justify-content: center !important; padding: 12px !important; height: 100%; box-sizing: border-box; }" +
        " .bubble-main-icon-container, .bubble-name-container { display: none !important; }" +
        ` .bubble-sub-button-container { display: grid !important; grid-template-columns: repeat(${btns.length}, 1fr); gap: 6px !important; width: 100% !important; position: static !important; margin: 0 !important; }` +
        btns.map(([, , , , on], i) => seg(i + 1, on)).join(""),
      tap_action: { action: "none" },
      button_action: { tap_action: { action: "none" } },
    },
  ];
  if (feat & 4)
    cards.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "slider",
      entity: id,
      name: "Position",
      icon: "mdi:roller-shade",
      show_state: true,
      show_attribute: true,
      attribute: "current_position",
      grid_options: { columns: "full" },
      styles: ELAN_ROW_STYLE + ELAN_SLIDER_STYLE + " .bubble-button-card-container { height: 64px !important; } .bubble-state { font-size: 13px !important; opacity: .75; }",
    });
  cards.push(
    { type: "heading", heading: "Recent activity", heading_style: "subtitle", grid_options: { columns: "full" } },
    { type: "logbook", target: { entity_id: [id] }, hours_to_show: 24, grid_options: { columns: "full" } }
  );
  return popupShell(shadeHash(id), label, "mdi:roller-shade", cards);
}

// Home Assistant's own more-info dialog (opened by light, fan and pool/spa heat rows) in ELAN colours instead of grey,
// only while an ELAN dashboard is open: a style in <home-assistant>'s shadow root that is switched on and off as the
// path changes. The dialog's panel colour comes from --ha-dialog-surface-background (dialog and phone bottom sheet).
function elanDialogTheme(base) {
  try {
    const ha = document.querySelector("home-assistant");
    if (!ha || !ha.shadowRoot) return;
    let st = ha.shadowRoot.getElementById("pv-elan-dialog");
    if (!st) {
      st = document.createElement("style");
      st.id = "pv-elan-dialog";
      const vars = ELAN_POPUP_STYLE.slice(ELAN_POPUP_STYLE.indexOf("{") + 1, ELAN_POPUP_STYLE.indexOf("}"));
      st.textContent =
        "ha-more-info-dialog, ha-dialog, ha-adaptive-dialog {" + vars +
        "; --ha-dialog-surface-background: #1d2244; --mdc-theme-surface: #1d2244; --ha-color-surface-default: #1d2244; --card-background-color: #1d2244;" +
        " --ha-card-background: rgba(255,255,255,.06); --primary-text-color: #f2f5fa; --secondary-text-color: rgba(242,245,250,.65);" +
        " --ha-more-info-control-background: rgba(255,255,255,.08); --control-select-background: rgba(255,255,255,.08); --control-button-background-color: rgba(255,255,255,.08);" +
        " --ha-color-fill-neutral-quiet-resting: rgba(255,255,255,.08); --input-fill-color: rgba(255,255,255,.06); }";
      ha.shadowRoot.appendChild(st);
    }
    window.__pvElanBases = Array.from(new Set([...(window.__pvElanBases || []), base]));
    const sync = () => { st.disabled = !window.__pvElanBases.some((b) => location.pathname === b || location.pathname.startsWith(b + "/")); };
    sync();
    if (!window.__pvElanDlgWatch) { window.__pvElanDlgWatch = 1; window.addEventListener("location-changed", () => setTimeout(sync, 0)); window.addEventListener("popstate", sync); }
  } catch (e) { /* not in a browser (e.g. config check) */ }
}

class PivitElanStrategy extends HTMLElement {
  static async generate(userConfig, hass) {
    const cfg = { ...DEFAULTS, ...(userConfig || {}) };
    cfg.intercoms = enrichIntercoms(cfg.intercoms, hass);
    NAMES = cfg.entity_names || {};
    AUDIO_CARD = cfg.audio_card || "default";
    const ctx = buildContext(cfg, hass);
    SPEAKERS = ctx.rooms.flatMap((r) => roomMediaSplit(r, hass).audio);
    const base = ctx.basePath;
    const bg = cfg.elan_background || ELAN_BACKGROUND;
    elanDialogTheme(base);
    ELAN_HASS = hass;
    const label = (id) => NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id;
    const go = (h) => ({ action: "navigate", navigation_path: h });

    // Reuse the PivIT Home Rooms view for every pop-up (lights, audio, TV, thermostats, locks, sprinkler timers…).
    const savant = roomsView(cfg, ctx, { type: "markdown", content: " " });
    const popups = savant.sections.flatMap((sec) => sec.cards).filter((c) => c.card_type === "pop-up");
    const popupsWhere = (test) => popups.filter((pp) => test(pp.hash || ""));
    // Rooms without a thermostat of their own get the one that covers them in their pop-up: room_thermostats (e.g.
    // Kitchen → Living Room's), else floor_thermostats (e.g. upstairs bedrooms).
    for (const r of ctx.rooms) {
      const ft = (cfg.room_thermostats || {})[r.id] ?? (cfg.floor_thermostats || {})[r.floor];
      const pp = popups.find((x) => x.hash === "#" + slug(r.name));
      if (!pp || !ft || ft === "none" || !hass.states[ft] || roomClimates(r, hass).length || JSON.stringify(pp.cards || []).includes('"' + ft + '"')) continue;
      pp.cards = [{ type: "thermostat", entity: ft, grid_options: { columns: "full" } }, ...(pp.cards || [])];
    }

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
    const roomTiles = (savant.sections.find((sec) => (sec.cards || []).some((c) => c.type === "heading" && c.heading === "Rooms")) || { cards: [] }).cards.filter((c) => c.type !== "heading");
    if (roomTiles.length && cfg.elan_rooms !== false) items.push({ name: "Rooms", icon: "mdi:floor-plan", path: "rooms" });
    // Scenes: one-tap house scripts (elan_scenes: [{ entity: script.x, name, icon, description }]).
    const scenes = (cfg.elan_scenes || []).map((x) => (typeof x === "string" ? { entity: x } : x)).filter((x) => x.entity && hass.states[x.entity]);
    if (scenes.length) items.push({ name: "Scenes", icon: "mdi:palette-swatch-outline", path: "scenes" });
    if (lightRooms.length || shadeRooms.length) items.push({ name: "Lighting", icon: "mdi:lightbulb-outline", path: "lighting" });
    if (mediaRooms.length) items.push({ name: "Media", icon: "mdi:play-circle-outline", path: "media" });
    for (const sm of summaries) items.push({ name: /sprinkl/i.test(sm.name) ? "Irrigation" : sm.name, icon: /sprinkl/i.test(sm.name) ? "mdi:water-outline" : sm.icon || "mdi:dots-grid", path: slug(sm.name) });
    if (ctx.cameras.length) items.push({ name: "Cameras", icon: "mdi:cctv", path: "video" });
    for (const v of extra) items.push({ name: v.title, icon: v.icon || "mdi:view-dashboard", path: v.path });
    if ((cfg.elan_order || []).length) {
      // Pages missing from elan_order go last, except Rooms, which follows Climate unless placed explicitly.
      const rank = (pth) => { const i = cfg.elan_order.indexOf(pth); if (i < 0 && pth === "rooms" && cfg.elan_order.includes("climate")) return cfg.elan_order.indexOf("climate") + 0.5;
        if (i < 0 && pth === "scenes") return cfg.elan_order.includes("rooms") ? cfg.elan_order.indexOf("rooms") + 0.5 : cfg.elan_order.includes("climate") ? cfg.elan_order.indexOf("climate") + 0.6 : 999;
        return i < 0 ? 999 : i; };
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
        " @media (max-width: 430px) { .horizontal-buttons-stack-container { gap: 0 !important; padding: 0 !important; width: 100% !important; min-width: 0 !important; justify-content: space-evenly !important; } .bubble-button { width: 36px !important; min-width: 36px !important; height: 36px !important; } .bubble-icon { --mdc-icon-size: 20px; } }",
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
            // content may be { wide, narrow } when a page lays out differently on phones (e.g. Video's camera grid).
            { type: "vertical-stack", cards: content.wide || content, grid_options: { columns: 18, rows: "auto" }, visibility: [{ condition: "screen", media_query: ELAN_WIDE }] },
            { type: "vertical-stack", cards: content.narrow || content, grid_options: { columns: "full", rows: "auto" }, visibility: [{ condition: "screen", media_query: ELAN_NARROW }] },
            ...viewPopups.map(elanPopup),
            ...intercoms.map(intercomPopup).map(elanPopup),
            phoneNav,
          ],
        },
      ],
    });
    const views = [];

    // HOME alerts under the date: chips that appear only while something needs attention — alarm state (always),
    // doors/windows open, doors unlocked, gate held open / open, sprinklers running, pool/spa heaters on.
    // Each chip opens the page or pop-up that deals with it.
    const homeAlerts = () => {
      const chips = [];
      const st = (id) => "(hass.states['" + id + "'] ? hass.states['" + id + "'].state : '')";
      const anyOn = (ids, states = ["on"]) => ({ condition: "or", conditions: ids.map((e) => ({ condition: "state", entity: e, state: states })) });
      const firstName = (ids, states) =>
        "((l) => l.length ? l[0][1] : '')(" + JSON.stringify(ids.map((e) => [e, label(e)])) + ".filter((x) => " + JSON.stringify(states) + ".includes(" + "(hass.states[x[0]] || {}).state)))";
      const count = (ids, states) => "(" + JSON.stringify(ids) + ".filter((e) => hass.states[e] && " + JSON.stringify(states) + ".includes(hass.states[e].state)).length)";
      const toPage = (path) => go(`${base}/${path}`);
      const chip = (icon, text, colour, tap, visibility, showExpr) => chips.push({ icon, text, colour, tap, visibility, showExpr });
      // Alarm: first, on its own centred line just below the date (a zero-height line break follows it).
      for (const id of ctx.alarms)
        chip(
          "mdi:shield-lock-outline",
          "((s) => s.startsWith('armed_') ? 'Armed ' + s.slice(6).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : s === 'triggered' ? 'ALARM' : s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '')(" + st(id) + ")",
          "(" + st(id) + ".startsWith('armed') || " + st(id) + " === 'triggered' ? '" + ELAN_HEAT + "' : '#f2f5fa')",
          // Opens the arm / disarm pop-up right on the Home screen.
          go(`#security-${slug(id.split(".")[1])}`),
          null
        );
      if (ctx.alarms.length) chips.push({ icon: "mdi:circle-small", text: "''", colour: "'transparent'", tap: { action: "none" }, visibility: null, lineBreak: true });
      // Doors / windows open (gate sensors have their own chip).
      const gateSensors = intercoms.map((ic) => ic.status_sensor).filter(Boolean);
      const contacts = Object.keys(hass.states).filter((e) => {
        if (domainOf(e) !== "binary_sensor" || gateSensors.includes(e)) return false;
        const reg = hass.entities && hass.entities[e];
        if (reg && (reg.hidden || reg.entity_category)) return false;
        return ["door", "window", "opening", "garage_door"].includes(hass.states[e].attributes.device_class || "");
      });
      if (contacts.length)
        chip(
          "mdi:door-open",
          "((n) => n === 1 ? " + firstName(contacts, ["on"]) + " + ' open' : n + ' doors/windows open')(" + count(contacts, ["on"]) + ")",
          "'#f0a020'",
          toPage("security"),
          [anyOn(contacts)]
        );
      // Doors unlocked.
      if (locks.length)
        chip(
          "mdi:lock-open-variant",
          "((n) => n === 1 ? " + firstName(locks, ["unlocked", "open"]) + " + ' unlocked' : n + ' doors unlocked')(" + count(locks, ["unlocked", "open"]) + ")",
          "'" + ELAN_HEAT + "'",
          toPage("security"),
          [anyOn(locks, ["unlocked", "open"])]
        );
      // Gate held open (with time left) / open.
      for (const ic of intercoms) {
        const status = ic.lock_rule_sensor || ic.lock_rule;
        const held = [ic.hold_option || "keep_unlock", "custom"];
        if (status)
          chip("mdi:gate-open", "'" + (ic.name || "Gate") + " held open' + ((r) => r ? ' · ' + r : '')(" + holdRemainingExpr(ic) + ")", "'#f0a020'", go(intercomHash(ic)),
            [{ condition: "state", entity: status, state: held }]);
        if (ic.status_sensor)
          chip("mdi:gate-open", "'" + (ic.name || "Gate") + " open'", "'#f0a020'", go(intercomHash(ic)),
            [{ condition: "state", entity: ic.status_sensor, state: "on" }, ...(status ? [{ condition: "state", entity: status, state_not: held }] : [])]);
      }
      // Sprinklers (and any other summary group) running.
      for (const sm of summaries) {
        const ids = (sm.entities || []).filter((e) => hass.states[e]);
        if (!ids.length) continue;
        chip(
          /sprinkl/i.test(sm.name) ? "mdi:sprinkler-variant" : sm.icon || "mdi:information-outline",
          "((n) => '" + sm.name + " running · ' + (n === 1 ? " + firstName(ids, ["on"]) + " : n + ' zones'))(" + count(ids, ["on"]) + ")",
          "'" + ELAN_ACCENT + "'",
          toPage(slug(sm.name)),
          [anyOn(ids)]
        );
      }
      // Pool / spa heaters on (switches named "… heater" on the extra pages, e.g. Pool).
      for (const v of extra) {
        const heaters = (v.sections || []).flatMap((x) => x.cards || []).map((c) => c.entity).filter((e) => e && /heater/i.test(e) && hass.states[e]);
        for (const e of heaters)
          chip("mdi:fire", "'" + label(e).replace(/'/g, "") + " on'", "'" + ELAN_HEAT + "'", toPage(v.path), [{ condition: "state", entity: e, state: "on" }]);
      }
      // Recent camera detections (person / vehicle / animal / package in the last 5 minutes): the latest one and its
      // camera ("Person at Front Door", "+2" when there are more); tap for the Cameras page. Shown by a JS check (time-based).
      {
        const KINDS = { person_detected: "Person", vehicle_detected: "Vehicle", animal_detected: "Animal", package_detected: "Package" };
        const dets = [];
        for (const cam of ctx.cameras) {
          const dev = hass.entities && hass.entities[cam] && hass.entities[cam].device_id;
          if (!dev) continue;
          for (const e of Object.values(hass.entities))
            if (e.device_id === dev && e.entity_id.startsWith("binary_sensor.") && !e.hidden && hass.states[e.entity_id]) {
              const k = Object.keys(KINDS).find((x) => e.entity_id.endsWith("_" + x));
              if (k) dets.push([e.entity_id, KINDS[k], label(cam).replace(/'/g, "")]);
            }
        }
        if (dets.length) {
          const recent =
            "(" + JSON.stringify(dets) + ".map((d) => [d, hass.states[d[0]]]).filter((x) => x[1] && (x[1].state === 'on' || Date.now() - new Date(x[1].last_changed).getTime() < 300000))" +
            ".sort((a, b) => new Date(b[1].last_changed) - new Date(a[1].last_changed)))";
          chip(
            "mdi:cctv",
            "((r) => r.length ? r[0][0][1] + ' at ' + r[0][0][2] + (r.length > 1 ? ' +' + (r.length - 1) : '') : '')(" + recent + ")",
            "((r) => r.length && r[0][1].state === 'on' ? '#f5c518' : '#f2f5fa')(" + recent + ")",
            go(`${base}/video#camera-events`),
            null,
            "(" + recent + ".length > 0)"
          );
        }
      }
      if (!chips.length) return [];
      return [
        {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          name: " ",
          show_icon: false,
          grid_options: { columns: "full" },
          sub_button: chips.map((c) => ({ icon: c.icon, show_icon: true, show_name: false, show_background: true, tap_action: c.tap, ...(c.visibility ? { visibility: c.visibility } : {}) })),
          styles:
            ".bubble-button-card-container { background: none !important; height: auto !important; min-height: 48px; } .bubble-button-background, .bubble-main-icon-container, .bubble-name-container { display: none !important; }" +
            " @media (max-width: 999px) { .bubble-button-card-container { margin-bottom: 90px; } }" +
            " .bubble-button-card { justify-content: center !important; height: auto !important; padding: 0 !important; }" +
            " .bubble-sub-button-container { position: static !important; display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 8px !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box; padding: 0 8px !important; margin: 0 !important; overflow: visible !important; }" +
            " .bubble-button-card-container, .bubble-button-card, ha-card { overflow: visible !important; }" +
            " .bubble-sub-button { width: auto !important; max-width: 100% !important; box-sizing: border-box; height: auto !important; min-height: 38px !important; padding: 0 14px 0 10px !important; gap: 8px !important; border-radius: 4px !important; flex-direction: row !important; align-items: center !important;" +
            ` background: ${ELAN_ROW_BG} !important; border: 1px solid rgba(255,255,255,.14); }` +
            chips
              .map(
                (c, i) =>
                  ` .bubble-sub-button-${i + 1} ha-icon { color: \${${c.colour}} !important; --mdc-icon-size: 18px; order: 0; flex-shrink: 0; }` +
                  (c.lineBreak ? ` .bubble-sub-button-${i + 1} { flex-basis: 100% !important; width: 100% !important; height: 0 !important; min-height: 0 !important; padding: 0 !important; margin: -4px 0 !important; border: 0 !important; background: none !important; overflow: hidden !important; }` : "") +
                  (c.showExpr ? ` .bubble-sub-button-${i + 1} { display: \${${c.showExpr} ? 'flex' : 'none'} !important; }` : "") +
                  ` .bubble-sub-button-${i + 1}::after { content: "\${${c.text}}"; font-size: 14px; white-space: normal; overflow-wrap: anywhere; text-align: left; line-height: 1.3; padding: 6px 0; min-width: 0; color: #f2f5fa; order: 1; }`
              )
              .join(""),
          tap_action: { action: "none" },
          button_action: { tap_action: { action: "none" } },
        },
      ];
    };
    // Arm / disarm pop-up for an alarm panel (Security page and, from the alarm chip, the Home screen).
    const alarmPopup = (id) =>
      popupShell(`#security-${slug(id.split(".")[1])}`, NAMES[id] || "Home Security", "mdi:shield-lock-outline", [...elanAlarmCards(hass, id)]);
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
          grid_options: { columns: "full", rows: "auto" },
          tap_action: { action: "none" },
          button_action: { tap_action: { action: "none" } },
          styles:
            ".bubble-button-card-container { background: none !important; height: 52vh !important; } .bubble-button-background, .bubble-main-icon-container { display: none !important; }" +
            " .bubble-button-card { justify-content: center !important; } .bubble-name-container { margin: 0 auto !important; align-items: center !important; text-align: center; }" +
            " .bubble-name { font-size: 30px !important; font-weight: 300 !important; letter-spacing: .35em; opacity: .95; line-height: 1.4 !important; overflow: visible !important; }" +
            " .bubble-name-container::after { content: \"${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}\"; display: block; font-size: 84px; font-weight: 200; line-height: 1.15; opacity: .85; }" +
            " .bubble-button-card-container::after { content: \"${new Date().toLocaleDateString([], { weekday: 'long' }) + ' · ' + new Date().toLocaleDateString([], { month: 'long', day: 'numeric' })" + wx + "}\";" +
            " position: absolute; left: 0; right: 0; bottom: 8%; text-align: center; font-size: 18px; opacity: .7; }" +
            // Home content (clock, date, alert chips) centred vertically in the window, like the menu.
            elanCenterHook("__pvHomeC", false, ".bubble-name-container") +
            // Phones: shorter hero and smaller clock so the alert chips underneath stay on screen above the bottom bar.
            " @media (max-width: 999px) { .bubble-button-card-container { height: 36vh !important; min-height: 250px; } .bubble-name { font-size: 22px !important; }" +
            " .bubble-name-container::after { font-size: 64px; } .bubble-button-card-container::after { font-size: 16px; bottom: 4%; } }",
        },
        ...homeAlerts(),
      ], ctx.alarms.map((id) => alarmPopup(id)))
    );

    // SECURITY — alarm, gate(s), garage doors, then every lock with LOCK / UNLOCK.
    if (items.some((i) => i.path === "security")) {
      const content = [elanTitle("Security")];
      const securityPopups = [];
      for (const id of ctx.alarms) {
        const st = "hass.states['" + id + "'] ? hass.states['" + id + "'].state : ''";
        content.push(
          elanRow({
            name: NAMES[id] || "Home Security",
            icon: "mdi:shield-lock-outline",
            sub: "Security partition",
            value: "((s) => s.startsWith('armed') ? 'Armed' : " + titleCase("s") + ")(" + st + ")",
            label: "((s) => s.startsWith('armed_') ? s.slice(6).replace(/_/g, ' ') : '')(" + st + ")",
            tap: go(`#security-${slug(id.split(".")[1])}`),
          })
        );
        // ELAN pop-up with Home Assistant's alarm panel: Arm Home / Arm Away / Disarm, and a keypad whenever the
        // alarm requires a code (for Alarm.com: Settings → Devices & services → Alarm.com → Configure → Arm code).
        const feat = (hass.states[id] && hass.states[id].attributes.supported_features) || 0;
        const modes = [[1, "arm_home"], [2, "arm_away"], [4, "arm_night"], [32, "arm_vacation"]].filter(([b]) => feat & b).map(([, m]) => m);
        securityPopups.push(
          popupShell(`#security-${slug(id.split(".")[1])}`, NAMES[id] || "Home Security", "mdi:shield-lock-outline", [
            ...elanAlarmCards(hass, id),
          ])
        );
      }
      for (const ic of intercoms)
        content.push(
          elanRow({
            name: ic.name || "Gate",
            icon: "mdi:gate",
            sub: "Gate",
            value: ic.status_sensor
              ? "(" + (ic.lock_rule ? holdHeldExpr(ic) + " ? 'Held Open' : " : "") + "(hass.states['" + ic.status_sensor + "'] && hass.states['" + ic.status_sensor + "'].state === 'on' ? 'Open' : 'Closed'))"
              : null,
            label: ic.lock_rule ? "(" + holdHeldExpr(ic) + " ? ((r) => r ? r + ' left' : '')(" + holdRemainingExpr(ic) + ") : '')" : null,
            tap: go(intercomHash(ic)),
          })
        );
      for (const id of garages)
        content.push(
          elanRow({ name: label(id), icon: "mdi:garage-variant", sub: "Door control", value: titleCase("hass.states['" + id + "'] && hass.states['" + id + "'].state"), tap: { action: "toggle" }, extra: { entity: id } })
        );
      // Locks: each door says Locked / Unlocked in words and colour, with one button for the opposite action.
      if (locks.length > 1) content.push(elanLocksSummary(locks));
      // Unlocked doors jump to just below Lock All (a copy shown only while unlocked); the normal list hides them meanwhile.
      const isUnl = (id) => [{ condition: "state", entity: id, state: UNLOCKED_STATES }];
      const isLk = (id) => [{ condition: "state", entity: id, state_not: UNLOCKED_STATES }];
      for (const id of locks) content.push({ ...elanLockRow(hass, id, label(id), go(`#lock-${slug(id.split(".")[1])}`)), visibility: isUnl(id) });
      for (const id of locks) {
        content.push({ ...elanLockRow(hass, id, label(id), go(`#lock-${slug(id.split(".")[1])}`)), visibility: isLk(id) });
        securityPopups.push(elanLockPopup(hass, id, label(id)));
      }
      views.push(view("security", "Security", content, securityPopups));
    }

    // CLIMATE — ELAN climate rows (see elanClimateRow): name, big temperature, cool/heat setpoint boxes with ▲ / ▼, › to full controls.
    if (items.some((i) => i.path === "climate"))
      views.push(
        view(
          "climate",
          "Climate",
          [
            elanTitle("Climate"),
            ...climateZones.map(({ entity: id, name }) => elanClimateRow(id, name || label(id), thermostatHash(id))),
          ],
          popupsWhere((h) => h.startsWith("#thermostat-"))
        )
      );

    // ROOMS — the PivIT Home (Savant) room tiles in ELAN colours: live light / fan / lock / TV / audio / temperature icons,
    // tap a tile for the room pop-up, tap an icon for that pop-up (lights, fans, locks, TV, audio, thermostat…).
    // Pop-ups: every Savant pop-up the tiles link to, and the ones those link to in turn.
    if (items.some((i) => i.path === "rooms")) {
      // ELAN room tiles: one row — room icon and name on the left; on the right, the temperature at the far end and,
      // to its left, an icon for each thing that is on (lights, fans, TV, audio playing, a door unlocked). Tap the
      // tile for the room pop-up, an icon for its pop-up (as on the PivIT Home dashboard). No motion / open alerts.
      const anyIn = (ids, states) => ({ condition: "or", conditions: ids.map((e) => ({ condition: "state", entity: e, state: states })) });
      const roomByName = Object.fromEntries(ctx.rooms.map((r) => [r.name, r]));
      const UNLOCKED = ["unlocked", "open", "opening", "unlocking", "jammed"];
      const roomTileElan = (t) => {
        const r = roomByName[t.name];
        if (!r) return null;
        const hash = "#" + slug(r.name);
        const { tvs, audio } = roomMediaSplit(r, hass);
        const lights = roomLights(r).filter((e) => hass.states[e]);
        const fans = roomFans(r).filter((e) => hass.states[e]);
        const rlocks = r.entities.filter((id) => domainOf(id) === "lock" && (!cfg.room_lock_platforms || cfg.room_lock_platforms.includes(((hass.entities || {})[id] || {}).platform)));
        const ft = (cfg.room_thermostats || {})[r.id] ?? (cfg.floor_thermostats || {})[r.floor];
        const climate = ft === "none" ? null : roomClimates(r, hass)[0] || (ft && hass.states[ft] ? ft : null);
        const subs = [];
        const styles = [];
        // A room with a pool page (Pool): pump / spa / light icons while on, and the water temperature — the spa's while
        // its heater runs (red), else the pool's (red while the pool heater runs).
        const pv = extra.find((v) => slug(v.title || v.path) === slug(r.name));
        const pent = pv ? (pv.sections || []).flatMap((x) => x.cards || []).map((c) => c.entity).filter((e) => e && hass.states[e]) : [];
        const poolBodies = pent.filter((e) => domainOf(e) === "climate" && /pool|spa/i.test(e));
        const icon = (entity, ic, tap, vis, colour) => {
          subs.push({ entity, icon: ic, show_icon: true, show_name: false, show_state: false, show_background: false, tap_action: go(tap), visibility: vis });
          styles.push(` .bubble-sub-button-${subs.length} ha-icon, .bubble-sub-button-${subs.length} .bubble-sub-button-icon { color: ${colour} !important; --mdc-icon-size: 22px; }`);
        };
        // Left → right (Bubble lays sub-buttons out in order at the right end): audio, TV, lock, fan, lights, temperature.
        if (audio.length) icon(audio[0], "mdi:speaker", hash + "-audio", [anyIn(audio, ["playing"])], ELAN_ACCENT);
        if (tvs.length) icon(tvs[0], "mdi:television", hash + "-tv", [anyIn(tvs, ["on", "playing", "paused", "buffering"])], ELAN_ACCENT);
        if (rlocks.length) icon(rlocks[0], "mdi:lock-open-variant", hash + "-locks", [anyIn(rlocks, UNLOCKED)], ELAN_HEAT);
        if (fans.length) icon(fans[0], "mdi:ceiling-fan", hash + "-fans", [anyIn(fans, ["on"])], ELAN_ACCENT);
        if (lights.length && !poolBodies.length) icon(lights[0], "mdi:lightbulb-group", hash + "-lights", [anyIn(lights, ["on"])], "#f5c518");
        if (poolBodies.length) {
          const find = (re, dom) => pent.find((e) => domainOf(e) === dom && re.test(e));
          const poolPump = find(/pool_pump/, "switch"), spaPump = find(/spa_pump/, "switch");
          const pLights = pent.filter((e) => domainOf(e) === "light");
          if (poolPump) icon(poolPump, "mdi:pump", hash, [anyIn([poolPump], ["on"])], ELAN_ACCENT);
          if (spaPump) icon(spaPump, "mdi:hot-tub", hash, [anyIn([spaPump], ["on"])], ELAN_ACCENT);
          if (pLights.length) icon(pLights[0], "mdi:lightbulb-group", hash, [anyIn(pLights, ["on"])], "#f5c518");
          const tempOf = (key) => {
            const sen = find(new RegExp(`${key}_temp`), "sensor") || Object.keys(hass.states).find((e) => domainOf(e) === "sensor" && new RegExp(`_${key}_temp$`).test(e));
            const cl = poolBodies.find((e) => new RegExp(key).test(e));
            return sen
              ? "((s) => s && !isNaN(parseFloat(s.state)) ? Math.round(parseFloat(s.state)) + '°' : '')(hass.states['" + sen + "'])"
              : "((s) => s && s.attributes.current_temperature != null ? Math.round(s.attributes.current_temperature) + '°' : '')(hass.states['" + cl + "'])";
          };
          const on = (e) => (e ? "((hass.states['" + e + "'] || {}).state === 'on')" : "false");
          const poolHeat = on(find(/pool_heater/, "switch")), spaHeat = on(find(/spa_heater/, "switch"));
          subs.push({ entity: poolBodies[0], icon: "mdi:thermometer", show_icon: true, show_name: false, show_state: false, show_background: false, tap_action: go(hash) });
          const n = subs.length;
          styles.push(
            ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon { display: none !important; }` +
              ` .bubble-sub-button-${n} { width: auto !important; min-width: 52px; padding: 0 4px 0 8px !important; justify-content: flex-end !important; }` +
              ` .bubble-sub-button-${n}::after { content: "\${${spaHeat} ? ${tempOf("spa")} : ${tempOf("pool")}}"; font-size: 22px; font-weight: 300;` +
              ` color: \${${spaHeat} || ${poolHeat} ? '${ELAN_HEAT}' : '#f2f5fa'} !important; }`
          );
        } else if (climate) {
          // A sub-button needs something visible or Bubble hides it: keep an icon, hide it, and draw the rounded temperature.
          subs.push({ entity: climate, icon: "mdi:thermometer", show_icon: true, show_name: false, show_state: false, show_background: false, tap_action: go(thermostatHash(climate)) });
          const n = subs.length;
          styles.push(
            ` .bubble-sub-button-${n} ha-icon, .bubble-sub-button-${n} .bubble-sub-button-icon { display: none !important; }` +
              ` .bubble-sub-button-${n} { width: auto !important; min-width: 52px; padding: 0 4px 0 8px !important; justify-content: flex-end !important; }` +
              ` .bubble-sub-button-${n}::after { content: "\${((s) => s && s.attributes.current_temperature != null ? Math.round(s.attributes.current_temperature) + '°' : '')(hass.states['${climate}'])}"; font-size: 22px; font-weight: 300;` +
              // Colour shows what the system is doing: blue cooling, red heating, white otherwise.
              ` color: \${((a) => a === 'cooling' ? '${ELAN_ACCENT}' : a === 'heating' ? '${ELAN_HEAT}' : '#f2f5fa')((hass.states['${climate}'] || { attributes: {} }).attributes.hvac_action)} !important; }`
          );
        }
        return {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          name: r.name,
          icon: t.icon,
          sub_button: subs,
          styles:
            ELAN_ROW_STYLE +
            " .bubble-sub-button-container { position: static !important; display: flex !important; flex-direction: row !important; align-items: center !important; gap: 6px !important; margin-left: auto !important; margin-right: 10px !important; height: 100% !important; }" +
            " .bubble-sub-button { height: 36px !important; min-width: 32px; }" +
            styles.join(""),
          tap_action: go(hash),
          button_action: { tap_action: go(hash) },
        };
      };
      // Order: elan_room_order (room ids or names), the rest after.
      const ro = (cfg.elan_room_order || []).map((x) => slug(x));
      const rRank = (t) => { const r = roomByName[t.name]; const i = r ? Math.max(ro.indexOf(slug(r.id)), ro.indexOf(slug(r.name))) : -1; return i < 0 ? 999 : i; };
      const tiles = roomTiles.slice().sort((a, b) => rRank(a) - rRank(b)).map(roomTileElan).filter(Boolean);
      // Pop-ups: every Savant pop-up the tiles link to, and the ones those link to in turn.
      const byHash = {};
      for (const pp of popups) byHash[pp.hash] = pp;
      const need = new Set();
      const scan = (o) => (JSON.stringify(o).match(/"navigation_path":"(#[^"]+)"/g) || []).map((m) => m.slice(19, -1));
      const queue = scan(tiles);
      while (queue.length) {
        const h = queue.shift();
        if (need.has(h) || !byHash[h]) continue;
        need.add(h);
        queue.push(...scan(byHash[h]));
      }
      // A room with its own page (e.g. Pool): its pop-up shows that page's layout — pool / spa panels and buttons in
      // the same order — plus the room's speakers, TVs, cameras and covers.
      for (const v of extra) {
        const pp = byHash["#" + slug(v.title || v.path)];
        const pcards = (v.sections || []).flatMap((x) => x.cards || []);
        const bodies = pcards.filter((c) => ["thermostat", "custom:bubble-card"].includes(c.type) && domainOf(c.entity || "") === "climate" && /pool|spa/i.test(c.entity + " " + (c.name || "")));
        if (!pp || !bodies.length || pp.__pvPool) continue;
        const keep = (pp.cards || []).filter((c) => c && (c.entity || c.entity_id) && ["media_player", "camera", "cover", "lock"].includes(domainOf(c.entity || c.entity_id)));
        pp.cards = [...elanPool(hass, pcards.filter((c) => c.type !== "heading"), bodies), ...keep];
        pp.__pvPool = 1;
      }
      const grid = (columns) => ({ type: "grid", columns, square: false, cards: tiles });
      views.push(
        view(
          "rooms",
          "Rooms",
          { wide: [elanTitle("Rooms"), grid(2)], narrow: [elanTitle("Rooms"), grid(1)] },
          [...need].map((h) => byHash[h]).filter((pp) => !intercoms.some((ic) => intercomHash(ic) === pp.hash))
        )
      );
    }
    // SCENES — a large row per scene script: icon, name, what it does; tap → confirm → run. "Running…" while it runs.
    if (items.some((i) => i.path === "scenes")) {
      const rows = scenes.map((sc) => {
        const st = hass.states[sc.entity];
        const name = sc.name || NAMES[sc.entity] || st.attributes.friendly_name || sc.entity;
        const desc = (sc.description || "").replace(/"/g, "'");
        return {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          entity: sc.entity,
          name,
          icon: sc.icon || st.attributes.icon || "mdi:script-text-outline",
          show_state: false,
          grid_options: { columns: "full" },
          sub_button: [{ name: "Run", icon: "mdi:play", show_name: true, show_icon: true, show_background: true,
            tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: sc.entity }, confirmation: { text: `Run ${name}?` } } }],
          styles:
            ELAN_ROW_STYLE +
            " .bubble-button-card-container { height: 92px !important; } .bubble-icon { --mdc-icon-size: 34px; }" +
            " .bubble-name { font-size: 24px !important; }" +
            " .bubble-name-container::after { content: \"${(hass.states['" + sc.entity + "'] || {}).state === 'on' ? 'Running…' : " + JSON.stringify(desc) + "}\"; display: block; font-size: 12px; letter-spacing: .04em; opacity: .65; margin-top: 3px; white-space: normal; line-height: 1.35; }" +
            " .bubble-sub-button-1 { height: 40px !important; padding: 0 18px !important; gap: 8px !important; border-radius: 4px !important; border: 1px solid rgba(255,255,255,.35);" +
            " background: ${(hass.states['" + sc.entity + "'] || {}).state === 'on' ? '" + ELAN_ACCENT + "' : 'rgba(255,255,255,.08)'} !important; }" +
            " .bubble-sub-button-1 ha-icon { color: #f2c12e !important; } .bubble-sub-button-1 .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .12em; text-transform: uppercase; color: #fff !important; }",
          tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: sc.entity }, confirmation: { text: `Run ${name}?` } },
          button_action: { tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: sc.entity }, confirmation: { text: `Run ${name}?` } } },
        };
      });
      views.push(view("scenes", "Scenes", [elanTitle("Scenes"), ...rows]));
    }
    // LIGHTING — rooms with the number of devices on; shades follow (ELAN keeps shades under lighting).
    if (items.some((i) => i.path === "lighting")) {
      const content = [elanTitle("Lighting")];
      const shadePopups = [];
      for (const r of lightRooms) {
        const n = lightsOnExpr(roomLights(r));
        content.push(elanRow({ name: r.name, icon: "mdi:lightbulb-outline", value: n, label: "'Devices on'", tap: go(`${base}/lighting-${slug(r.name)}`) }));
      }
      if (shadeRooms.length) {
        content.push(elanSubhead("Shades"));
        for (const r of shadeRooms)
          for (const id of r.entities.filter((e) => domainOf(e) === "cover" && !/garage|gate/i.test(hass.states[e].attributes.device_class || ""))) {
            content.push(elanShadeRow(hass, id, label(id)));
            shadePopups.push(elanShadePopup(hass, id, label(id)));
          }
      }
      views.push(view("lighting", "Lighting", content, [...popupsWhere((h) => h.endsWith("-lights")), ...shadePopups]));
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
          if (domainOf(id) === "fan") { content.push(elanFanCard(id, shortLabel(r, hass, id))); continue; }
          const c = entityCard(hass, id, { half: "full" });
          c.name = shortLabel(r, hass, id);
          c.grid_options = { columns: "full" };
          c.styles =
            (c.styles || "") +
            " " + ELAN_ROW_STYLE +
            " .bubble-range-fill { background: rgba(47,127,224,.28) !important; border-right: 2px solid " + ELAN_ACCENT + "; }" +
            " .bubble-state { font-size: 13px !important; opacity: .7; }";
          if (hasEffects(hass, id)) {
            c.sub_button = [...(c.sub_button || []), effectSubButton(id)];
            c.styles += effectStyles(id, c.sub_button.length);
          }
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
            " .bubble-name-container { margin: 0 auto !important; align-items: center !important; } .bubble-name { font-size: 18px !important; font-weight: 400 !important; } " + off.hook +
            // Dimmed (and not clickable) until something in the room is on.
            " ha-card { transition: opacity .2s; opacity: ${" + JSON.stringify(loads) + ".some((e) => hass.states[e] && ['on', 'open', 'opening'].includes(hass.states[e].state)) ? 1 : .35} !important;" +
            " pointer-events: ${" + JSON.stringify(loads) + ".some((e) => hass.states[e] && ['on', 'open', 'opening'].includes(hass.states[e].state)) ? 'auto' : 'none'} !important; }",
          ...off.actions,
        });
        views.push(view(`lighting-${slug(r.name)}`, r.name, content, [], "lighting"));
      });

    // MEDIA — "All Zones Off", what's playing, then every zone with its source and a volume bar (› opens the zone).
    if (items.some((i) => i.path === "media")) {
      const allAudio = mediaRooms.flatMap((r) => roomMediaSplit(r, hass).audio);
      const allTvs = mediaRooms.flatMap((r) => roomMediaSplit(r, hass).tvs);
      // Players that can't be switched off (e.g. a Sonos with a TV input) are paused instead of turned off.
      const canOff = (id) => ((hass.states[id] && hass.states[id].attributes.supported_features) || 0) & 256;
      const offTvs = allTvs.filter(canOff);
      const pauseOnly = [...new Set([...allAudio, ...allTvs.filter((id) => !canOff(id))])];
      const off = liveBulk(pauseOnly, ["playing"], "media_player.media_pause", {
        confirm: false,
        extra: offTvs.length ? [{ ids: offTvs, states: ["on", "playing", "paused", "idle", "buffering"], service: "media_player.turn_off" }] : [],
      });
      const audioRoomOf = {};
      for (const r of mediaRooms) for (const a of roomMediaSplit(r, hass).audio) if (!audioRoomOf[a]) audioRoomOf[a] = r.name;
      const content = [
        elanTitle("Media Zones"),
        { type: "custom:bubble-card", card_type: "button", button_type: "name", name: "All Zones Off", icon: "mdi:power", grid_options: { columns: "full" }, styles: ELAN_ROW_STYLE + " " + off.hook, ...off.actions },
        // Now playing: one card per speaker, shown only while it plays.
        ...[...new Set(allAudio)].map((id) => ({
          type: "conditional",
          conditions: [{ condition: "state", entity: id, state: "playing" }],
          card: AUDIO_CARD === "mediocre"
            ? {
                type: "custom:mediocre-media-player-card",
                entity_id: id,
                use_art_colors: false,
                tap_opens_popup: false,
                options: { show_volume_step_buttons: true },
                // Tapping the artwork opens the room's ELAN audio pop-up, not Home Assistant's grey media dialog.
                action: { tap_action: audioRoomOf[id] ? go("#" + slug(audioRoomOf[id]) + "-audio") : { action: "none" } },
              }
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
      // Running zones show at the top (a copy visible only while on); the normal list hides them meanwhile.
      const onStates = sm.on_states || ["on"];
      const zoneRows = [];
      for (const id of sm.entities || []) {
        if (!hass.states[id]) continue;
        const card = (sm.cards || []).find((c) => c.entity === id) || {};
        zoneRows.push([id,
          elanRow({
            name: card.name || label(id),
            icon: card.icon || sm.icon || "mdi:sprinkler-variant",
            sub: "Zone",
            value: "(hass.states['" + id + "'] && hass.states['" + id + "'].state === 'on' ? 'Running' : 'Off')",
            tap: byEntity[id] ? go(byEntity[id]) : { action: "more-info" },
            extra: byEntity[id] ? {} : { entity: id },
          })]
        );
      }
      for (const [id, row] of zoneRows) content.push({ ...row, visibility: [{ condition: "state", entity: id, state: onStates }] });
      for (const [id, row] of zoneRows) content.push({ ...row, visibility: [{ condition: "state", entity: id, state_not: onStates }] });
      views.push(view(path, title, content, sm.popups || []));
    }

    // VIDEO — every camera live (two per row beside the menu, one per row on narrower screens); tapping a camera opens
    // an ELAN pop-up with it live and large.
    if (items.some((i) => i.path === "video")) {
      const camName = (id) => label(id).replace(/\s+(High|Medium|Low) resolution channel$/i, "");
      const camHash = (id) => `#camera-${slug(id.split(".")[1].replace(/_(high|medium|low)_resolution_channel$/, ""))}`;
      // Grid tiles use a camera's low (or medium) resolution stream when one exists — twelve high-res live feeds are a
      // lot for an iPad; the pop-up always uses the camera as configured (high resolution).
      const gridStream = (id) => {
        for (const res of ["low", "medium"]) {
          const alt = id.replace(/_(high|medium|low)_resolution_channel$/, `_${res}_resolution_channel`);
          if (alt !== id && hass.states[alt] && hass.states[alt].state !== "unavailable") return alt;
        }
        return id;
      };
      // Detection sensors on the camera's device (UniFi Protect: …_motion, …_person_detected, …_vehicle_detected,
      // …_animal_detected, …_package_detected).
      const DETECT = [
        ["motion", "mdi:motion-sensor"],
        ["person_detected", "mdi:walk"],
        ["vehicle_detected", "mdi:car"],
        ["animal_detected", "mdi:paw"],
        ["package_detected", "mdi:package-variant-closed"],
      ];
      const detectors = (id) => {
        const dev = hass.entities && hass.entities[id] && hass.entities[id].device_id;
        if (!dev) return [];
        const mine = Object.values(hass.entities).filter((e) => e.device_id === dev && e.entity_id.startsWith("binary_sensor.") && !e.hidden && hass.states[e.entity_id]);
        return DETECT.map(([suffix, icon]) => {
          const e = mine.find((x) => x.entity_id.endsWith("_" + suffix));
          return e ? { entity: e.entity_id, icon } : null;
        }).filter(Boolean);
      };
      // Camera tile: live feed, name along the bottom, and — top right — an icon for each kind of detection seen in
      // the last 5 minutes (yellow while it's happening, white for the rest of the 5 minutes). Taps go to the pop-up.
      const tile = (id) => {
        const dets = detectors(id);
        const overlay = {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "name",
          name: camName(id),
          show_icon: false,
          sub_button: dets.map((d) => ({ entity: d.entity, icon: d.icon, show_icon: true, show_state: false, show_background: true, tap_action: { action: "none" } })),
          styles:
            ".bubble-button-card-container { background: linear-gradient(to bottom, rgba(0,0,0,.55), rgba(0,0,0,0)) !important; border: none !important; border-radius: 0 !important; height: 44px !important; }" +
            " .bubble-button-background, .bubble-main-icon-container { display: none !important; } .bubble-name-container { margin-left: 10px !important; }" +
            " .bubble-name { font-size: 14px !important; font-weight: 500 !important; text-shadow: 0 1px 2px rgba(0,0,0,.8); }" +
            " .bubble-sub-button { width: 28px !important; height: 28px !important; min-width: 28px !important; border-radius: 4px !important; background: rgba(0,0,0,.55) !important; pointer-events: none !important; }" +
            dets
              .map(
                (d, i) =>
                  // Shown if detected now or ended within 5 minutes (last_changed of the "off" state).
                  ` .bubble-sub-button-${i + 1} { display: \${((s) => s && (s.state === 'on' || (s.state === 'off' && Date.now() - new Date(s.last_changed).getTime() < 300000)) ? 'flex' : 'none')(hass.states['${d.entity}'])} !important; }` +
                  ` .bubble-sub-button-${i + 1} ha-icon { --mdc-icon-size: 18px; color: \${hass.states['${d.entity}'] && hass.states['${d.entity}'].state === 'on' ? '#f2c12e' : '#ffffff'} !important; }`
              )
              .join(""),
          tap_action: { action: "none" },
          button_action: { tap_action: { action: "none" } },
        };
        return {
          type: "picture-elements",
          camera_image: gridStream(id),
          camera_view: "live",
          aspect_ratio: "16:9",
          tap_action: { action: "navigate", navigation_path: camHash(id) },
          hold_action: { action: "none" },
          elements: [
            // Invisible full-size tap area (a picture-elements card only reacts to taps on its elements).
            {
              type: "image",
              image: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
              tap_action: { action: "navigate", navigation_path: camHash(id) },
              hold_action: { action: "none" },
              style: { top: "0", left: "0", width: "100%", height: "100%", transform: "none", opacity: "0" },
            },
            {
              type: overlay.type,
              ...overlay,
              style: { top: "0", left: "0", width: "100%", transform: "none", "pointer-events": "none" },
            },
          ],
        };
      };
      const grid = (columns) => ({ type: "grid", columns, square: false, cards: ctx.cameras.map(tile) });
      // Installed? Check the dashboard resources (the card's script may not have loaded yet when this runs).
      const resources = await hass.connection.sendMessagePromise({ type: "lovelace/resources" }).catch(() => []);
      const hasCameraCard = !!customElements.get("advanced-camera-card") || (resources || []).some((r) => /advanced-camera-card/.test(r.url || ""));
      // Pop-up player (Advanced Camera Card, when installed): live, with only a mute/unmute button (camera audio) and a
      // full-screen button, along the bottom.
      const off = { enabled: false };
      const camCard = (id) => ({
        type: "custom:advanced-camera-card",
        cameras: [{ camera_entity: id, live_provider: "auto" }],
        view: { default: "live" },
        live: { draggable: false, controls: { builtin: false, next_previous: { style: "none" }, thumbnails: { mode: "none" } } },
        dimensions: { aspect_ratio_mode: "static", aspect_ratio: "16:9" },
        menu: {
          style: "overlay",
          position: "bottom",
          alignment: "right",
          button_size: 44,
          buttons: {
            mute: { enabled: true, priority: 90 },
            fullscreen: { enabled: true, priority: 80 },
            ...Object.fromEntries(["iris", "cameras", "substreams", "live", "clips", "snapshots", "recordings", "image", "timeline", "download", "camera_ui", "media_player", "display_mode", "gallery", "folders", "info", "set_review", "call", "expand", "pip", "play", "screenshot"].map((b) => [b, off])),
          },
        },
        grid_options: { columns: "full" },
      });
      // Protect name of each camera (its device name) for the event clips.
      const protectName = (id) => { const dev = hass.entities && hass.entities[id] && hass.entities[id].device_id; return (dev && hass.devices && hass.devices[dev] && (hass.devices[dev].name_by_user || hass.devices[dev].name)) || camName(id); };
      const useEvents = cfg.camera_events !== false && Object.values(hass.entities || {}).some((e) => e.platform === "unifiprotect");
      const camPopups = ctx.cameras.map((id) =>
        ({ ...popupShell(camHash(id), camName(id), "mdi:cctv", [
          hasCameraCard ? camCard(id) : { type: "picture-entity", entity: id, name: camName(id), camera_view: "live", show_state: false, show_name: false, aspect_ratio: "16:9", tap_action: { action: "none" }, hold_action: { action: "none" }, grid_options: { columns: "full" } },
          ...(useEvents && (hass.entities[id] || {}).platform === "unifiprotect"
            ? [{ type: "custom:pivit-events-card", compact: true, limit: 20, cameras: [{ name: camName(id), match: protectName(id) }], grid_options: { columns: "full" } }]
            : []),
        ]), width_desktop: "960px" })
      );
      // Events: a button under the title opens every camera's recent detections (filter by type / camera, tap to play).
      // EVENTS button at the right end of the "Cameras" title line.
      const camTitle = elanTitle("Cameras");
      if (useEvents) {
        camTitle.sub_button = [{ name: "Events", icon: "mdi:filmstrip-box-multiple", show_name: true, show_icon: true, show_background: true, tap_action: go("#camera-events") }];
        camTitle.styles +=
          " .bubble-sub-button-container { position: absolute !important; right: 0; top: 50%; transform: translateY(-50%); }" +
          " .bubble-sub-button-1 { height: 34px !important; padding: 0 14px !important; gap: 8px !important; border-radius: 4px !important; background: rgba(255,255,255,.08) !important; border: 1px solid rgba(255,255,255,.35); }" +
          " .bubble-sub-button-1 ha-icon { color: #f2c12e !important; --mdc-icon-size: 18px; }" +
          " .bubble-sub-button-1 .bubble-sub-button-name-container { font-size: 12px !important; letter-spacing: .12em; text-transform: uppercase; color: #fff !important; }" +
          " @media (max-width: 520px) { .bubble-sub-button-1 .bubble-sub-button-name-container { display: none !important; } .bubble-sub-button-1 { padding: 0 10px !important; } }";
      }
      const eventsButton = [];
      if (useEvents)
        camPopups.push({
          ...popupShell("#camera-events", "Camera Events", "mdi:filmstrip-box-multiple", [
            { type: "custom:pivit-events-card", cameras: ctx.cameras.filter((id) => (hass.entities[id] || {}).platform === "unifiprotect").map((id) => ({ name: camName(id), match: protectName(id) })), grid_options: { columns: "full" } },
          ]),
          width_desktop: "900px",
        });
      views.push(view("video", "Cameras", { wide: [camTitle, ...eventsButton, grid(2)], narrow: [camTitle, ...eventsButton, grid(1)] }, camPopups));
    }

    // Extra views (e.g. Pool) keep their own content, inside the ELAN frame.
    for (const v of extra) {
      const cards = (v.sections || []).flatMap((x) => x.cards || []);
      // Drop a heading that only repeats the page title (the ELAN title already shows it).
      if (cards[0] && cards[0].type === "heading" && (cards[0].heading || "").toLowerCase() === (v.title || "").toLowerCase()) cards.shift();
      const bodies = cards.filter((c) => ["thermostat", "custom:bubble-card"].includes(c.type) && domainOf(c.entity || "") === "climate" && /pool|spa/i.test(c.entity + " " + (c.name || "")));
      views.push(view(v.path, v.title, bodies.length ? [elanTitle(v.title), ...elanPool(hass, cards, bodies)] : [elanTitle(v.title), ...cards]));
    }

    return { title: cfg.title, views, kiosk_mode: kioskMode(cfg) };
  }
}

/* ------------------------------------------------------------------ */
// custom:pivit-events-card — UniFi Protect event clips (through Home Assistant's media source): filter chips
// (All / Person / Vehicle / Animal / Package / Ring), 24 h or 7 days, an optional camera list, thumbnails newest first;
// tap one to play its clip in the player at the top (native controls, full screen). Works for non-admin users.
// Config: cameras: [{ name, match }] (match = the camera's name in Protect; all Protect cameras when omitted),
// limit (default 60), compact: true for a one-row strip (camera pop-ups), types (filter chips to show).
class PivitEventsCard extends HTMLElement {
  setConfig(config) {
    this._cfg = { limit: 60, compact: false, ...config };
    this._filter = "all";
    this._days = 1;
    this._cam = "";
    this._items = null;
    this._loadedAt = 0;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._renderShell();
  }
  set hass(hass) {
    this._hass = hass;
    // (Re)load when first shown and then at most once a minute while open.
    if (this.isConnected && Date.now() - this._loadedAt > 60000) this._load();
  }
  connectedCallback() { if (this._hass && Date.now() - this._loadedAt > 60000) this._load(); }
  getCardSize() { return this._cfg && this._cfg.compact ? 2 : 8; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  static _kind(title) {
    const t = (title || "").toLowerCase();
    if (/ring/.test(t)) return "Ring";
    if (/package/.test(t)) return "Package";
    if (/animal|dog|cat|deer|bird|pet/.test(t)) return "Animal";
    if (/vehicle|car|suv|truck|van|license|motorcycle|bike/.test(t)) return "Vehicle";
    if (/person|face|people/.test(t)) return "Person";
    if (/audio|sound|bark|alarm|glass|siren|speak/.test(t)) return "Sound";
    return "Motion";
  }
  _renderShell() {
    const c = this._cfg;
    const chips = (c.types || ["all", "Person", "Vehicle", "Animal", "Package", "Ring"])
      .map((k) => `<button class="chip" data-k="${k}">${k === "all" ? "All" : k}</button>`)
      .join("");
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; color: #f2f5fa; font-family: inherit; }
        .wrap { background: rgba(12,14,22,.72); border: 1px solid rgba(255,255,255,.06); border-radius: 6px; padding: 12px; box-sizing: border-box; }
        .player { display: none; margin-bottom: 12px; } .player.on { display: block; }
        .player video { width: 100%; max-height: 62vh; background: #000; border-radius: 4px; display: block; }
        .pbar { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 14px; }
        .pbar .t { flex: 1; opacity: .85; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { font: inherit; color: #f2f5fa; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: 4px; padding: 6px 12px; cursor: pointer; }
        button.sel { background: #2f7fe0; border-color: #2f7fe0; }
        .bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
        .bar .sp { flex: 1; }
        select { font: inherit; color: #f2f5fa; background: #1d2244; border: 1px solid rgba(255,255,255,.12); border-radius: 4px; padding: 6px 8px; }
        .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
        .compact .list { grid-auto-flow: column; grid-auto-columns: 160px; grid-template-columns: none; overflow-x: auto; padding-bottom: 4px; }
        .ev { position: relative; cursor: pointer; border-radius: 4px; overflow: hidden; background: #0b0d1a; aspect-ratio: 16 / 9; border: 1px solid rgba(255,255,255,.08); }
        .ev.playing { outline: 2px solid #2f7fe0; }
        .ev img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ev .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 7px 4px; font-size: 12px; line-height: 1.3; background: linear-gradient(transparent, rgba(0,0,0,.8)); }
        .ev .k { position: absolute; top: 5px; left: 5px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(12,14,22,.8); }
        .k.Person { color: #f5c518; } .k.Vehicle { color: #6fb2ff; } .k.Animal { color: #7ddc8a; } .k.Package { color: #f0a020; } .k.Ring { color: #ff7a7a; }
        .msg { opacity: .65; padding: 14px 4px; font-size: 14px; }
        @media (max-width: 520px) { .list { grid-template-columns: repeat(2, 1fr); } .compact .list { grid-template-columns: none; grid-auto-columns: 140px; } }
      </style>
      <div class="wrap ${c.compact ? "compact" : ""}">
        <div class="player"><video controls playsinline></video>
          <div class="pbar"><span class="t"></span><button class="fs">Full screen</button><button class="x">Close</button></div></div>
        <div class="bar">${c.compact ? `<span>Recent events</span>` : chips}<span class="sp"></span>
          ${c.compact ? "" : `<select class="cam"><option value="">All cameras</option></select>`}
          <button class="days">${this._days === 1 ? "24 hours" : "7 days"}</button></div>
        <div class="list"><div class="msg">Loading events…</div></div>
      </div>`;
    const r = this.shadowRoot;
    r.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => { this._filter = b.dataset.k; this._draw(); }));
    r.querySelector(".days").addEventListener("click", () => { this._days = this._days === 1 ? 7 : 1; r.querySelector(".days").textContent = this._days === 1 ? "24 hours" : "7 days"; this._load(); });
    const cam = r.querySelector(".cam");
    if (cam) cam.addEventListener("change", () => { this._cam = cam.value; this._draw(); });
    r.querySelector(".x").addEventListener("click", () => this._stop());
    r.querySelector(".fs").addEventListener("click", () => {
      const v = r.querySelector("video");
      if (v.requestFullscreen) v.requestFullscreen().catch(() => v.webkitEnterFullscreen && v.webkitEnterFullscreen());
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    });
  }
  async _load() {
    const hass = this._hass;
    if (!hass || this._busy) return;
    this._busy = true;
    this._loadedAt = Date.now();
    try {
      const norm = (x) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const root = await hass.callWS({ type: "media_source/browse_media", media_content_id: "media-source://unifiprotect" });
      // One console: the root already lists its cameras ("All Cameras", "Driveway"…); several: one entry per console.
      const single = (root.children || []).some((n) => /:browse:all$/.test(n.media_content_id));
      const tops = single
        ? [root]
        : await Promise.all((root.children || []).filter((n) => n.can_expand).map((n) => hass.callWS({ type: "media_source/browse_media", media_content_id: n.media_content_id })));
      const want = (this._cfg.cameras || []).map((c) => (typeof c === "string" ? { name: c, match: c } : c));
      const jobs = [];
      for (const top of tops) {
        for (const camNode of (top.children || []).filter((x) => /:browse:[^:]+$/.test(x.media_content_id) && !/:browse:all$/.test(x.media_content_id))) {
          const w = want.length ? want.find((c) => norm(c.match || c.name) === norm(camNode.title)) : { name: camNode.title };
          if (!w) continue;
          const id = camNode.media_content_id;
          for (const kind of ["smart", "ring"])
            jobs.push(
              hass.callWS({ type: "media_source/browse_media", media_content_id: `${id}:${kind}:recent:${this._days}` })
                .then((r) => (r.children || []).map((e) => ({ ...e, cam: w.name || camNode.title })))
                .catch(() => [])
            );
        }
      }
      const all = (await Promise.all(jobs)).flat();
      const items = all.map((e) => {
        const m = (e.title || "").match(/^(\d+\/\d+\/\d+)\s+(\d+:\d+):\d+\s+((?:\d+h\s*)?(?:\d+m\s*)?\d+s)?\s*(.*)$/);
        const desc = m ? m[4].replace(/^(Object Detection|Ring Event|Smart Detection)\s*-?\s*/i, "") : e.title;
        return { id: e.media_content_id, thumb: e.thumbnail, cam: e.cam, kind: PivitEventsCard._kind(e.title), when: m ? `${m[1]} ${m[2]}` : "", desc, sort: e.title || "" };
      });
      // Newest first (titles start with the date/time); drop near-duplicates (same camera and minute and kind).
      const key = (i) => { const m = i.sort.match(/^(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/); return m ? `${m[3]}${m[1].padStart(2, "0")}${m[2].padStart(2, "0")}${m[4].padStart(2, "0")}${m[5]}${m[6]}` : ""; };
      items.sort((a, b) => (key(b) > key(a) ? 1 : -1));
      const seen = new Set();
      this._items = items.filter((i) => { const k = i.cam + i.kind + key(i).slice(0, 12) + i.desc; if (seen.has(k)) return false; seen.add(k); return true; });
      const sel = this.shadowRoot.querySelector(".cam");
      if (sel) {
        const cams = [...new Set(this._items.map((i) => i.cam))].sort();
        const cur = this._cam;
        sel.innerHTML = `<option value="">All cameras</option>` + cams.map((c) => `<option ${c === cur ? "selected" : ""}>${c}</option>`).join("");
      }
      this._draw();
    } catch (e) {
      this.shadowRoot.querySelector(".list").innerHTML = `<div class="msg">Camera events aren't available (UniFi Protect media).</div>`;
    } finally {
      this._busy = false;
    }
  }
  async _draw() {
    const r = this.shadowRoot;
    r.querySelectorAll(".chip").forEach((b) => b.classList.toggle("sel", b.dataset.k === this._filter));
    const list = r.querySelector(".list");
    if (!this._items) return;
    const rows = this._items.filter((i) => (this._filter === "all" || i.kind === this._filter) && (!this._cam || i.cam === this._cam)).slice(0, this._cfg.limit);
    if (!rows.length) { list.innerHTML = `<div class="msg">No events in the last ${this._days === 1 ? "24 hours" : "7 days"}.</div>`; return; }
    list.innerHTML = rows
      .map((i, n) => `<div class="ev" data-n="${n}"><img loading="lazy" alt=""><span class="k ${i.kind}">${i.kind}</span><div class="cap">${this._cfg.compact ? "" : i.cam + " · "}${i.when.split(" ")[1] || ""} ${i.when.split(" ")[0] || ""}<br>${i.desc || ""}</div></div>`)
      .join("");
    list.querySelectorAll(".ev").forEach((el) => el.addEventListener("click", () => this._play(rows[+el.dataset.n], el)));
    // Thumbnails need a signed path (an <img> can't send the login token).
    const imgs = list.querySelectorAll(".ev img");
    rows.forEach(async (i, n) => {
      if (!i.thumb) return;
      try {
        if (!i.signed) i.signed = (await this._hass.callWS({ type: "auth/sign_path", path: i.thumb, expires: 3600 })).path;
        if (imgs[n]) imgs[n].src = i.signed;
      } catch (e) { /* no thumbnail */ }
    });
  }
  async _play(item, el) {
    const r = this.shadowRoot;
    try {
      const res = await this._hass.callWS({ type: "media_source/resolve_media", media_content_id: item.id });
      const v = r.querySelector("video");
      v.src = res.url;
      r.querySelector(".player").classList.add("on");
      r.querySelector(".pbar .t").textContent = `${item.kind} · ${item.cam} · ${item.when}${item.desc ? " · " + item.desc : ""}`;
      r.querySelectorAll(".ev").forEach((x) => x.classList.toggle("playing", x === el));
      v.play().catch(() => {});
      r.querySelector(".player").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) { /* clip not available */ }
  }
  _stop() {
    const r = this.shadowRoot;
    const v = r.querySelector("video");
    v.pause(); v.removeAttribute("src"); v.load();
    r.querySelector(".player").classList.remove("on");
    r.querySelectorAll(".ev").forEach((x) => x.classList.remove("playing"));
  }
}
if (!customElements.get("pivit-events-card")) {
  customElements.define("pivit-events-card", PivitEventsCard);
  (window.customCards = window.customCards || []).push({ type: "pivit-events-card", name: "PivIT Events", description: "UniFi Protect event clips (person, vehicle, animal, package, ring)" });
}

/* ------------------------------------------------------------------ */

if (!customElements.get("ll-strategy-dashboard-pivit-home")) {
  customElements.define("ll-strategy-dashboard-pivit-home", PivitHomeStrategy);
  console.info(`%c PivIT Home %c v${VERSION} `, "background:#1f6feb;color:#fff;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
}

if (!customElements.get("ll-strategy-dashboard-pivit-elan")) {
  customElements.define("ll-strategy-dashboard-pivit-elan", PivitElanStrategy);
}
