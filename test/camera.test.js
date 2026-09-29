import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/camera.js';

test('camera stays inside world bounds (相机越界)', () => {
  const cam = new Camera({ worldSize: 8192, heightScale: 600 });
  cam.pos = { x: -5000, y: 99999, z: 1e9 };
  cam.clamp();
  assert.ok(cam.pos.x >= 1 && cam.pos.x <= 8191);
  assert.ok(cam.pos.y >= 1 && cam.pos.y <= 8191);
  assert.ok(cam.pos.z <= 2400);
});

test('camera never goes below terrain + clearance', () => {
  const cam = new Camera({ worldSize: 8192, heightScale: 600 });
  cam.terrainHeightAt = () => 300;
  cam.pos = { x: 100, y: 100, z: 100 };
  cam.clamp();
  assert.ok(cam.pos.z >= 308);
});

test('view matrix is finite and moves with camera', () => {
  const cam = new Camera({ worldSize: 8192, heightScale: 600 });
  const m1 = cam.viewMatrix();
  for (const v of m1) assert.ok(Number.isFinite(v));
  cam.pos.x += 100;
  const m2 = cam.viewMatrix();
  assert.notDeepEqual([...m1], [...m2]);
});
