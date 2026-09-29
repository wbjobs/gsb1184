// CPU-side tile geometry builder: positions + normals + indices + crack-hiding skirts.
// Pure TypedArray logic — unit-testable without WebGL.
//
// Layout per vertex: [x, y, z, nx, ny, nz] (interleaved Float32, stride 6).
// Grid is res x res over the tile's world rect; skirt ring appended after grid verts.

export function buildTileGeometry({ x, y, size, res, heights, skirtDepth }) {
  const gridVerts = res * res;
  const skirtVerts = res * 4;
  const totalVerts = gridVerts + skirtVerts;
  const verts = new Float32Array(totalVerts * 6);

  const step = size / (res - 1);
  const at = (i, j) => heights[
    Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))
  ];

  // Grid vertices with central-difference normals.
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const o = (j * res + i) * 6;
      const wx = x + i * step, wy = y + j * step, wz = at(i, j);
      const hl = at(i - 1, j), hr = at(i + 1, j);
      const hd = at(i, j - 1), hu = at(i, j + 1);
      let nx = (hl - hr) / (2 * step);
      let ny = (hd - hu) / (2 * step);
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      verts[o] = wx; verts[o + 1] = wy; verts[o + 2] = wz;
      verts[o + 3] = nx / len; verts[o + 4] = ny / len; verts[o + 5] = nz / len;
    }
  }

  // Skirt: duplicate boundary verts, pushed straight down by skirtDepth.
  // Order: west edge (j=0..res-1), east, north, south.
  const edges = [
    (k) => 0 * res + k,          // west:  i=0
    (k) => k * res + (res - 1),  // east:  i=res-1
    (k) => k * res + 0,          // north: j=0
    (k) => (res - 1) * res + k,  // south: j=res-1
  ];
  let sv = gridVerts;
  for (const edgeIdx of edges) {
    for (let k = 0; k < res; k++) {
      const src = edgeIdx(k) * 6;
      const dst = sv * 6;
      verts[dst] = verts[src];
      verts[dst + 1] = verts[src + 1];
      verts[dst + 2] = verts[src + 2] - skirtDepth;
      verts[dst + 3] = verts[src + 3];
      verts[dst + 4] = verts[src + 4];
      verts[dst + 5] = verts[src + 5];
      sv++;
    }
  }

  // Indices: grid quads + skirt quads. Use Uint32 if needed.
  const gridQuads = (res - 1) * (res - 1);
  const skirtQuads = (res - 1) * 4;
  const IndexArray = totalVerts > 65535 ? Uint32Array : Uint16Array;
  const idx = new IndexArray((gridQuads + skirtQuads) * 6);
  let q = 0;
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i, b = a + 1, c = a + res, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  // Skirt quads connect boundary vert k -> k+1 with its dropped copy.
  for (let e = 0; e < 4; e++) {
    const base = gridVerts + e * res;
    for (let k = 0; k < res - 1; k++) {
      const g0 = edges[e](k), g1 = edges[e](k + 1);
      const s0 = base + k, s1 = base + k + 1;
      idx[q++] = g0; idx[q++] = s0; idx[q++] = g1;
      idx[q++] = g1; idx[q++] = s0; idx[q++] = s1;
    }
  }

  return { verts, idx, vertexCount: totalVerts, indexCount: idx.length };
}
