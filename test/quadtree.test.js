import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainQuadtree } from '../src/quadtree.js';

const make = () => new TerrainQuadtree({ worldSize: 8192, maxLevel: 5, heightScale: 600 });

function coverage(leaves, worldSize) {
  // Leaves must tile the world exactly: no overlap, total area == world area.
  let area = 0;
  for (const a of leaves) {
    area += a.size * a.size;
    for (const b of leaves) {
      if (a === b) continue;
      const ox = Math.max(0, Math.min(a.x + a.size, b.x + b.size) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.size, b.y + b.size) - Math.max(a.y, b.y));
      assert.equal(ox * oy, 0, `overlap between ${a.key} and ${b.key}`);
    }
  }
  assert.equal(area, worldSize * worldSize);
}

test('camera far away -> single coarse leaf (LOD 切换)', () => {
  const qt = make();
  const { leaves } = qt.update({ x: 4096, y: 4096, z: 30000 });
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].level, 0);
});

test('camera close -> splits near camera, stays coarse far away', () => {
  const qt = make();
  const { leaves } = qt.update({ x: 100, y: 100, z: 50 });
  assert.ok(leaves.length > 1);
  const levels = leaves.map((n) => n.level);
  assert.ok(Math.max(...levels) > Math.min(...levels));
  // Finest leaves should be near the camera.
  const finest = leaves.filter((n) => n.level === Math.max(...levels));
  for (const n of finest) {
    assert.ok(n.x < 2048 && n.y < 2048, `fine leaf far from camera: ${n.key}`);
  }
  coverage(leaves, 8192);
});

test('restricted quadtree: neighbor level diff <= 1 (裂缝处理前提)', () => {
  const qt = make();
  for (const cam of [
    { x: 100, y: 100, z: 30 },
    { x: 4000, y: 4000, z: 100 },
    { x: 8100, y: 100, z: 500 },
  ]) {
    qt.update(cam);
    for (const leaf of qt.leaves) {
      const nb = qt.neighborLevels(leaf);
      for (const lvl of nb) {
        assert.ok(Math.abs(lvl - leaf.level) <= 1,
          `level diff > 1 at ${leaf.key} (neighbor ${lvl})`);
      }
    }
  }
});

test('incremental update returns correct diffs (四叉树更新)', () => {
  const qt = make();
  const r1 = qt.update({ x: 4096, y: 4096, z: 30000 });
  assert.equal(r1.toLoad.length, 1);
  const r2 = qt.update({ x: 100, y: 100, z: 50 });
  assert.ok(r2.toLoad.length > 0);
  assert.ok(r2.toUnload.length >= 1);
  // No-op update -> empty diffs.
  const r3 = qt.update({ x: 100, y: 100, z: 50 });
  assert.equal(r3.toLoad.length, 0);
  assert.equal(r3.toUnload.length, 0);
  coverage(r2.leaves, 8192);
});

test('forceLevel pins all leaves to one level (降级到单 LOD)', () => {
  const qt = make();
  qt.update({ x: 100, y: 100, z: 30 });
  qt.forceLevel = 1;
  const { leaves } = qt.update({ x: 100, y: 100, z: 30 });
  assert.equal(leaves.length, 4);
  assert.ok(leaves.every((n) => n.level === 1));
  qt.forceLevel = null;
  const again = qt.update({ x: 100, y: 100, z: 30 });
  assert.ok(again.leaves.some((n) => n.level > 1), 'should recover after degrade');
});
