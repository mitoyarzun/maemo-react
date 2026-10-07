import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import { describe, expect, test } from 'vitest';
import { readManifest } from '../src/app.js';
import { readAr, writeAr } from '../src/ar.js';
import { checkoutPackages, createApp } from '../src/create.js';
import { buildDeb } from '../src/deb.js';
import { deploy } from '../src/deploy.js';
import { packageApp } from '../src/package.js';
import { iconPng } from '../src/png.js';
import { writeTar } from '../src/tar.js';

const temp = () => mkdtempSync(join(tmpdir(), 'maemo-react-cli-'));

/** Extract a tar with the system tar, and return the folder. */
function untar(buf: Buffer): string {
  const dir = temp();
  execFileSync('tar', ['-xf', '-', '-C', dir], { input: buf });
  return dir;
}

describe('tar', () => {
  test('the system tar extracts files, folders, modes and long paths', () => {
    const long = 'd'.repeat(90) + '/' + 'f'.repeat(60) + '.txt';
    const dir = untar(
      writeTar([
        { path: './a/', type: 'dir', mode: 0o755 },
        { path: './a/run.sh', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\n') },
        { path: './' + long, type: 'file', mode: 0o644, data: Buffer.from('x'.repeat(1000)) },
      ]),
    );
    expect(readFileSync(join(dir, 'a/run.sh'), 'utf8')).toBe('#!/bin/sh\n');
    expect(statSync(join(dir, 'a/run.sh')).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(dir, long), 'utf8')).toHaveLength(1000);
  });
});

describe('ar', () => {
  test('round trip, with an odd size', () => {
    const entries = [
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      { name: 'odd', data: Buffer.from('abc') },
      { name: 'last', data: Buffer.from('z') },
    ];
    const back = readAr(writeAr(entries));
    expect(back.map((e) => [e.name, Buffer.from(e.data).toString()])).toEqual([
      ['debian-binary', '2.0\n'],
      ['odd', 'abc'],
      ['last', 'z'],
    ]);
  });
});

describe('deb', () => {
  test('the members, the control file and the scripts', () => {
    const deb = buildDeb({
      control: [['Package', 'x'], ['Description', 'Short\nLong line.\n\nNext paragraph.']],
      files: [{ path: '/opt/x/app.js', data: Buffer.from('1') }],
      scripts: { postinst: '#!/bin/sh\nexit 0\n' },
    });
    const members = readAr(deb);
    expect(members.map((m) => m.name)).toEqual(['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    const control = untar(gunzipSync(members[1].data));
    expect(readFileSync(join(control, 'control'), 'utf8')).toBe(
      'Package: x\nDescription: Short\n Long line.\n .\n Next paragraph.\nInstalled-Size: 1\n',
    );
    expect(statSync(join(control, 'postinst')).mode & 0o777).toBe(0o755);
    const data = untar(gunzipSync(members[2].data));
    expect(readFileSync(join(data, 'opt/x/app.js'), 'utf8')).toBe('1');
  });

  test('a relative path is refused', () => {
    expect(() => buildDeb({ control: [], files: [{ path: 'opt/x', data: Buffer.from('') }] })).toThrow(/absolute/);
  });
});

describe('manifest', () => {
  const write = (m: object) => {
    const dir = temp();
    writeFileSync(join(dir, 'app.json'), JSON.stringify(m));
    return dir;
  };
  test('a valid manifest', () => {
    expect(readManifest(write({ id: 'hello', name: 'Hello', version: '0.1.0' })).id).toBe('hello');
  });
  test.each([
    [{ id: 'Hello', name: 'H', version: '1' }, /Debian package name/],
    [{ id: 'hello', name: '', version: '1' }, /"name" is missing/],
    [{ id: 'hello', name: 'H', version: 'v1' }, /must start with a digit/],
  ])('an invalid manifest: %j', (m, pattern) => {
    expect(() => readManifest(write(m))).toThrow(pattern);
  });
});

describe('create and package', () => {
  test('create makes an application that package turns into a .deb', () => {
    const dir = join(temp(), 'my-app');
    createApp(dir, 'my-app', 'My App');
    for (const f of ['app.json', 'package.json', 'tsconfig.json', 'src/main.tsx', 'src/App.tsx', 'icon.png']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    expect(readManifest(dir)).toMatchObject({ id: 'my-app', name: 'My App', version: '0.1.0' });

    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist/app.js'), 'console.log(1);\n');
    const deb = packageApp(dir);
    expect(deb).toBe(join(dir, 'dist/my-app_0.1.0_all.deb'));
    const members = readAr(readFileSync(deb));
    const data = untar(gunzipSync(members[2].data));
    const desktop = readFileSync(join(data, 'usr/share/applications/hildon/my-app.desktop'), 'utf8');
    expect(desktop).toContain('Exec=/opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/my-app/app.js');
    expect(existsSync(join(data, 'usr/share/icons/hicolor/64x64/hildon/my-app.png'))).toBe(true);
    const control = untar(gunzipSync(members[1].data));
    expect(readFileSync(join(control, 'control'), 'utf8')).toContain('Depends: maemo-react-runtime (>= 0.3.0)');
    expect(readFileSync(join(control, 'postinst'), 'utf8')).toContain('--compile /opt/n810-modern/share/maemo-react/apps/my-app/app.js');
    expect(readFileSync(join(control, 'postinst'), 'utf8')).toContain('bytecode compile failed for /opt/n810-modern/share/maemo-react/apps/my-app/app.js');
    expect(existsSync(join(data, 'usr/share/icons/hicolor/26x26/hildon/my-app.png'))).toBe(false);
  });

  test('create writes file: dependencies that point at the checkout packages', () => {
    const dir = join(temp(), 'dep-app');
    createApp(dir, 'dep-app', 'Dep App');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const n of ['core', 'widgets', 'cli', 'types']) {
      const spec: string = all[`@maemo-react/${n}`];
      expect(spec).toMatch(/^file:\//);
      expect(existsSync(join(spec.slice('file:'.length), 'package.json'))).toBe(true);
    }
    // No other maemo-react dependency may use a registry range.
    for (const [k, v] of Object.entries(all)) if (k.startsWith('@maemo-react/')) expect(v).toMatch(/^file:/);
  });

  test('create maps react to the React types of the application', () => {
    // The linked packages must not find a second copy of @types/react.
    const dir = join(temp(), 'types-app');
    createApp(dir, 'types-app', 'Types App');
    const ts = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
    expect(ts.compilerOptions.paths).toEqual({
      react: ['./node_modules/@types/react'],
      'react/*': ['./node_modules/@types/react/*'],
    });
  });

  test('create refuses to run outside a checkout', () => {
    expect(() => checkoutPackages(temp())).toThrow(/maemo-react checkout/);
  });

  test('create refuses a folder that is not empty', () => {
    const dir = temp();
    writeFileSync(join(dir, 'x'), '');
    expect(() => createApp(dir, 'x-app', 'X')).toThrow(/not empty/);
  });

  test('package needs a build first', () => {
    const dir = temp();
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ id: 'abc', name: 'A', version: '1' }));
    expect(() => packageApp(dir)).toThrow(/run "maemo-react build" first/);
  });
});

