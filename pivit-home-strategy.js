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

const VERSION = "1.0.24";

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
  floor_thermostats: {}, // { <floor_id>: climate.x } — rooms on that floor without their own thermostat show its temperature
  room_thermostats: {}, // { <area_id>: climate.x | "none" } — per-room override of the temperature shown ("none" hides it)
  room_openings: ["door", "garage_door", "window", "opening"], // sensor types summarised on each room tile ([] to turn off)
  extra_views: [], // full Lovelace view configs, appended after the built-in pages
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
    const toSec = securityPath ? { action: "navigate", navigation_path: securityPath } : nav;
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
  const isTv = (id) => hass.states[id] && (hass.states[id].attributes.device_class === "tv" || /\btv\b|television/i.test(id + " " + (hass.states[id].attributes.friendly_name || "")));
  const roomMedia = room.entities.filter((id) => domainOf(id) === "media_player");
  const tvs = roomMedia.filter(isTv);
  const audio = roomMedia.filter((id) => !isTv(id));
  const media = audio[0];
  const tv = tvs[0];
  const climate =
    floorClimate === "none" ? null : room.entities.find((id) => domainOf(id) === "climate") || (floorClimate && hass.states[floorClimate] ? floorClimate : null);
  let lightIdx = 0, mediaIdx = 0;
  if (firstLight) {
    subs.push({ entity: firstLight, icon: "mdi:lightbulb-group", show_state: false, show_background: false, tap_action: nav });
    lightIdx = subs.length;
  }
  if (media) {
    subs.push({ entity: media, show_icon: true, show_state: false, show_background: false, tap_action: nav });
    mediaIdx = subs.length;
  }
  let tvIdx = 0;
  if (tv) {
    subs.push({ entity: tv, icon: "mdi:television", show_icon: true, show_state: false, show_background: false, tap_action: nav });
    tvIdx = subs.length;
  }
  let climateIdx = 0;
  if (climate) {
    subs.push({ entity: climate, show_attribute: true, attribute: "current_temperature", show_icon: false, show_background: false, tap_action: nav });
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
  for (const id of room.entities) cards.push(entityCard(hass, id));
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

  const quick = [];
  if (cfg.all_lights_off && ctx.lights.length) {
    const bulk = liveBulk(ctx.lights, ["on"], "light.turn_off", { confirm: cfg.all_lights_confirm, verb: "Turn off", one: "light", many: "lights" });
    quick.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "All Lights Off",
      icon: "mdi:lightbulb-group-off-outline",
      card_layout: "large",
      grid_options: { columns: 3 * SPAN },
      // Live "N on ›" count, right-aligned; it is a sub-button that opens the #lights-on pop-up.
      sub_button: [{ icon: "mdi:chevron-right", show_background: false, tap_action: { action: "navigate", navigation_path: "#lights-on" } }],
      styles:
        ".bubble-sub-button-1 { display: ${" + lightsOnExpr(ctx.lights) + " ? 'flex' : 'none'} !important; flex-direction: row !important; width: auto !important; padding: 0 8px 0 12px; }" +
        " .bubble-sub-button-1::before { content: \"${" + lightsOnExpr(ctx.lights) + "} on\"; font-size: 13px; font-weight: 600; margin-right: 2px; }" +
        bulk.hook,
      ...bulk.actions,
    });
  }
  const extraPopups = [];
  const locks = Object.keys(ctx.hass.states).filter((id) => domainOf(id) === "lock" && ctx.roomOf[id]);
  const manyLocks = locks.length > cfg.max_quick_locks;
  if (manyLocks) {
    const bulk = liveBulk(locks, UNLOCKED_STATES, "lock.lock", { verb: "Lock", one: "door", many: "doors" });
    quick.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "Lock All Doors",
      icon: "mdi:lock",
      card_layout: "large",
      grid_options: { columns: 3 * SPAN },
      // Live "N unlocked ›" count, right-aligned; it is a sub-button that opens the #doors-unlocked pop-up.
      sub_button: [{ icon: "mdi:chevron-right", show_background: false, tap_action: { action: "navigate", navigation_path: "#doors-unlocked" } }],
      styles:
        ".bubble-sub-button-1 { display: ${" + unlockedExpr(locks) + " ? 'flex' : 'none'} !important; flex-direction: row !important; width: auto !important; padding: 0 8px 0 12px; }" +
        " .bubble-sub-button-1::before { content: \"${" + unlockedExpr(locks) + "} unlocked\"; font-size: 13px; font-weight: 600; margin-right: 2px; }" +
        bulk.hook,
      ...bulk.actions,
    });
    extraPopups.push(unlockedPopup(ctx, locks));
  }
  const autoQuick = [
    ...Object.keys(ctx.hass.states).filter((id) => domainOf(id) === "cover" && /garage/i.test(id + (ctx.hass.states[id].attributes.device_class || ""))),
    ...(cfg.main_thermostat ? [cfg.main_thermostat] : ctx.climates.slice(0, 1)),
    ...(manyLocks ? [] : locks),
  ];
  const quickNames = {};
  const quickIds = cfg.quick_actions.map((q) => {
    if (typeof q === "string") return q;
    if (q.name) quickNames[q.entity] = q.name;
    return q.entity;
  });
  for (const id of [...new Set([...autoQuick, ...quickIds])]) {
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
      ...action(d === "climate" && cfg.pages.includes("climate") ? { action: "navigate", navigation_path: `${ctx.basePath}/climate` } : { action: "more-info" }),
    });
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
    cards: [{ type: "heading", heading: "Rooms", heading_style: "title" }, ...ctx.rooms.map((r) => {
      const sec = ctx.securityByRoom.find((x) => x.id === r.id);
      const openings = sec ? sec.sensors.filter((id) => (cfg.room_openings || []).includes(ctx.hass.states[id].attributes.device_class)) : [];
      return roomTile(r, ctx.hass, SPAN, openings, cfg.pages.includes("security") ? `${ctx.basePath}/security` : null, (cfg.room_thermostats || {})[r.id] ?? (cfg.floor_thermostats || {})[r.floor]);
    })],
  });
  sections.push({ type: "grid", cards: [...ctx.rooms.map((r) => roomPopup(r, ctx.hass)), ...(cfg.all_lights_off && ctx.lights.length ? [lightsOnPopup(ctx)] : []), ...extraPopups, ...cornerAlarms] });
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
