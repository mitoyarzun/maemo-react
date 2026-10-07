import { useEffect, useState } from 'react';
import { args, quit } from 'maemo:app';
import { Box, Button, Label, Window } from '@maemo-react/widgets';

const SOURCE = 'https://api.github.com/repos/mitoyarzun/n810-modern';
const SMOKE = args.includes('--smoke');
const STAY = args.includes('--stay');

interface Repo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; repo: Repo; ms: number };

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return e.message + (e.cause instanceof Error ? ': ' + e.cause.message : '');
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const t0 = performance.now();
    setState({ kind: 'loading' });
    fetch(SOURCE, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json() as Promise<Repo>;
      })
      .then((repo) => {
        if (live) setState({ kind: 'done', repo, ms: performance.now() - t0 });
      })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'error', message: describe(e) });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!SMOKE || state.kind === 'loading') return;
    console.log(state.kind === 'done' ? 'HELLO-SMOKE ok ' + state.repo.full_name : 'HELLO-SMOKE error ' + state.message);
    if (!STAY) setTimeout(() => quit(0), 2000);
  }, [state]);

  return (
    <Window title="React Hello">
      <Box vertical spacing={8}>
        <Label>{'GET ' + SOURCE}</Label>
        {state.kind === 'loading' ? <Label>Loading…</Label> : null}
        {state.kind === 'error' ? <Label wrap>{'Error: ' + state.message}</Label> : null}
        {state.kind === 'done' ? (
          <Box vertical spacing={4}>
            <Label>{state.repo.full_name}</Label>
            <Label wrap>{state.repo.description ?? ''}</Label>
            <Label>{'Stars: ' + state.repo.stargazers_count + ' (in ' + Math.round(state.ms) + ' ms)'}</Label>
          </Box>
        ) : null}
        <Button onClick={() => setAttempt(attempt + 1)}>Reload</Button>
      </Box>
    </Window>
  );
}
