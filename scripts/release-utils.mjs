import { readdir, readFile, realpath, lstat, readlink, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');
function within(root, path) {
  const rel = relative(root, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Release link escapes package');
}

export async function inventory(directory) {
  const root = await realpath(directory), files = {};
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = join(path, entry.name), name = slash(relative(root, full));
      if (name === 'release-manifest.json') continue;
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        const target = await readlink(full);
        if (isAbsolute(target)) throw new Error('Release links must be relative');
        within(root, await realpath(full));
        files[name] = { link: slash(target) };
      } else if (stat.isDirectory()) await visit(full);
      else if (stat.isFile()) files[name] = { sha256: sha256(await readFile(full)), bytes: stat.size, mode: stat.mode & 0o777 };
      else throw new Error(`Unsupported release entry: ${name}`);
    }
  }
  await visit(root); return files;
}

export async function notices(directory) {
  const root = await realpath(directory), store = join(root, 'node_modules/.pnpm');
  const packages = new Map();
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const modules = join(store, entry.name, 'node_modules');
    for (const name of await readdir(modules)) {
      if (name.startsWith('.')) continue;
      const candidates = name.startsWith('@') ? (await readdir(join(modules, name))).map(child => join(modules, name, child)) : [join(modules, name)];
      for (const candidate of candidates) {
        const location = await realpath(candidate); within(root, location);
        if (packages.has(location)) continue;
        const pkg = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));
        if (!pkg.name || !pkg.version || typeof pkg.license !== 'string') throw new Error('Dependency license metadata is missing');
        const texts = [];
        for (const filename of (await readdir(location)).sort()) {
          if (!/^(licen[sc]e|notice|copying)([.-].*)?$/i.test(filename)) continue;
          if (!(await lstat(join(location, filename))).isFile()) throw new Error('License source must be a regular file');
          const content = await readFile(join(location, filename), 'utf8');
          if (!content.trim()) throw new Error('Empty dependency license');
          texts.push({ filename, content });
        }
        if (!texts.some(text => /^(licen[sc]e|copying)/i.test(text.filename))) throw new Error(`License text missing: ${pkg.name}@${pkg.version}`);
        packages.set(location, { name: pkg.name, version: pkg.version, license: pkg.license,
          path: slash(relative(root, location)), texts });
      }
    }
  }
  const result = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  if (!result.length) throw new Error('No release dependencies found');
  await writeFile(join(root, 'THIRD-PARTY-NOTICES.txt'), 'Flowa relay: installed dependency notices\nOriginal license/notice texts follow. Frontend assets and the Node.js runtime are not included.\n\n' +
    result.map(pkg => `${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nDeclared license: ${pkg.license}\n\n` +
      pkg.texts.map(text => `--- ${text.filename} ---\n${text.content}\n`).join('\n')).join('\n'));
  const summary = result.map(({ texts, ...pkg }) => ({ ...pkg, licenseFiles: texts.map(text => ({ name: text.filename, sha256: sha256(text.content) })) }));
  await writeFile(join(root, 'dependency-licenses.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

export async function verifyRelease(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'release-manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.files) throw new Error('Unsupported release manifest');
  if (JSON.stringify(await inventory(directory)) !== JSON.stringify(manifest.files)) throw new Error('Release integrity mismatch');
  return manifest;
}
