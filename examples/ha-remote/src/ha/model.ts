// Registries and states to entities, rows and pages. Pure functions: no
// React, no GTK, no network. An entity object and a row object change only
// when the entity changes, so the List updates only the changed rows.
import { DOMAINS, type Area, type CompressedState, type Domain, type Entity, type Row, type StatesEvent } from './types.js';

export interface DisplayEntry {
  areaId: string | null;
  deviceId: string | null;
  /** The name in the registry, when the user set one. */
  name: string | null;
}

/** The registries that place an entity on a page and name it. */
export interface Registries {
  areas: Area[];
  /** device id -> area id */
  deviceArea: Map<string, string | null>;
  /** entity id -> its entry. Hidden entities and entity categories are left out. */
  display: Map<string, DisplayEntry>;
  /** The hidden entities and the entities with an entity category: never shown, also when a state arrives. */
  hidden: Set<string>;
}

export const FAVORITES = 'favorites';
export const OTHER = 'other';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function emptyRegistries(): Registries {
  return { areas: [], deviceArea: new Map(), display: new Map(), hidden: new Set() };
}

/** config/area_registry/list -> the areas, in registry order. */
export function parseAreas(result: unknown): Area[] {
  const out: Area[] = [];
  if (!Array.isArray(result)) return out;
  for (const a of result) {
    if (!isObject(a)) continue;
    const id = str(a.area_id);
    if (id !== null) out.push({ id, name: str(a.name) ?? id });
  }
  return out;
}

/** config/device_registry/list -> device id -> area id. */
export function parseDevices(result: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!Array.isArray(result)) return out;
  for (const d of result) {
    if (!isObject(d)) continue;
    const id = str(d.id);
    if (id !== null) out.set(id, str(d.area_id));
  }
  return out;
}

/**
 * config/entity_registry/list_for_display -> the entries. The compact keys:
 * ei entity id, ai area id, di device id, en name, hb hidden, hn has entity name, ec entity
 * category. Disabled entities are not in the result at all.
 */
export function parseDisplay(result: unknown): { display: Map<string, DisplayEntry>; hidden: Set<string> } {
  const display = new Map<string, DisplayEntry>();
  const hidden = new Set<string>();
  const list = isObject(result) && Array.isArray(result.entities) ? result.entities : [];
  for (const e of list) {
    if (!isObject(e)) continue;
    const id = str(e.ei);
    if (id === null) continue;
    if (e.hb === true || e.ec !== undefined) {
      hidden.add(id); // hidden, config and diagnostic entities: never shown, also when a state arrives
      continue;
    }
    display.set(id, { areaId: str(e.ai), deviceId: str(e.di), name: str(e.en) });
  }
  return { display, hidden };
}

export function domainOf(id: string): Domain | null {
  const dot = id.indexOf('.');
  if (dot < 0) return null;
  const d = id.slice(0, dot);
  return (DOMAINS as readonly string[]).includes(d) ? (d as Domain) : null;
}

/** The area of an entity: its own, else the area of its device (HA spec section 4). */
export function areaOf(id: string, reg: Registries): string | null {
  const e = reg.display.get(id);
  if (!e) return null;
  if (e.areaId !== null) return e.areaId;
  return e.deviceId !== null ? (reg.deviceArea.get(e.deviceId) ?? null) : null;
}

