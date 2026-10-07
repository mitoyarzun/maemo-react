// maemo-react create: make a new application folder.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconPng, colorFor } from './png.js';
import { templateFiles, type PackageFolders } from './templates.js';

/**
 * Find the packages of the checkout that this tool runs from. The packages are
 * not on npm, and the @maemo-react scope is not ours on npm. Never write a
 * registry range for them: write a file: path to the checkout.
 */
export function checkoutPackages(from: string = dirname(fileURLToPath(import.meta.url))): PackageFolders {
  // This file is packages/cli/src/create.ts, and the bundle is packages/cli/dist/cli.js.
  const root = resolve(from, '..', '..');
  const folders = {} as PackageFolders;
  for (const n of ['core', 'widgets', 'cli', 'types'] as const) {
    folders[n] = join(root, n);
    if (!existsSync(join(folders[n], 'package.json'))) {
      throw new Error('"create" must run from a maemo-react checkout: the packages are not on npm. Missing ' + folders[n]);
    }
  }
  return folders;
}

export function createApp(dir: string, id: string, name: string, pkg: PackageFolders = checkoutPackages()): void {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty`);
  if (!/^[a-z0-9][a-z0-9+.-]+$/.test(id)) throw new Error(`the id must be a Debian package name (a-z, 0-9, + - .), not ${id}`);
  for (const [path, text] of Object.entries(templateFiles(id, name, pkg))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeFileSync(join(dir, 'icon.png'), iconPng(64, colorFor(id)));
}
