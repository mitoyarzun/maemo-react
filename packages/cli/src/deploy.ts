// Copy a .deb to the tablet over SSH and install it as root.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { checkDebName, checkHost, checkPort, checkUser } from './app.js';

export interface Target {
  host: string;
  port: number;
  user: string;
}

export type Runner = (cmd: string, args: string[]) => void;

const defaultRunner: Runner = (cmd, args) => {
  execFileSync(cmd, args, { stdio: 'inherit' });
};

export function deploy(deb: string, t: Target, run: Runner = defaultRunner): void {
  // Check every value first. They reach ssh, scp and a remote shell.
  checkUser(t.user);
  checkHost(t.host);
  checkPort(t.port);
  const name = checkDebName(basename(deb));
  const ssh = ['-p', String(t.port), '-o', 'BatchMode=yes', '--', `${t.user}@${t.host}`];
  const dir = '.maemo-react/incoming';
  run('ssh', [...ssh, `mkdir -p ${dir}`]);
  run('scp', ['-P', String(t.port), '-o', 'BatchMode=yes', '--', deb, `${t.user}@${t.host}:${dir}/`]);
  // sudo gainroot needs R&D mode on the tablet; see the n810-modern README.
  // The shell of the user expands $HOME before the pipe. gainroot runs as root,
  // so a ~ inside the quoted text would mean /root. The name is checked above.
  run('ssh', [...ssh, `echo "dpkg -i $HOME/${dir}/${name}" | sudo gainroot`]);
}
