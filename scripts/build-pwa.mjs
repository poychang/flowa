import { cp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

// Package-owned fonts, including CJK subsets, stay on the same origin for offline use.
await cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/fonts', {
  recursive: true,
  // Liberation is Excalidraw's server-side-only font; the browser uses system Helvetica.
  filter: source => !source.split(/[\\/]/).includes('Liberation'),
});
await mkdir('dist/icons', { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, crc]);
}
// A geometric lowercase f within the maskable safe area; no external image/font dependency.
for (const size of [192, 512]) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const white = (px >= .43 && px < .54 && py >= .30 && py < .78)
      || (px >= .31 && px < .66 && py >= .43 && py < .53)
      || (px >= .47 && px < .67 && py >= .23 && py < .34);
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(white ? [255, 255, 255, 255] : [35, 107, 89, 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`dist/icons/icon-${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : `${dir}/${entry.name}`))).flat();
}
const assets = (await files('dist')).filter(path => path !== 'dist/sw.js').sort();
const template = await readFile('scripts/service-worker.js', 'utf8');
const hash = createHash('sha256').update(template);
let bytes = 0;
for (const path of assets) { const content = await readFile(path); hash.update(path).update(content); bytes += content.length; }
const version = hash.digest('hex').slice(0, 20);
await writeFile('dist/sw.js', template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets.map(path => path.slice(4)))));
console.log(`PWA ${version}: ${assets.length} static assets, ${(bytes / 1048576).toFixed(1)} MiB (uncompressed).`);
