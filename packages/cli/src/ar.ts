// The common ar format of .deb files.

export interface ArEntry {
  name: string;
  data: Uint8Array;
}

function field(s: string, width: number): string {
  if (s.length > width) throw new Error('ar: the field is too long: ' + s);
  return s.padEnd(width, ' ');
}

export function writeAr(entries: ArEntry[], mtime = Math.floor(Date.now() / 1000)): Buffer {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  for (const e of entries) {
    const head =
      field(e.name, 16) + field(String(mtime), 12) + field('0', 6) + field('0', 6) +
      field('100644', 8) + field(String(e.data.length), 10) + '`\n';
    parts.push(Buffer.from(head, 'ascii'), Buffer.from(e.data));
    if (e.data.length % 2) parts.push(Buffer.from('\n', 'ascii'));
  }
  return Buffer.concat(parts);
}

/** Read an ar archive (for tests). */
export function readAr(buf: Buffer): ArEntry[] {
  if (buf.subarray(0, 8).toString('ascii') !== '!<arch>\n') throw new Error('ar: not an ar archive');
  const out: ArEntry[] = [];
  let off = 8;
  while (off < buf.length) {
    const name = buf.subarray(off, off + 16).toString('ascii').trim();
    const size = Number(buf.subarray(off + 48, off + 58).toString('ascii').trim());
    out.push({ name, data: buf.subarray(off + 60, off + 60 + size) });
    off += 60 + size + (size % 2);
  }
  return out;
}
