import { readFileSync } from 'node:fs';

// node scripts/summarize-cpu-profile.mjs path/to/canvas-2000.cpuprofile
const path = process.argv[2];
if (!path) throw new Error('Provide a Chromium .cpuprofile path');
const profile = JSON.parse(readFileSync(path, 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
const functions = new Map();
const key = node => JSON.stringify(node.callFrame);
let sampledMicroseconds = 0;
for (let i = 0; i < profile.samples.length; i++) {
  let id = profile.samples[i];
  const delta = profile.timeDeltas[i]; sampledMicroseconds += delta;
  const seen = new Set(); let leaf = true;
  while (id !== undefined) {
    const node = nodes.get(id), name = key(node);
    let row = functions.get(name);
    if (!row) functions.set(name, row = { ...node.callFrame, selfMicroseconds: 0, inclusiveMicroseconds: 0 });
    if (leaf) row.selfMicroseconds += delta;
    if (!seen.has(name)) row.inclusiveMicroseconds += delta;
    seen.add(name); leaf = false; id = parents.get(id);
  }
}
console.log(JSON.stringify({
  samples: profile.samples.length, sampledMilliseconds: sampledMicroseconds / 1000,
  note: 'Sampled CPU stacks include idle time. Inclusive times overlap and must not be added. Function names/positions refer to the exact production bundle.',
  functions: [...functions.values()].sort((a, b) => b.selfMicroseconds - a.selfMicroseconds),
}, null, 2));
