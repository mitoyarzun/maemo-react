// The rows of the example, outside React. The UI reads them with
// useSyncExternalStore, as HA Remote reads its store.
import type { ListRow } from '@maemo-react/widgets';

export interface Entity extends ListRow {
  name: string;
  state: string;
  /** true or false for a light or a switch; null for a device with no toggle. */
  on: boolean | null;
  brightness: number;
  mode: number;
}

const MODES = ['heat', 'cool', 'off'];

function makeEntities(): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < 30; i++) {
    const light = i % 3 !== 2;
    out.push({
      key: 'entity.' + i,
      name: (light ? 'Light ' : 'Thermostat ') + i,
      state: light ? 'off' : '21.0 °C ' + MODES[i % 3],
      on: light ? false : null,
      brightness: 50,
      mode: i % 3,
    });
  }
  return out;
}

let entities = makeEntities();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export const store = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: () => entities,
  modes: MODES,
  update(key: string, patch: Partial<Entity>) {
    entities = entities.map((e) => (e.key === key ? { ...e, ...patch } : e));
    notify();
  },
  toggle(key: string, on: boolean) {
    store.update(key, { on, state: on ? 'on' : 'off' });
  },
  remove(key: string) {
    entities = entities.filter((e) => e.key !== key);
    notify();
  },
  add() {
    const i = entities.length;
    entities = [...entities, { key: 'entity.new.' + Date.now(), name: 'Light ' + i, state: 'off', on: false, brightness: 50, mode: 0 }];
    notify();
  },
};
