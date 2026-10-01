import { verifyRelease } from './release-utils.mjs';
try {
  if (!process.argv[2]) throw new Error('Provide an extracted release directory');
  const manifest = await verifyRelease(process.argv[2]);
  console.log(JSON.stringify({ ok: true, commit: manifest.commit, platform: manifest.platform, arch: manifest.arch }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
