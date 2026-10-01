import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256 } from './release-utils.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
async function locate(from, name) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    try { return await realpath(join(dir, 'node_modules', name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dir === dirname(dir)) throw new Error(`Dependency not installed: ${name}`);
  }
}
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected asset link: ${path}`);
  }
  return result.sort(order);
}

export async function fontNotices(fontRoot, evidenceRoot = 'licenses/fonts', version = '0.18.1') {
  const manifest = await json(join(evidenceRoot, 'manifest.json'));
  if (version !== manifest.excalidrawVersion) throw new Error('Font license review required: Excalidraw version changed');
  const expected = Object.values(manifest.families).flatMap(family => family.files);
  if (JSON.stringify((await files(fontRoot))) !== JSON.stringify(expected.map(f => f.file).sort(order))) throw new Error('Font inventory changed; review licenses');
  for (const file of expected) {
    if (sha256(await readFile(join(fontRoot, file.file))) !== file.sha256) throw new Error(`Font content changed: ${file.file}`);
  }
  const ofl = await readFile(join(evidenceRoot, 'OFL-1.1.txt'), 'utf8');
  const sections = [];
  for (const [name, family] of Object.entries(manifest.families)) {
    const embedded = family.embeddedMetadata.map(data => [...data['0'], ...data['13'], ...data['14']].join('\n\n')).join('\n\n');
    const source = ['Excalifont', 'Xiaolai'].includes(name) ? await readFile(join(evidenceRoot, `${name}.txt`), 'utf8') : '';
    sections.push(`${name}\n${embedded}\n${source}\n${['ComicShanns', 'Cascadia', 'Virgil'].includes(name) ? '' : ofl}`);
  }
  return { manifest, text: sections.join('\n' + '='.repeat(72) + '\n') };
}

export async function frontendNotices(output = 'dist', root = '.') {
  const overrides = await json(join(root, 'licenses/packages/sources.json'));
  const seen = new Set(), packages = new Map(), bundled = new Set();
  async function visit(dir) {
    dir = await realpath(dir);
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = await json(join(dir, 'package.json')), key = `${pkg.name}@${pkg.version}`;
    const texts = [];
    for (const file of (await readdir(dir)).sort(order)) {
      if (!/^(licen[sc]e|notice|copying)([.-].*)?$/i.test(file)) continue;
      if (!(await stat(join(dir, file))).isFile()) continue;
      texts.push({ source: file, text: await readFile(join(dir, file), 'utf8') });
    }
    if (!texts.some(t => /^(licen[sc]e|copying)/i.test(t.source))) {
      const fallback = overrides.find(item => item.package === key);
      if (!fallback) throw new Error(`License text missing: ${key}`);
      texts.push({ source: fallback.source, note: fallback.note, text: await readFile(join(root, 'licenses/packages', fallback.file), 'utf8') });
    }
    if (texts.some(t => !t.text.trim())) throw new Error(`Incomplete license: ${key}`);
    packages.set(key, { name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'See original license text (package metadata omits SPDX identifier)', texts });
    // Excalidraw also bundles libraries internally. Preserve their original legal comments.
    if (pkg.name === '@excalidraw/excalidraw') {
      const prod = join(dir, 'dist/prod');
      for (const file of await files(prod)) {
        if (!/\.(js|css)$/.test(file)) continue;
        const source = await readFile(join(prod, file), 'utf8');
        for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
          if (/^\/\*!|@license|@preserve|copyright/i.test(match[0])) bundled.add(match[0]);
        }
      }
    }
    for (const name of Object.keys(pkg.dependencies ?? {}).sort(order)) await visit(await locate(dir, name));
    for (const name of Object.keys(pkg.peerDependencies ?? {}).sort(order)) {
      let peer;
      try { peer = await locate(dir, name); }
      catch (error) { if (pkg.peerDependenciesMeta?.[name]?.optional) continue; throw error; }
      await visit(peer);
    }
  }
  // Conservatively include every root production dependency (including relay-only code).
  for (const name of Object.keys((await json(join(root, 'package.json'))).dependencies).sort(order)) await visit(await locate(root, name));
  const excalidraw = await json(join(await locate(root, '@excalidraw/excalidraw'), 'package.json'));
  const fonts = await fontNotices(join(output, 'fonts'), join(root, 'licenses/fonts'), excalidraw.version);
  const list = [...packages.values()].sort((a, b) => order(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
  const header = 'Flowa third-party notices\nConservative inventory of installed production dependencies and their peers; some code is not shipped in the browser. Original notices follow. Fonts have separate licenses.\n\n';
  const text = header + list.map(p => `${'='.repeat(72)}\n${p.name}@${p.version} (${p.license})\n` + p.texts.map(t => `Source: ${t.source}\n${t.note ?? ''}\n${t.text}\n`).join('\n')).join('\n') + '\nExcalidraw bundled code notices\n' + [...bundled].sort(order).join('\n\n') + '\nFont notices\n' + fonts.text;
  await writeFile(join(output, 'THIRD-PARTY-NOTICES.txt'), text);
  await writeFile(join(output, 'dependency-licenses.json'), JSON.stringify({ packages: list.map(({ texts, ...p }) => ({ ...p, notices: texts.map(({ text, ...t }) => ({ ...t, sha256: sha256(text) })) })), fonts: fonts.manifest }, null, 2) + '\n');
  console.log(`Frontend notices: ${list.length} packages, ${Object.keys(fonts.manifest.families).length} font families.`);
}
