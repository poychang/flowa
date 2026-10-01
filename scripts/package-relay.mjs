import { mkdir, cp, readFile, writeFile, rename, unlink, mkdtemp, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inventory, notices, sha256, verifyRelease } from './release-utils.mjs';

if (process.platform !== 'linux') throw new Error('Build distributable relay packages on Linux; use Linux CI from Windows.');
const root = process.cwd();
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Release requires a clean Git checkout');
const commit = git('rev-parse', 'HEAD');
const name = process.argv[2] ?? `flowa-relay-${commit.slice(0, 12)}-linux-${process.arch}`;
if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)) throw new Error('Invalid release name');
const pnpm = process.env.npm_execpath;
if (!pnpm || !/pnpm\.(c?js|mjs)$/.test(pnpm)) throw new Error('Run through pnpm package:relay');
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: 'inherit' });
const base = resolve('release-artifacts'); await mkdir(base, { recursive: true });
const output = join(base, name), archive = `${output}.tar.gz`;
for (const path of [output, archive, `${archive}.sha256`]) {
  try { await lstat(path); throw new Error('Release output already exists; choose a new name'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Compile into a fresh ignored directory so removed source files cannot survive in a release.
const temporary = await mkdtemp(join(base, '.build-'));
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.relay.json', '--outDir', temporary]);
run(process.execPath, [pnpm, '--filter', '@flowa/relay-release', '--prod', 'deploy', output]);
await cp(temporary, join(output, 'dist-relay'), { recursive: true });
await mkdir(join(output, 'scripts'));
for (const file of ['start-relay.mjs', 'check-relay.mjs']) await cp(join('scripts', file), join(output, 'scripts', file));
await cp('LICENSE', join(output, 'LICENSE'));
await cp('release/relay/README.md', join(output, 'README.md'));
// Deploy carries unused workspace patch settings. Keep the resolved lock as provenance,
// but do not ship an install configuration pointing outside this self-contained package.
await mkdir(join(output, 'provenance'));
await rename(join(output, 'pnpm-lock.yaml'), join(output, 'provenance/pnpm-lock.yaml'));
await unlink(join(output, 'pnpm-workspace.yaml'));
await unlink(join(output, 'node_modules/.modules.yaml'));
const dependencies = await notices(output);
if (dependencies.some(pkg => ['react', 'react-dom', '@excalidraw/excalidraw', 'vite', 'typescript', '@playwright/test'].includes(pkg.name)))
  throw new Error('Unexpected frontend or build dependency in relay package');
const manifest = { format: 1, commit, platform: process.platform, arch: process.arch, node: process.version,
  sourceLockSha256: sha256(await readFile('pnpm-lock.yaml')), dependencies: dependencies.map(({ name, version }) => ({ name, version })),
  files: await inventory(output) };
await writeFile(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await verifyRelease(output);
run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', output, '.']);
await writeFile(`${archive}.sha256`, `${sha256(await readFile(archive))}  ${name}.tar.gz\n`);
console.log(JSON.stringify({ directory: output, archive, commit, packages: dependencies.length }));
