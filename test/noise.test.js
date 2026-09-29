import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainHeight, fbm2, mulberry32 } from '../src/noise.js';
import { generateTile } from '../src/terrain-gen.js';

test('noise is deterministic for same seed', () => {
  assert.equal(terrainHeight(1.23, 4.56, 42), terrainHeight(1.23, 4.56, 42));
  assert.notEqual(terrainHeight(1.23, 4.56, 42), terrainHeight(1.23, 4.56, 43));
});

test('fbm stays in [0,1]', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const v = fbm2(rng() * 100, rng() * 100, { seed: 1 });
    assert.ok(v >= 0 && v <= 1, `out of range: ${v}`);
  }
});

test('tile generation: correct size, finite, deterministic', () => {
  const p = { x: 0, y: 0, size: 1024, res: 33, heightScale: 600, seed: 1337, erosion: true, worldScale: 8192 };
  const a = generateTile(p);
  const b = generateTile(p);
  assert.equal(a.length, 33 * 33);
  assert.ok(a instanceof Float32Array);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Number.isFinite(a[i]));
    assert.equal(a[i], b[i]); // erosion uses seeded rng -> deterministic
  }
});

test('erosion changes terrain but keeps heights bounded', () => {
  const base = { x: 512, y: 512, size: 1024, res: 33, heightScale: 600, seed: 1, worldScale: 8192 };
  const raw = generateTile({ ...base, erosion: false });
  const eroded = generateTile({ ...base, erosion: true });
  let differs = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== eroded[i]) differs = true;
    assert.ok(eroded[i] > -600 && eroded[i] < 1200);
  }
  assert.ok(differs, 'erosion should modify the heightmap');
});
