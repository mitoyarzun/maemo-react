// Make the .deb of an application from dist/app.js and app.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, HOST, RUNTIME_DEPENDS, readManifest, type AppManifest } from './app.js';
import { buildDeb } from './deb.js';
import { colorFor, iconPng } from './png.js';

export function desktopEntry(m: AppManifest): string {
  return [
    '[Desktop Entry]',
    'Encoding=UTF-8',
    'Version=1.0',
    `Name=${m.name}`,
    `Comment=${m.description ?? m.name}`,
    `Exec=${HOST} ${APPS}/${m.id}/app.js`,
    `Icon=${m.id}`,
    'Terminal=false',
    'Type=Application',
    '',
  ].join('\n');
}

export function postinst(id: string): string {
  return `#!/bin/sh
# postinst for ${id}, made by maemo-react. It is safe to run again.
set -e
# Compile the bytecode here, so it matches the QuickJS of the runtime.
# An install must not fail, but say so when the compile fails.
${HOST} --compile ${APPS}/${id}/app.js || \
	echo "maemo-react: bytecode compile failed for ${APPS}/${id}/app.js; the application starts slower" >&2
[ -x /usr/bin/gtk-update-icon-cache ] && \\
	/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
exit 0
`;
}

export function postrm(id: string): string {
  return `#!/bin/sh
# postrm for ${id}, made by maemo-react.
set -e
if [ "$1" = remove ] || [ "$1" = purge ]; then
	rm -f ${APPS}/${id}/app.qbc
	rmdir ${APPS}/${id} 2>/dev/null || true
fi
[ -x /usr/bin/gtk-update-icon-cache ] && \\
	/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
exit 0
`;
}

/** Make dist/<id>_<version>_all.deb. Returns its path. */
export function packageApp(dir: string): string {
  const m = readManifest(dir);
  const appJs = join(dir, 'dist', 'app.js');
  if (!existsSync(appJs)) throw new Error(`no ${appJs}: run "maemo-react build" first`);
  const icon = m.icon ? readFileSync(join(dir, m.icon)) : iconPng(64, colorFor(m.id));
  const deb = buildDeb({
    control: [
      ['Package', m.id],
      ['Version', m.version],
      ['Architecture', 'all'],
      ['Maintainer', m.maintainer ?? 'maemo-react application <nobody@example.invalid>'],
      ['Section', 'user/other'],
      ['Priority', 'optional'],
      ['Depends', RUNTIME_DEPENDS],
      ['Description', m.name + (m.description ? '\n' + m.description : '')],
    ],
    files: [
      { path: `${APPS}/${m.id}/app.js`, data: readFileSync(appJs) },
      { path: `/usr/share/applications/hildon/${m.id}.desktop`, data: Buffer.from(desktopEntry(m)) },
      // The icon is 64x64. Hildon uses it for every size, so install only that folder.
      { path: `/usr/share/icons/hicolor/64x64/hildon/${m.id}.png`, data: icon },
    ],
    scripts: { postinst: postinst(m.id), postrm: postrm(m.id) },
  });
  const out = join(dir, 'dist', `${m.id}_${m.version}_all.deb`);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(out, deb);
  return out;
}