test('deploy copies, then installs as root', () => {
  const calls: string[][] = [];
  deploy('/tmp/x/app_0.1.0_all.deb', { host: 'tablet', port: 2222, user: 'user' }, (cmd, args) => {
    calls.push([cmd, ...args]);
  });
  expect(calls).toEqual([
    ['ssh', '-p', '2222', '-o', 'BatchMode=yes', '--', 'user@tablet', 'mkdir -p .maemo-react/incoming'],
    ['scp', '-P', '2222', '-o', 'BatchMode=yes', '--', '/tmp/x/app_0.1.0_all.deb', 'user@tablet:.maemo-react/incoming/'],
    ['ssh', '-p', '2222', '-o', 'BatchMode=yes', '--', 'user@tablet', 'echo "dpkg -i $HOME/.maemo-react/incoming/app_0.1.0_all.deb" | sudo gainroot'],
  ]);
});

test('the icon is a PNG of the given size', () => {
  const png = iconPng(64, [10, 20, 30]);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([64, 64]);
});

describe('deploy refuses bad input', () => {
  const ok = { host: 'tablet', port: 2222, user: 'user' };
  const good = '/tmp/x/app_0.1.0_all.deb';
  test.each([
    ['host', good, { ...ok, host: '-oProxyCommand=x' }, /host/],
    ['host', good, { ...ok, host: 'a b' }, /host/],
    ['user', good, { ...ok, user: "a'b" }, /user/],
    ['port', good, { ...ok, port: NaN }, /port/],
    ['port', good, { ...ok, port: 70000 }, /port/],
    ['deb', "/tmp/x/a'b_1_all.deb", ok, /\.deb/],
  ])('%s', (_f, deb, target, pattern) => {
    let called = 0;
    expect(() => deploy(deb, target, () => void called++)).toThrow(pattern);
    expect(called).toBe(0);
  });
  test('an IPv6 host is accepted', () => {
    const calls: string[][] = [];
    deploy('/tmp/a_1_all.deb', { ...ok, host: '[fe80::1]' }, (c, a) => void calls.push([c, ...a]));
    expect(calls).toHaveLength(3);
  });
});

describe('manifest security', () => {
  const write = (m: unknown) => {
    const dir = temp();
    writeFileSync(join(dir, 'app.json'), JSON.stringify(m));
    return dir;
  };
  const base = { id: 'hello', name: 'Hello', version: '1' };
  test.each([
    [{ ...base, deploy: { host: '-oProxyCommand=x' } }, /deploy\.host/],
    [{ ...base, deploy: { user: "a'b" } }, /deploy\.user/],
    [{ ...base, deploy: { port: 70000 } }, /deploy\.port/],
    [{ ...base, name: 'a\nb' }, /"name"/],
    [{ ...base, maintainer: 'a\rb' }, /"maintainer"/],
    [{ ...base, description: 'a\nb' }, /"description"/],
    [{ ...base, name: '   ' }, /"name" is missing/],
    [null, /JSON object/],
  ])('rejects %j', (m, pattern) => {
    expect(() => readManifest(write(m))).toThrow(pattern);
  });
});

test('create with a quote in the name makes an App.tsx that compiles', () => {
  const dir = join(temp(), 'q-app');
  createApp(dir, 'q-app', 'My "Quoted" App');
  const code = readFileSync(join(dir, 'src/App.tsx'), 'utf8');
  expect(() => transformSync(code, { loader: 'tsx' })).not.toThrow();
});
