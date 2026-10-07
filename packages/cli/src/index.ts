// The maemo-react command line tool.
//   maemo-react create <dir> [--id <id>] [--name <name>]
//   maemo-react build
//   maemo-react package
//   maemo-react deploy [file.deb] [--host <host>] [--port <port>] [--user <user>]
import { basename } from 'node:path';
import { readManifest } from './app.js';
import { buildApp } from './build.js';
import { createApp } from './create.js';
import { deploy } from './deploy.js';
import { packageApp } from './package.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(): never {
  console.error(`usage:
  maemo-react create <dir> [--id <id>] [--name <name>]
  maemo-react build
  maemo-react package
  maemo-react deploy [file.deb] [--host <host>] [--port <port>] [--user <user>]`);
  process.exit(2);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  const cwd = process.cwd();
  switch (cmd) {
    case 'create': {
      const dir = args[0];
      if (!dir || dir.startsWith('--')) usage();
      const id = flag(args, '--id') ?? basename(dir).toLowerCase().replace(/[^a-z0-9+.-]/g, '-');
      createApp(dir, id, flag(args, '--name') ?? id);
      console.log(`created ${dir}. Next: cd ${dir} && npm install && npm run build`);
      return;
    }
    case 'build':
      console.log(await buildApp(cwd));
      return;
    case 'package':
      await buildApp(cwd);
      console.log(packageApp(cwd));
      return;
    case 'deploy': {
      const m = readManifest(cwd);
      // Skip the value of a flag, for example --host x.deb.
      let deb = args.find((a, i) => a.endsWith('.deb') && !args[i - 1]?.startsWith('--'));
      if (!deb) {
        await buildApp(cwd);
        deb = packageApp(cwd);
      }
      const host = flag(args, '--host') ?? m.deploy?.host;
      if (!host) throw new Error('give --host, or "deploy": { "host": ... } in app.json');
      deploy(deb, {
        host,
        port: Number(flag(args, '--port') ?? m.deploy?.port ?? 2222),
        user: flag(args, '--user') ?? m.deploy?.user ?? 'user',
      });
      return;
    }
    default:
      usage();
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  console.error('maemo-react: ' + e.message);
  process.exit(1);
});
