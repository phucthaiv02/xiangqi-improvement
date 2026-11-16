// Downloads the prebuilt Pikafish WebAssembly engine (from the pikafish-js project)
// and its NNUE nets into public/engine, verifying every file by SHA-256.
// Nothing is written by hand: the engine is NOT part of this repository.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'public', 'engine');
const REL = 'https://github.com/Maicarons/pikafish-js/releases';
const BUILDS = ['threads-simd', 'single-simd', 'single-nosimd'];
const NETS = {
  lite: { label: 'Pikafish Lite (L1=512)', file: 'pikafish-lite.nnue', size: 25136309,
    sha256: 'ac223f6d20e8db0ec0ecf64b8955a834086e3eb329d52908c0730fdfba5dc97f' },
  w256: { label: 'Pikafish Nhẹ (L1=256)', file: 'pikafish-w256.nnue', size: 12646031,
    sha256: '316da3939d66edacc730a313a1bdddb0619ad1b8158b1dc5bd8244af335c552b' },
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const manifestPath = join(out, 'engine.json');
if (existsSync(manifestPath) && !process.env.FORCE) {
  console.log('public/engine already present (set FORCE=1 to re-download).');
  process.exit(0);
}

await rm(out, { recursive: true, force: true });
const sums = new Map();
for (const line of (await get(`${REL}/latest/download/SHA256SUMS`)).toString('utf8').split('\n')) {
  const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
  if (m) sums.set(m[2], m[1]);
}

const manifest = { engines: {} };
for (const [name, net] of Object.entries(NETS)) {
  const entry = { label: net.label, builds: {} };
  for (const build of BUILDS) {
    const dir = join(out, name, build);
    await mkdir(dir, { recursive: true });
    for (const ext of ['js', 'wasm']) {
      const asset = `${name}-${build}.pikafish.${ext}`;
      const want = sums.get(asset);
      if (!want) throw new Error(`No checksum published for ${asset}`);
      const buf = await get(`${REL}/latest/download/${asset}`);
      if (sha(buf) !== want) throw new Error(`Checksum mismatch: ${asset}`);
      await writeFile(join(dir, `pikafish.${ext}`), buf);
    }
    entry.builds[build] = { js: `engine/${name}/${build}/pikafish.js`, wasm: `engine/${name}/${build}/pikafish.wasm` };
    console.log('ok', name, build);
  }
  const buf = await get(`${REL}/download/networks/${net.file}`);
  if (buf.length !== net.size || sha(buf) !== net.sha256) throw new Error(`Checksum mismatch: ${net.file}`);
  await writeFile(join(out, net.file), buf);
  entry.net = { url: `engine/${net.file}`, size: buf.length, sha256: net.sha256 };
  console.log('ok net', net.file);
  manifest.engines[name] = entry;
}
await writeFile(manifestPath + '.tmp', JSON.stringify(manifest, null, 2));
await rename(manifestPath + '.tmp', manifestPath);
console.log('Engine assets ready in public/engine');
