import { verifyRelease } from './release-utils.mjs';
try {
  if (!process.argv[2]) throw new Error('Provide an extracted web release directory');
  const manifest = await verifyRelease(process.argv[2]);
  if (manifest.kind !== 'flowa-web') throw new Error('Not a Flowa web release');
  console.log(JSON.stringify({ ok: true, commit: manifest.commit, ...manifest.config, pwaVersion: manifest.pwaVersion }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
