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

const VERSION = "1.0.41";

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
    const ctx = buildContext(cfg, hass);

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

    const navItems = [
      ...pages.map((p) => ({ ...PAGE_META[p], path: p })),
      ...extra.map((v) => ({ name: v.title, icon: v.icon || "mdi:view-dashboard", path: v.path })),
    ];
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

// Lights that are on show in the standard light yellow (HA's --state-light-active-color), not each bulb's own colour.
const LIGHT_ON_STYLES =
  ".bubble-button-background { background-color: ${state === 'on' ? 'var(--state-light-active-color, #ffc107)' : ''} !important; }" +
  " .bubble-icon { color: ${state === 'on' ? 'var(--state-light-active-color, #ffc107)' : ''} !important; }";

function entityCard(hass, id, opts = {}) {
  const card = baseEntityCard(hass, id, opts);
  if (NAMES[id]) card.name = NAMES[id];
  if (domainOf(id) === "light" && card.type === "custom:bubble-card") card.styles = ((card.styles || "") + " " + LIGHT_ON_STYLES).trim();
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

function roomTile(room, hass, span, openings = [], securityPath = null, floorClimate = null) {
  const hash = "#" + slug(room.name);
  const nav = { action: "navigate", navigation_path: hash };
  const subs = [];
  if (openings.length) {
    // Door/window status: each open sensor shows its own (open) icon; when everything is shut, one closed icon.
    const toSec = { action: "navigate", navigation_path: hash + "-doors" };
    for (const id of openings)
      subs.push({ entity: id, show_icon: true, show_state: false, show_background: false, tap_action: toSec, visibility: [{ condition: "state", entity: id, state: "on" }] });
    subs.push({
      entity: openings[0],
      icon: "mdi:door-closed-lock",
      show_icon: true,
      show_state: false,
      show_background: false,
      tap_action: toSec,
      visibility: openings.map((id) => ({ condition: "state", entity: id, state_not: "on" })),
    });
  }
  const firstLight = room.entities.find((id) => /^(light|switch|fan)\./.test(id));
  const { tvs, audio } = roomMediaSplit(room, hass);
  const media = audio[0];
  const tv = tvs[0];
  const climate =
    floorClimate === "none" ? null : room.entities.find((id) => domainOf(id) === "climate") || (floorClimate && hass.states[floorClimate] ? floorClimate : null);
  let lightIdx = 0, mediaIdx = 0;
  if (firstLight) {
    subs.push({ entity: firstLight, icon: "mdi:lightbulb-group", show_state: false, show_background: false, tap_action: { action: "navigate", navigation_path: hash + "-lights" } });
    lightIdx = subs.length;
  }
  if (media) {
    subs.push({ entity: media, show_icon: true, show_state: false, show_background: false, tap_action: { action: "navigate", navigation_path: hash + "-audio" } });
    mediaIdx = subs.length;
  }
  let tvIdx = 0;
  if (tv) {
    subs.push({ entity: tv, icon: "mdi:television", show_icon: true, show_state: false, show_background: false, tap_action: { action: "navigate", navigation_path: hash + "-tv" } });
    tvIdx = subs.length;
  }
  let climateIdx = 0;
  if (climate) {
    subs.push({ entity: climate, show_attribute: true, attribute: "current_temperature", show_icon: false, show_background: false, tap_action: { action: "navigate", navigation_path: thermostatHash(climate) } });
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
  let styles = "";
  // Open door/window icons (sub-buttons 1..N, only visible while open) use the accent colour (yellow-orange on the default theme).
  for (let i = 1; i <= openings.length; i++)
    styles += `.bubble-sub-button-${i} .bubble-sub-button-icon, .bubble-sub-button-${i} ha-icon, .bubble-sub-button-${i} ha-state-icon { color: var(--accent-color) !important; } `;
  // Light / audio / TV icons turn the accent colour while any light in the room is on / any speaker is playing / any TV is on.
  const live = (idx, ids, states) =>
    `.bubble-sub-button-${idx} .bubble-sub-button-icon, .bubble-sub-button-${idx} ha-icon, .bubble-sub-button-${idx} ha-state-icon { color: \${` +
    JSON.stringify(ids) + ".some((e) => hass.states[e] && " + JSON.stringify(states) + ".includes(hass.states[e].state))" +
    ` ? 'var(--accent-color)' : 'var(--primary-text-color)'} !important; } `;
  if (lightIdx) {
    const roomLights = room.entities.filter((id) => domainOf(id) === "light");
    styles += live(lightIdx, roomLights.length ? roomLights : [firstLight], ["on"]);
  }
  if (mediaIdx) styles += live(mediaIdx, audio, ["playing"]);
  if (climateIdx) {
    // Temperature text: blue while cooling, orange while heating, normal otherwise.
    const a = "(hass.states['" + climate + "'] && hass.states['" + climate + "'].attributes.hvac_action)";
    styles += `.bubble-sub-button-${climateIdx}, .bubble-sub-button-${climateIdx} * { color: \${${a} === 'cooling' ? 'var(--state-climate-cool-color, #2b9af9)' : ${a} === 'heating' ? 'var(--state-climate-heat-color, #ff8100)' : 'var(--primary-text-color)'} !important; } `;
  }
  if (tvIdx) styles += live(tvIdx, tvs, ["on", "playing", "paused", "idle", "buffering"]);
  // Layout: temperature pinned to the top-right corner; all other icons in one row along the bottom,
  // starting at the bottom-right and running left, with the lights icon furthest right.
  if (subs.length) {
    styles +=
      ".bubble-sub-button-container { position: absolute !important; inset: 0 !important; display: grid !important; grid-template-columns: none !important;" +
      " grid-template-rows: none !important; grid-template-areas: none !important; grid-auto-flow: column !important; grid-auto-columns: max-content !important;" +
      " direction: rtl; align-content: end !important; justify-content: start !important; align-items: end !important; gap: 4px !important;" +
      " padding: 0 12px 10px 12px !important; margin: 0 !important; width: auto !important; height: auto !important; pointer-events: none; }" +
      " .bubble-sub-button { pointer-events: auto; direction: ltr; grid-row: 1 !important; grid-column: auto !important; } ";
    if (lightIdx) styles += `.bubble-sub-button-${lightIdx} { order: -1; } `;
    if (climateIdx)
      styles += `.bubble-sub-button.bubble-sub-button-${climateIdx} { grid-row: auto !important; grid-column: auto !important; position: absolute !important; top: 10px !important; right: 12px !important; bottom: auto !important; left: auto !important; } `;
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
  return lights.length ? lights : room.entities.filter((id) => /^(switch|fan)\./.test(id));
}

// Pop-up with only one room's lights, opened from the lights icon on that room's tile.
function roomLightsPopup(room, hass) {
  const ids = roomLights(room);
  const cards = [];
  if (ids.length > 1) {
    const bulk = liveBulk(ids, ["on"], "homeassistant.turn_off", { confirm: false });
    cards.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "All Off",
      icon: "mdi:lightbulb-group-off-outline",
      grid_options: { columns: "full" },
      styles: bulk.hook,
      ...bulk.actions,
    });
  }
  for (const id of ids) {
    const card = entityCard(hass, id, { half: "full" });
    const label = NAMES[id] || (hass.states[id] && hass.states[id].attributes.friendly_name) || id;
    if (card.type === "custom:bubble-card" && !NAMES[id] && label.toLowerCase().startsWith(room.name.toLowerCase() + " "))
      card.name = label.slice(room.name.length + 1);
    cards.push(card);
  }
  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    hash: "#" + slug(room.name) + "-lights",
    name: room.name + " Lights",
    icon: "mdi:lightbulb-group",
    bg_opacity: "85",
    bg_blur: "14",
    close_by_clicking_outside: true,
    cards,
  };
}

