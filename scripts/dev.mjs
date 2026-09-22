import { spawn } from 'node:child_process';
const children = [];
const env = { ...process.env, VITE_RELAY_URL: process.env.VITE_RELAY_URL || `http://127.0.0.1:${process.env.PORT || 3001}` };
for (const args of [['--experimental-transform-types', 'apps/relay/main.ts'], ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env, windowsHide: true }); children.push(child);
  child.on('exit', code => { for (const sibling of children) if (sibling !== child) sibling.kill(); process.exitCode = code ?? 0; });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of children) child.kill(); });
