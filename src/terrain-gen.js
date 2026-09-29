// Tile heightmap generation — pure logic shared by worker and main-thread fallback.
import { terrainHeight, mulberry32 } from './noise.js';
import { thermalErosion, hydraulicErosion } from './erosion.js';

// Generate a tile heightmap as Float32Array(res*res), world-space heights.
// Tile: { x, y } origin in world units, size in world units, res = samples per side.
export function generateTile({ x, y, size, res, heightScale, seed, erosion: useErosion, worldScale }) {
  const h = new Float32Array(res * res);
  const inv = 1 / (worldScale || 4096);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const wx = x + (i / (res - 1)) * size;
      const wy = y + (j / (res - 1)) * size;
      h[j * res + i] = terrainHeight(wx * inv, wy * inv, seed) * heightScale;
    }
  }
  if (useErosion) {
    const rng = mulberry32((seed ^ (Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663)) >>> 0);
    thermalErosion(h, res, { iterations: 3, talus: heightScale * 0.002 });
    hydraulicErosion(h, res, { droplets: 1500, rng });
  }
  return h;
}
