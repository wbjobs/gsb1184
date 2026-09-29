// Thermal + simplified hydraulic erosion on a heightmap (Float32Array, row-major, size x size).
// Operates in-place on TypedArrays; designed to run inside a Web Worker.

export function thermalErosion(h, size, { iterations = 4, talus = 0.008, rate = 0.5 } = {}) {
  const n = size;
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hi = h[i];
        let total = 0;
        const diffs = [];
        // 4-neighborhood
        if (x > 0) diffs.push(hi - h[i - 1], i - 1);
        if (x < n - 1) diffs.push(hi - h[i + 1], i + 1);
        if (y > 0) diffs.push(hi - h[i - n], i - n);
        if (y < n - 1) diffs.push(hi - h[i + n], i + n);
        let maxD = 0;
        for (let k = 0; k < diffs.length; k += 2) {
          if (diffs[k] > talus) { total += diffs[k]; if (diffs[k] > maxD) maxD = diffs[k]; }
        }
        if (total <= 0) continue;
        const move = rate * (maxD - talus) * 0.5;
        for (let k = 0; k < diffs.length; k += 2) {
          const d = diffs[k];
          if (d > talus) {
            const share = move * (d / total);
            h[i] -= share;
            h[diffs[k + 1]] += share;
          }
        }
      }
    }
  }
  return h;
}

// Droplet-based hydraulic erosion (lightweight, deterministic via injected rng).
export function hydraulicErosion(h, size, {
  droplets = 4000, maxSteps = 30, inertia = 0.05,
  capacity = 4.0, deposition = 0.1, erosion = 0.15, rng = Math.random,
} = {}) {
  const n = size;
  const at = (x, y) => h[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  for (let d = 0; d < droplets; d++) {
    let x = 1 + rng() * (n - 3);
    let y = 1 + rng() * (n - 3);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let s = 0; s < maxSteps; s++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const gx = at(ix + 1, iy) - at(ix - 1, iy);
      const gy = at(ix, iy + 1) - at(ix, iy - 1);
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) break;
      dx /= len; dy /= len;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx > n - 2 || ny < 1 || ny > n - 2) break;
      const dh = at(Math.floor(nx), Math.floor(ny)) - at(ix, iy);
      const cap = Math.max(-dh, 0.001) * speed * water * capacity;
      if (sediment > cap || dh > 0) {
        const amount = dh > 0 ? Math.min(sediment, dh) : (sediment - cap) * deposition;
        sediment -= amount;
        h[iy * n + ix] += amount;
      } else {
        const amount = Math.min((cap - sediment) * erosion, -dh + 0.001);
        sediment += amount;
        h[iy * n + ix] -= amount;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + (-dh) * 4));
      water *= 0.99;
      x = nx; y = ny;
    }
  }
  return h;
}
