// Build a .deb in memory: debian-binary, control.tar.gz, data.tar.gz.
import { writeAr } from './ar.js';
import { writeTarGz, type TarEntry } from './tar.js';

export interface DebFile {
  /** The install path, for example /opt/n810-modern/bin/x. */
  path: string;
  data: Uint8Array;
  mode?: number;
}

export interface DebSpec {
  /** Control fields in order. A multi-line value is folded as Debian wants. */
  control: Array<[string, string]>;
  files: DebFile[];
  scripts?: { postinst?: string; prerm?: string; postrm?: string };
}

function controlText(fields: Array<[string, string]>): string {
  return (
    fields
      .map(([k, v]) => `${k}: ` + v.split('\n').map((line, i) => (i === 0 ? line : ' ' + (line === '' ? '.' : line))).join('\n'))
      .join('\n') + '\n'
  );
}

export function buildDeb(spec: DebSpec, mtime?: number): Buffer {
  const dirs = new Set<string>();
  for (const f of spec.files) {
    if (!f.path.startsWith('/')) throw new Error('deb: the path must be absolute: ' + f.path);
    const parts = f.path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const data: TarEntry[] = [{ path: './', type: 'dir', mode: 0o755 }];
  for (const d of [...dirs].sort()) data.push({ path: './' + d + '/', type: 'dir', mode: 0o755 });
  for (const f of spec.files) data.push({ path: '.' + f.path, type: 'file', mode: f.mode ?? 0o644, data: f.data });

  const size = Math.max(1, Math.ceil(spec.files.reduce((n, f) => n + f.data.length, 0) / 1024));
  const control: TarEntry[] = [
    { path: './', type: 'dir', mode: 0o755 },
    { path: './control', type: 'file', mode: 0o644, data: Buffer.from(controlText([...spec.control, ['Installed-Size', String(size)]])) },
  ];
  for (const [name, body] of Object.entries(spec.scripts ?? {})) {
    if (body) control.push({ path: './' + name, type: 'file', mode: 0o755, data: Buffer.from(body) });
  }
  return writeAr(
    [
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      { name: 'control.tar.gz', data: writeTarGz(control, mtime) },
      { name: 'data.tar.gz', data: writeTarGz(data, mtime) },
    ],
    mtime,
  );
}