export function nameOf(id: string, attrs: Record<string, unknown>, entry: DisplayEntry | undefined): string {
  return str(attrs.friendly_name) ?? entry?.name ?? id;
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

/** The state column of a row. */
export function stateText(domain: Domain, state: string, attrs: Record<string, unknown>): string {
  if (state === 'unavailable' || state === 'unknown') return cap(state);
  switch (domain) {
    case 'light': {
      const b = attrs.brightness;
      return state === 'on' && typeof b === 'number' ? 'On ' + Math.round((b / 255) * 100) + ' %' : cap(state);
    }
    case 'climate': {
      const t = attrs.temperature;
      return (typeof t === 'number' ? t.toFixed(1) + ' °C ' : '') + cap(state);
    }
    case 'cover': {
      const p = attrs.current_position;
      return typeof p === 'number' && state !== 'closed' ? cap(state) + ' ' + p + ' %' : cap(state);
    }
    default:
      return cap(state);
  }
}

/** The toggle column: true or false for an on/off entity, null for the others. */
export function onOf(domain: Domain, state: string): boolean | null {
  if (domain === 'climate' || domain === 'cover') return null;
  return state === 'on' ? true : state === 'off' ? false : null;
}

/**
 * The row of an entity. live: the connection is up, so the toggles show.
 * pending: a service call waits for the new state. Returns prev when
 * nothing in the row changed, so the List keeps the row.
 */
export function makeRow(e: Entity, live: boolean, pending: boolean, prev: Row | null): Row {
  const state = stateText(e.domain, e.state, e.attrs) + (pending ? ' ...' : '');
  const on = live ? onOf(e.domain, e.state) : null;
  if (prev && prev.name === e.name && prev.state === state && prev.on === on) return prev;
  return { key: e.id, name: e.name, state, on };
}

function sameAttrs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

function fromCompressed(id: string, domain: Domain, s: CompressedState, reg: Registries): Entity {
  const attrs = isObject(s.a) ? s.a : {};
  return { id, domain, name: nameOf(id, attrs, reg.display.get(id)), areaId: areaOf(id, reg), state: String(s.s), attrs };
}

/**
 * Apply one subscribe_entities event. The result is a new Map; the entities
 * that did not change keep their objects. changed lists the ids that got a
 * new object or went away.
 */
export function applyStates(entities: Map<string, Entity>, ev: StatesEvent, reg: Registries): { entities: Map<string, Entity>; changed: string[] } {
  const next = new Map(entities);
  const changed: string[] = [];
  if (isObject(ev.a)) {
    for (const [id, s] of Object.entries(ev.a)) {
      const domain = domainOf(id);
      if (domain === null || reg.hidden.has(id) || !isObject(s)) continue;
      next.set(id, fromCompressed(id, domain, s as CompressedState, reg));
      if (!changed.includes(id)) changed.push(id);
    }
  }
  if (isObject(ev.c)) {
    for (const [id, diff] of Object.entries(ev.c)) {
      const old = next.get(id);
      if (!old || !isObject(diff)) continue; // a dropped entity, or one that never arrived
      const plus = isObject(diff['+']) ? diff['+'] : {};
      const minus = isObject(diff['-']) ? diff['-'] : {};
      let attrs = old.attrs;
      if (isObject(plus.a) || Array.isArray(minus.a)) {
        attrs = { ...old.attrs, ...(isObject(plus.a) ? plus.a : {}) };
        if (Array.isArray(minus.a)) for (const k of minus.a) delete attrs[String(k)];
      }
      const state = typeof plus.s === 'string' ? plus.s : old.state;
      const name = nameOf(id, attrs, reg.display.get(id));
      if (state === old.state && name === old.name && sameAttrs(attrs, old.attrs)) continue; // only lu or lc changed
      next.set(id, { ...old, state, attrs, name });
      if (!changed.includes(id)) changed.push(id);
    }
  }
  if (Array.isArray(ev.r)) {
    for (const id of ev.r) if (next.delete(String(id)) && !changed.includes(String(id))) changed.push(String(id));
  }
  return { entities: next, changed };
}

/** Place and name every entity again after the registries changed. */
export function placeAgain(entities: Map<string, Entity>, reg: Registries): Map<string, Entity> {
  const next = new Map<string, Entity>();
  for (const [id, e] of entities) {
    if (reg.hidden.has(id)) continue;
    const areaId = areaOf(id, reg);
    const name = nameOf(id, e.attrs, reg.display.get(id));
    next.set(id, areaId === e.areaId && name === e.name ? e : { ...e, areaId, name });
  }
  return next;
}

/** The pages that show an entity: Favorites when it is one, then its area or Other. */
export function pageKeysOf(e: Entity, favorites: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (favorites.has(e.id)) out.push(FAVORITES);
  out.push(e.areaId ?? OTHER);
  return out;
}

export function pageName(key: string, areas: readonly Area[]): string {
  if (key === FAVORITES) return 'Favorites';
  if (key === OTHER) return 'Other';
  return areas.find((a) => a.id === key)?.name ?? key;
}

/** Rows by name, or in the order of the favorites list when it is given. */
export function sortRows(rows: readonly Row[], favoritesOrder?: readonly string[]): Row[] {
  const out = rows.slice();
  if (favoritesOrder) {
    const at = new Map(favoritesOrder.map((id, i) => [id, i]));
    out.sort((a, b) => (at.get(a.key) ?? 1e9) - (at.get(b.key) ?? 1e9));
    return out;
  }
  // No localeCompare with a locale: QuickJS has no Intl.
  const keyed = out.map((row) => ({ row, key: row.name.toLowerCase() }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((k) => k.row);
}