// A room's media players split into TVs and audio players.
function roomMediaSplit(room, hass) {
  const isTv = (id) => hass.states[id] && (hass.states[id].attributes.device_class === "tv" || /\btv\b|television/i.test(id + " " + (hass.states[id].attributes.friendly_name || "")));
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
function audioCards(room, hass, id, multi = false) {
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
        styles:
          ".bubble-button-background { background-color: ${hass.states['" + id + "'] && hass.states['" + id + "'].attributes.source === 'TV' ? 'var(--accent-color)' : ''} !important;" +
          " opacity: ${hass.states['" + id + "'] && hass.states['" + id + "'].attributes.source === 'TV' ? '0.5' : ''} !important; }" +
          " .bubble-icon { color: ${hass.states['" + id + "'] && hass.states['" + id + "'].attributes.source === 'TV' ? 'var(--accent-color)' : ''} !important; }",
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
function intercomStatusSub(ic) {
  return { entity: ic.status_sensor, show_state: true, show_icon: true, show_background: false, tap_action: { action: "more-info" } };
}
function intercomStatusStyles(ic, idx) {
  const open = "hass.states['" + ic.status_sensor + "'] && hass.states['" + ic.status_sensor + "'].state === 'on'";
  return (
    `.bubble-sub-button-${idx} { color: \${${open} ? 'var(--accent-color)' : 'var(--primary-text-color)'} !important; }` +
    ` .bubble-sub-button-${idx} ha-icon, .bubble-sub-button-${idx} ha-state-icon { color: \${${open} ? 'var(--accent-color)' : 'var(--primary-text-color)'} !important; }`
  );
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
        styles:
          ".bubble-button-background { background-color: var(--accent-color) !important; opacity: 0.5 !important; }" +
          " .bubble-icon { color: var(--accent-color) !important; }",
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
    popup.sub_button = [intercomStatusSub(ic)];
    popup.styles = intercomStatusStyles(ic, 1);
  }
  if (ic.ring_entity) Object.assign(popup, { trigger_entity: ic.ring_entity, trigger_state: "on", trigger_close: true });
  return popup;
}

function roomPopup(room, hass) {
  const switchable = room.entities.filter((id) => /^(light|switch|fan)\./.test(id));
  const cards = [];
  if (switchable.length > 1)
    cards.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "All Off",
      icon: "mdi:power",
      grid_options: { columns: "full" },
      ...action({ action: "perform-action", perform_action: "homeassistant.turn_off", target: { entity_id: switchable } }),
    });
  const { audio } = roomMediaSplit(room, hass);
  for (const id of room.entities) {
    if (audio.includes(id)) cards.push(...audioCards(room, hass, id, audio.length > 1));
    else cards.push(entityCard(hass, id));
  }
  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    hash: "#" + slug(room.name),
    name: room.name,
    icon: room.icon,
    bg_opacity: "85",
    bg_blur: "14",
    close_by_clicking_outside: true,
    cards,
  };
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
    "${(card.__pvH = hass, card.__pv || (card.__pv = 1, card.addEventListener('click', function (ev) {" +
    " if (ev.composedPath().some(function (n) { return n.classList && n.classList.contains('bubble-sub-button'); })) return;" +
    " var h = card.__pvH; var ids = " + JSON.stringify(ids) + ".filter(function (e) { return h.states[e] && " + JSON.stringify(states) + ".includes(h.states[e].state); });" +
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
function lightsOnPopup(ctx) {
  const lightsBulk = liveBulk(ctx.lights, ["on"], "light.turn_off", { verb: "Turn off", one: "light", many: "lights" });
  const cards = [
    {
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "Turn all off",
      icon: "mdi:lightbulb-group-off-outline",
      grid_options: { columns: "full" },
      styles: lightsBulk.hook,
      ...lightsBulk.actions,
    },
  ];
  for (const room of ctx.rooms)
    for (const id of room.entities.filter((e) => domainOf(e) === "light")) {
      const label = NAMES[id] || (ctx.hass.states[id] && ctx.hass.states[id].attributes.friendly_name) || id;
      const card = entityCard(ctx.hass, id, { half: "full" });
      card.name = label.toLowerCase().includes(room.name.toLowerCase()) ? label : `${room.name} · ${label}`;
      cards.push({ type: "conditional", conditions: [{ condition: "state", entity: id, state: "on" }], card, grid_options: { columns: "full" } });
    }
  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    hash: "#lights-on",
    name: "Lights On",
    icon: "mdi:lightbulb-on-outline",
    bg_opacity: "85",
    bg_blur: "14",
    close_by_clicking_outside: true,
    cards,
  };
}

