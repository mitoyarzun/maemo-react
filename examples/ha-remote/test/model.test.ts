import { describe, expect, test } from 'vitest';
import {
  FAVORITES, OTHER, applyStates, areaOf, domainOf, emptyRegistries, makeRow, onOf, pageKeysOf, pageName, parseAreas, parseDevices, parseDisplay,
  placeAgain, sortRows, stateText, type Registries,
} from '../src/ha/model.js';
import type { Entity, Row, StatesEvent } from '../src/ha/types.js';
import registries from './fixtures/registries.json';
import states from './fixtures/states.json';

function reg(): Registries {
  const { display, hidden } = parseDisplay(registries.display);
  return { areas: parseAreas(registries.areas), deviceArea: parseDevices(registries.devices), display, hidden };
}

function loaded() {
  return applyStates(new Map(), states as StatesEvent, reg()).entities;
}

describe('registries', () => {
  test('areas keep the registry order', () => {
    expect(parseAreas(registries.areas).map((a) => a.name)).toEqual(['Living room', 'Kitchen', 'Garage']);
    expect(parseAreas('nope')).toEqual([]);
  });

  test('devices map to areas; hidden entities and entity categories are dropped', () => {
    const r = reg();
    expect(r.deviceArea.get('dev1')).toBe('kitchen');
    expect(r.deviceArea.get('dev2')).toBeNull();
    expect(r.display.has('light.hidden')).toBe(false);
    expect(r.hidden.has('light.hidden')).toBe(true);
    expect(r.display.has('switch.child_lock')).toBe(false);
    expect(r.display.get('light.desk')).toEqual({ areaId: 'living_room', deviceId: null, name: 'Desk lamp' });
  });

  test('the area of an entity is its own, else the area of its device', () => {
    const r = reg();
    expect(areaOf('light.ceiling', r)).toBe('living_room');
    expect(areaOf('switch.fan', r)).toBe('kitchen');
    expect(areaOf('input_boolean.guest', r)).toBeNull();
  });

  test('hb hides an entity; hn (has entity name) does not', () => {
    const r = reg();
    expect(r.hidden.has('light.hidden')).toBe(true);
    expect(r.hidden.has('light.ceiling')).toBe(false);
    expect(r.display.has('light.ceiling')).toBe(true);
    expect(loaded().has('light.ceiling')).toBe(true);
  });

  test('domainOf keeps the six domains', () => {
    expect([domainOf('light.x'), domainOf('cover.x'), domainOf('sensor.x'), domainOf('nodot'), domainOf('lightx')]).toEqual(['light', 'cover', null, null, null]);
  });
});

describe('states', () => {
  test('the first event makes entities with names, areas and domains; others are dropped', () => {
    const e = loaded();
    expect([...e.keys()].sort()).toEqual(['climate.thermostat', 'cover.blinds', 'input_boolean.guest', 'light.ceiling', 'light.desk', 'switch.fan']);
    expect(e.get('light.ceiling')).toMatchObject({ domain: 'light', name: 'Ceiling light', areaId: 'living_room', state: 'on' });
    expect(e.get('switch.fan')?.areaId).toBe('kitchen');
    expect(e.get('light.desk')?.name).toBe('Desk');
  });

  test('a state without a registry entry goes to Other; a registry entry without a state is not shown', () => {
    const e = loaded();
    expect(e.get('input_boolean.guest')?.areaId).toBeNull();
    expect(pageKeysOf(e.get('input_boolean.guest')!, new Set())).toEqual([OTHER]);
    expect(e.has('light.no_state')).toBe(false);
  });

  test('a compressed change updates the state and the attributes, and the other entities keep their objects', () => {
    const before = loaded();
    const ev: StatesEvent = { c: { 'light.ceiling': { '+': { s: 'off', a: { brightness: 0 }, lc: 1700000100 } } } };
    const { entities, changed } = applyStates(before, ev, reg());
    expect(changed).toEqual(['light.ceiling']);
    expect(entities.get('light.ceiling')).toMatchObject({ state: 'off', attrs: { brightness: 0, friendly_name: 'Ceiling light' } });
    expect(entities.get('light.desk')).toBe(before.get('light.desk'));
    expect(entities).not.toBe(before);
  });

  test('a change of lu or lc only keeps the entity object and is not listed', () => {
    const before = loaded();
    const ev: StatesEvent = { c: { 'light.ceiling': { '+': { lu: 1700000200, lc: 1700000200, s: 'on', a: { brightness: 128 } } } } };
    const { entities, changed } = applyStates(before, ev, reg());
    expect(changed).toEqual([]);
    expect(entities.get('light.ceiling')).toBe(before.get('light.ceiling'));
  });

  test('an id in a and in r is listed once', () => {
    const { changed } = applyStates(loaded(), { a: { 'light.desk': { s: 'on', a: {} } }, r: ['light.desk'] }, reg());
    expect(changed).toEqual(['light.desk']);
  });

  test('a minus removes attributes, and r removes entities', () => {
    const before = loaded();
    const { entities, changed } = applyStates(before, { c: { 'light.ceiling': { '-': { a: ['brightness'] } } }, r: ['switch.fan'] }, reg());
    expect(entities.get('light.ceiling')?.attrs).not.toHaveProperty('brightness');
    expect(entities.has('switch.fan')).toBe(false);
    expect(changed).toEqual(['light.ceiling', 'switch.fan']);
  });

  test('a change of an unknown or dropped entity is ignored', () => {
    const before = loaded();
    const ev: StatesEvent = { c: { 'sensor.temp': { '+': { s: '20' } }, 'light.nope': { '+': { s: 'on' } } }, r: ['light.gone'] };
    const { entities, changed } = applyStates(before, ev, reg());
    expect(changed).toEqual([]);
    expect(entities.size).toBe(before.size);
  });

  test('a new friendly_name changes the name', () => {
    const { entities } = applyStates(loaded(), { c: { 'light.desk': { '+': { a: { friendly_name: 'Reading lamp' } } } } }, reg());
    expect(entities.get('light.desk')?.name).toBe('Reading lamp');
  });

  test('placeAgain follows a new registry', () => {
    const r = reg();
    const moved: Registries = { ...r, display: new Map(r.display) };
    moved.display.set('light.desk', { areaId: 'kitchen', deviceId: null, name: null });
    const e = placeAgain(loaded(), moved);
    expect(e.get('light.desk')?.areaId).toBe('kitchen');
    expect(e.get('light.ceiling')?.areaId).toBe('living_room');
  });
});

