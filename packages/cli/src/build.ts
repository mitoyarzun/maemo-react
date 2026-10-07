// Bundle an application: src/main.tsx -> dist/app.js, an ES module for
// maemo-react-host with React inside and the maemo:* modules outside.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The application and the linked maemo-react packages must share one copy of
 * React. A file: dependency is a link to the checkout, and esbuild follows the
 * link, so the packages would find the React of the checkout. Point every
 * "react" import at the React of the application.
 */
function reactAlias(dir: string): Record<string, string> {
  try {
    return { react: dirname(createRequire(join(dir, 'package.json')).resolve('react/package.json')) };
  } catch {
    return {};
  }
}

export async function buildApp(dir: string): Promise<string> {
  const outfile = join(dir, 'dist', 'app.js');
  await build({
    entryPoints: [join(dir, 'src', 'main.tsx')],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    external: ['maemo:*'],
    alias: reactAlias(dir),
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    outfile,
    logLevel: 'warning',
  });
  return outfile;
}
