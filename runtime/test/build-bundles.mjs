// Bundle the runtime tests that import npm packages (React). The output goes
// to runtime/test/generated/, and runtime/test/run.sh runs it there.
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, 'bundles');
for (const f of readdirSync(dir).filter((name) => /\.(jsx|tsx|js|ts)$/.test(name))) {
  await build({
    entryPoints: [join(dir, f)],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    external: ['maemo:*'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: join(here, 'generated', basename(f).replace(/\.(jsx|tsx|js|ts)$/, '.test.js')),
    logLevel: 'warning',
  });
}