describe('rows', () => {
  test('stateText for each domain', () => {
    expect(stateText('light', 'on', { brightness: 128 })).toBe('On 50 %');
    expect(stateText('light', 'on', {})).toBe('On');
    expect(stateText('light', 'off', { brightness: 128 })).toBe('Off');
    expect(stateText('switch', 'on', {})).toBe('On');
    expect(stateText('climate', 'heat', { temperature: 21 })).toBe('21.0 °C Heat');
    expect(stateText('climate', 'off', {})).toBe('Off');
    expect(stateText('cover', 'open', { current_position: 40 })).toBe('Open 40 %');
    expect(stateText('cover', 'closed', { current_position: 0 })).toBe('Closed');
    expect(stateText('cover', 'opening', {})).toBe('Opening');
    expect(stateText('fan', 'unavailable', {})).toBe('Unavailable');
  });

  test('onOf gives a toggle for on/off domains only', () => {
    expect([onOf('light', 'on'), onOf('switch', 'off'), onOf('light', 'unavailable'), onOf('climate', 'heat'), onOf('cover', 'open')]).toEqual([true, false, null, null, null]);
  });

  test('makeRow keeps the row object when nothing changed', () => {
    const e = loaded().get('light.ceiling')!;
    const row = makeRow(e, true, false, null);
    expect(row).toEqual({ key: 'light.ceiling', name: 'Ceiling light', state: 'On 50 %', on: true });
    expect(makeRow(e, true, false, row)).toBe(row);
    expect(makeRow(e, true, true, row)).toMatchObject({ state: 'On 50 % ...' });
    expect(makeRow(e, false, false, row)).toMatchObject({ on: null });
    const changed: Entity = { ...e, state: 'off' };
    expect(makeRow(changed, true, false, row)).not.toBe(row);
  });
});

describe('pages', () => {
  test('pageKeysOf puts a favorite on Favorites and on its area', () => {
    const e = loaded();
    expect(pageKeysOf(e.get('light.ceiling')!, new Set(['light.ceiling']))).toEqual([FAVORITES, 'living_room']);
    expect(pageKeysOf(e.get('light.ceiling')!, new Set())).toEqual(['living_room']);
  });

  test('pageName', () => {
    const areas = parseAreas(registries.areas);
    expect([pageName(FAVORITES, areas), pageName('kitchen', areas), pageName(OTHER, areas), pageName('nope', areas)]).toEqual(['Favorites', 'Kitchen', 'Other', 'nope']);
  });

  test('sortRows sorts by name, or by the favorites order', () => {
    const rows: Row[] = [
      { key: 'b', name: 'Beta', state: '', on: null },
      { key: 'a', name: 'alpha', state: '', on: null },
      { key: 'c', name: 'Gamma', state: '', on: null },
    ];
    expect(sortRows(rows).map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, ['c', 'a', 'b']).map((r) => r.key)).toEqual(['c', 'a', 'b']);
    expect(emptyRegistries().areas).toEqual([]);
  });
});
