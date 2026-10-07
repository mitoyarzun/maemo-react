// A ustar writer for package archives: every entry belongs to root.
import { gzipSync } from 'node:zlib';

export interface TarEntry {
  /** "./opt/x/" for a folder, "./opt/x/file" for a file. */
  path: string;
  type: 'file' | 'dir';
  mode: number;
  data?: Uint8Array;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(e: TarEntry, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512, 0);
  let name = e.path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
    if (cut < 0 || Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error('tar: the path is too long: ' + e.path);
    }
  }
  h.write(name, 0, 100, 'utf8');
  h.write(octal(e.mode, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtime, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(e.type === 'dir' ? '5' : '0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write('root', 265, 32, 'ascii');
  h.write('root', 297, 32, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

export function writeTar(entries: TarEntry[], mtime = Math.floor(Date.now() / 1000)): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.type === 'file' ? Buffer.from(e.data ?? new Uint8Array(0)) : Buffer.alloc(0);
    parts.push(header(e, data.length, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** Gzip, because Diablo's dpkg 1.14 cannot read xz or zstd. */
export function writeTarGz(entries: TarEntry[], mtime?: number): Buffer {
  return gzipSync(writeTar(entries, mtime), { level: 9 });
}
