import { useEffect, useState, useSyncExternalStore } from 'react';
import { args, quit } from 'maemo:app';
import { banner } from '@maemo-react/core';
import {
  Box, Button, CheckButton, ComboBox, Label, List, Menu, MenuItem, MenuSeparator, Scale, ToggleButton, Window, type ListColumn,
} from '@maemo-react/widgets';
import { store, type Entity } from './store.js';

const SMOKE = args.includes('--smoke');
const STAY = args.includes('--stay');

const COLUMNS: ListColumn[] = [
  { field: 'name', expand: true },
  { field: 'state' },
  { field: 'on', kind: 'toggle' },
];

function Detail({ entity, favorite, onFavorite }: { entity: Entity; favorite: boolean; onFavorite: (on: boolean) => void }) {
  return (
    <Box vertical spacing={6}>
      <Label>{entity.name}</Label>
      {entity.on === null ? (
        <Box vertical spacing={4}>
          <Label>Mode</Label>
          <ComboBox items={store.modes} active={entity.mode} onChangeActive={(i) => store.update(entity.key, { mode: i, state: '21.0 °C ' + store.modes[i] })} />
        </Box>
      ) : (
        <Box vertical spacing={4}>
          <Label>{'Brightness ' + entity.brightness + ' %'}</Label>
          <Scale min={0} max={100} value={entity.brightness} onChangeValue={(v) => store.update(entity.key, { brightness: v })} />
        </Box>
      )}
      <ToggleButton active={favorite} onToggle={onFavorite}>
        Favorite
      </ToggleButton>
      <CheckButton active={favorite} onToggle={onFavorite}>
        Show on the first page
      </CheckButton>
      <Button onClick={() => store.remove(entity.key)}>Remove</Button>
    </Box>
  );
}

export function App() {
  const entities = useSyncExternalStore(store.subscribe, store.get);
  const [selected, setSelected] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const entity = selected === null ? null : (entities.find((e) => e.key === selected) ?? null);

  useEffect(() => {
    if (!SMOKE) return;
    console.log('WIDGETS-SMOKE ok ' + entities.length + ' rows');
    if (!STAY) setTimeout(() => quit(0), 2000);
  }, []);

  const setFavorite = (on: boolean) => {
    if (entity === null) return;
    const next = new Set(favorites);
    if (on) next.add(entity.key);
    else next.delete(entity.key);
    setFavorites(next);
  };

  return (
    <Window title="React Widgets">
      <Menu>
        <MenuItem onActivate={() => store.add()}>Add a light</MenuItem>
        <MenuItem onActivate={() => banner('Reconnecting...')}>Reconnect</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={() => quit(0)}>Quit</MenuItem>
      </Menu>
      <Box spacing={8}>
        <List
          data={entities}
          columns={COLUMNS}
          selected={selected}
          expand
          onSelect={(key) => setSelected(key)}
          onToggle={(key, _field, on) => store.toggle(key, on)}
        />
        <Box vertical spacing={6} widthRequest={240}>
          {entity ? <Detail entity={entity} favorite={favorites.has(entity.key)} onFavorite={setFavorite} /> : <Label>Select an entity</Label>}
          <Label>{entities.length + ' entities, ' + favorites.size + ' favorites'}</Label>
        </Box>
      </Box>
    </Window>
  );
}