const UNLOCKED_STATES = ["unlocked", "open", "opening", "unlocking", "jammed"];

// JS expression (evaluated by Bubble Card in styles) counting locks that are not locked.
function unlockedExpr(locks) {
  return "(" + JSON.stringify(locks) + ".filter((e) => hass.states[e] && " + JSON.stringify(UNLOCKED_STATES) + ".includes(hass.states[e].state)).length)";
}

// Pop-up listing only the unlocked doors, each with its room, to lock one at a time.
function unlockedPopup(ctx, locks) {
  const locksBulk = liveBulk(locks, UNLOCKED_STATES, "lock.lock", { verb: "Lock", one: "door", many: "doors" });
  const cards = [
    {
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "Lock all",
      icon: "mdi:lock",
      grid_options: { columns: "full" },
      styles: locksBulk.hook,
      ...locksBulk.actions,
    },
  ];
  for (const room of ctx.rooms)
    for (const id of room.entities.filter((e) => locks.includes(e))) {
      const label = NAMES[id] || (ctx.hass.states[id] && ctx.hass.states[id].attributes.friendly_name) || id;
      const card = {
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "switch",
        entity: id,
        name: label.toLowerCase().includes(room.name.toLowerCase()) ? label : `${room.name} · ${label}`,
        show_state: true,
        use_accent_color: true,
        grid_options: { columns: "full" },
        // Only unlocked doors are listed, so a tap locks it (toggle isn't supported for locks).
        ...action({ action: "perform-action", perform_action: "lock.lock", target: { entity_id: id } }),
      };
      cards.push({ type: "conditional", conditions: [{ condition: "state", entity: id, state: UNLOCKED_STATES }], card, grid_options: { columns: "full" } });
    }
  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    hash: "#doors-unlocked",
    name: "Unlocked Doors",
    icon: "mdi:lock-open-variant-outline",
    bg_opacity: "85",
    bg_blur: "14",
    close_by_clicking_outside: true,
    cards,
  };
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
  const cornerAlarms = (cfg.pages.includes("security") ? ctx.alarms : []).map((id, i) => ({
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
    sub_button: [{ icon: "mdi:chevron-right", show_background: false, tap_action: { action: "navigate", navigation_path: hash } }],
    styles:
      ".bubble-sub-button-1 { display: flex !important; flex-direction: row !important; width: auto !important; padding: 0 8px 0 12px; }" +
      " .bubble-sub-button-1::before { content: \"${" + statusExpr + "}\"; font-size: 13px; font-weight: 600; margin-right: 2px; }",
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
  const climateZones = (cfg.climate_zones && cfg.climate_zones.length ? cfg.climate_zones : []).filter((id) => ctx.hass.states[id]);
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
        climateZones.map((id) => ({
          type: "thermostat",
          entity: id,
          ...(NAMES[id] ? { name: NAMES[id] } : {}),
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
      ...(ic.status_sensor ? { sub_button: [{ ...intercomStatusSub(ic), tap_action: { action: "navigate", navigation_path: intercomHash(ic) } }], styles: intercomStatusStyles(ic, 1) } : {}),
      ...action({ action: "navigate", navigation_path: intercomHash(ic) }),
    });
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
      const openings = openingsOf(r);
      return roomTile(r, ctx.hass, SPAN, openings, cfg.pages.includes("security") ? `${ctx.basePath}/security` : null, (cfg.room_thermostats || {})[r.id] ?? (cfg.floor_thermostats || {})[r.floor]);
    })],
  });
  sections.push({ type: "grid", cards: [...ctx.rooms.map((r) => roomPopup(r, ctx.hass)), ...ctx.rooms.filter((r) => roomLights(r).length).map((r) => roomLightsPopup(r, ctx.hass)),
    ...ctx.rooms.filter((r) => openingsOf(r).length).map((r) => roomDoorsPopup(r, ctx.hass, openingsOf(r))),
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
    cards: [{ type: "heading", heading: room.name, heading_style: "title", icon: room.icon }, ...players.map((id) => entityCard(ctx.hass, id))],
  }));
  sections.push({ type: "grid", column_span: 3, cards: [nav] });
  return { title: "Media", path: "media", type: "sections", max_columns: 3, background: cfg.background, sections };
}

/* ------------------------------------------------------------------ */

if (!customElements.get("ll-strategy-dashboard-pivit-home")) {
  customElements.define("ll-strategy-dashboard-pivit-home", PivitHomeStrategy);
  console.info(`%c PivIT Home %c v${VERSION} `, "background:#1f6feb;color:#fff;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
}
