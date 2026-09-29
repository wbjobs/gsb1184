// Deterministic seeded noise (pure, shared by main thread and worker).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash-based 2D value noise with smooth interpolation.
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695040888963407) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const u = smooth(fx), v = smooth(fy);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v; // [0,1]
}

// Fractal Brownian motion, returns roughly [0,1].
export function fbm2(x, y, { octaves = 5, lacunarity = 2.0, gain = 0.5, seed = 0 } = {}) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal for mountain ranges, roughly [0,1].
export function ridged2(x, y, { octaves = 5, lacunarity = 2.0, gain = 0.5, seed = 0 } = {}) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(x * freq, y * freq, seed + i * 131) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Composite terrain height in [0,1]: ridged mountains modulated by fbm mask.
export function terrainHeight(x, y, seed = 1337) {
  const mask = fbm2(x * 0.5 + 100, y * 0.5 + 100, { octaves: 3, seed: seed + 7 });
  const base = fbm2(x, y, { octaves: 5, seed });
  const ridge = ridged2(x * 1.5, y * 1.5, { octaves: 5, seed: seed + 13 });
  const h = base * 0.45 + ridge * (0.25 + 0.55 * mask);
  return Math.min(1, Math.max(0, h));
}
