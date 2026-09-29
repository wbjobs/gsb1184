import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTileGeometry } from '../src/geometry.js';

const res = 9;
const heights = new Float32Array(res * res).map((_, i) => Math.sin(i) * 100);
const geo = buildTileGeometry({ x: 0, y: 0, size: 256, res, heights, skirtDepth: 50 });

test('vertex/index counts include skirt ring', () => {
  assert.equal(geo.vertexCount, res * res + res * 4);
  assert.equal(geo.verts.length, geo.vertexCount * 6);
  const quads = (res - 1) * (res - 1) + (res - 1) * 4;
  assert.equal(geo.indexCount, quads * 6);
});

test('all indices valid, all values finite', () => {
  for (const i of geo.idx) assert.ok(i >= 0 && i < geo.vertexCount);
  for (const v of geo.verts) assert.ok(Number.isFinite(v));
});

test('skirt vertices sit directly below boundary vertices (裂缝遮挡)', () => {
  const grid = res * res;
  // First skirt vertex corresponds to grid vertex 0 (west edge, j=0).
  const g = 0, s = grid * 6;
  assert.equal(geo.verts[s], geo.verts[g]);
  assert.equal(geo.verts[s + 1], geo.verts[g + 1]);
  assert.equal(geo.verts[s + 2], geo.verts[g + 2] - 50);
});

test('normals are unit length', () => {
  for (let v = 0; v < geo.vertexCount; v++) {
    const o = v * 6;
    const len = Math.hypot(geo.verts[o + 3], geo.verts[o + 4], geo.verts[o + 5]);
    assert.ok(Math.abs(len - 1) < 1e-4, `normal ${v} len ${len}`);
  }
});
