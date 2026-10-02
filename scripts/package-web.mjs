import { mkdir, readFile, writeFile, lstat, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { inventory, sha256, verifyRelease } from './release-utils.mjs';
import { webReleaseConfig } from './web-release-config.mjs';

if (process.platform !== 'linux') throw new Error('Build distributable web packages on Linux; use Linux CI from Windows.');
const config = webReleaseConfig();
const root = process.cwd();
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Release requires a clean Git checkout');
const commit = git('rev-parse', 'HEAD');
const name = process.argv[2] ?? `flowa-web-${commit.slice(0, 12)}`;
if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)) throw new Error('Invalid release name');
const base = resolve('release-artifacts'); await mkdir(base, { recursive: true });
const output = join(base, name), archive = `${output}.tar.gz`;
for (const path of [output, archive, `${archive}.sha256`]) {
  try { await lstat(path); throw new Error('Release output already exists; choose a new name'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// A new directory prevents stale dist files or device build metadata entering the release.
await mkdir(output);
const site = join(output, 'site');
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { stdio: 'inherit' });
// No local dotenv files or ambient VITE_* settings become release configuration.
process.env.NODE_ENV = 'production';
await build({ configFile: false, envDir: false, envPrefix: [], mode: 'production', base: '/',
  define: { 'import.meta.env.VITE_RELAY_URL': JSON.stringify(config.relayOrigin) },
  build: { outDir: site, emptyOutDir: false, sourcemap: false } });
execFileSync(process.execPath, ['scripts/build-pwa.mjs', site], { stdio: 'inherit' });
await cp('LICENSE', join(output, 'LICENSE'));
await writeFile(join(output, 'README.txt'), 'Publish the complete site/ directory at the recorded HTTPS web origin, at /.\nKeep this manifest and the previous archive outside the public web root.\nVerify the archive checksum and release manifest before deployment.\nRollback restores a complete previous site and its matching relay/configuration; it does not restore relay rooms.\n');
const worker = await readFile(join(site, 'sw.js'), 'utf8');
const manifest = { format: 1, kind: 'flowa-web', commit, platform: process.platform, arch: process.arch, node: process.version,
  config, sourceLockSha256: sha256(await readFile('pnpm-lock.yaml')),
  pwaVersion: worker.match(/const VERSION = '([a-f0-9]+)'/)?.[1], files: await inventory(output) };
if (!manifest.pwaVersion) throw new Error('PWA version missing');
await writeFile(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await verifyRelease(output);
execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', output, '.']);
await writeFile(`${archive}.sha256`, `${sha256(await readFile(archive))}  ${name}.tar.gz\n`);
console.log(JSON.stringify({ directory: output, archive, commit, ...config, pwaVersion: manifest.pwaVersion }));
