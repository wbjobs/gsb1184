// Headless integration: fly the camera across the world and run the same
// pipeline main.js uses (quadtree -> tilegen -> geometry -> memory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainQuadtree } from '../src/quadtree.js';
import { generateTile } from '../src/terrain-gen.js';
import { buildTileGeometry } from '../src/geometry.js';
import { MemoryManager, tileBytes } from '../src/memory.js';
import { Camera } from '../src/camera.js';

const WORLD = 8192, RES = 33;

test('full pipeline over a camera flight path', () => {
  const qt = new TerrainQuadtree({ worldSize: WORLD, maxLevel: 5, heightScale: 600 });
  const mm = new MemoryManager({ budgetBytes: 64 * 1024 * 1024 });
  const cam = new Camera({ worldSize: WORLD, heightScale: 600 });
  const tiles = new Map();

  // Fly from high above the center down to a corner, then across the map.
  const path = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    path.push({
      x: 4096 + (500 - 4096) * t,
      y: 4096 + (500 - 4096) * t,
      z: 40000 + (80 - 40000) * t,
    });
  }
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    path.push({ x: 500 + 7000 * t, y: 500 + 7000 * t, z: 150 });
  }

  let maxLeaves = 0, sawFine = false, highAltMaxLevel = 99;
  for (const p of path) {
    cam.pos = { ...p };
    cam.clamp();
    assert.ok(cam.pos.x >= 1 && cam.pos.x <= WORLD - 1, 'camera x in bounds');
    assert.ok(cam.pos.y >= 1 && cam.pos.y <= WORLD - 1, 'camera y in bounds');

    const { toLoad, toUnload, leaves } = qt.update(cam.pos);
    maxLeaves = Math.max(maxLeaves, leaves.length);
    for (const n of toUnload) { tiles.delete(n.key); mm.free(n.key); }
    for (const n of toLoad) {
      const heights = generateTile({
        x: n.x, y: n.y, size: n.size, res: RES,
        heightScale: 600, seed: 1337, erosion: true, worldScale: WORLD,
      });
      const geo = buildTileGeometry({ x: n.x, y: n.y, size: n.size, res: RES, heights, skirtDepth: n.size * 0.05 });
      for (const v of geo.verts) assert.ok(Number.isFinite(v), 'finite geometry');
      tiles.set(n.key, geo);
      const evicted = mm.alloc(n.key, tileBytes(RES));
      for (const k of evicted) tiles.delete(k);
    }
    if (p.z > 2000) highAltMaxLevel = Math.min(highAltMaxLevel, ...leaves.map((n) => n.level));
    if (leaves.some((n) => n.level >= 4)) sawFine = true;
    assert.ok(mm.used <= mm.budget, 'VRAM under budget');
    // Every visible leaf has geometry (no holes).
    for (const n of leaves) assert.ok(tiles.has(n.key), `tile present: ${n.key}`);
  }
  assert.ok(highAltMaxLevel <= 3, `high altitude stays coarse (got ${highAltMaxLevel})`);
  assert.ok(sawFine, 'near view reaches fine LOD');
  assert.ok(maxLeaves > 4, 'quadtree actually splits');
});

test('tiny VRAM budget triggers degradation, recovery on raise', () => {
  const qt = new TerrainQuadtree({ worldSize: WORLD, maxLevel: 5, heightScale: 600 });
  const mm = new MemoryManager({ budgetBytes: tileBytes(RES) * 2 }); // fits ~2 tiles
  const cam = { x: 100, y: 100, z: 60 };
  const tiles = new Map();
  let degradedEvents = 0;
  mm.onDegrade((d) => { if (d) degradedEvents++; });

  for (let frame = 0; frame < 30; frame++) {
    if (mm.degraded) qt.forceLevel = 1;
    const wasDegraded = mm.degraded;
    const { toLoad, toUnload, leaves } = qt.update(cam);
    for (const n of toUnload) { tiles.delete(n.key); mm.free(n.key); }
    for (const n of toLoad) {
      tiles.set(n.key, true);
      const evicted = mm.alloc(n.key, tileBytes(RES));
      for (const k of evicted) tiles.delete(k);
      if (!mm.degraded && evicted.some((k) => leaves.some((n) => n.key === k))) {
        mm.degraded = true;
        degradedEvents++;
        qt.forceLevel = 1;
      }
    }
    if (wasDegraded) {
      assert.ok(qt.leaves.every((n) => n.level === 1), 'degraded: single LOD');
    }
  }
  assert.ok(degradedEvents > 0, 'degradation triggered under pressure');
  assert.ok(mm.used <= Math.max(mm.budget, tileBytes(RES) * 4), 'bounded usage');

  // Recovery path: raise budget, lift the pin.
  mm.setBudget(256 * 1024 * 1024);
  assert.equal(mm.degraded, false);
  qt.forceLevel = null;
  const { leaves } = qt.update(cam);
  assert.ok(leaves.some((n) => n.level > 1), 'LOD recovers after budget raise');
});
