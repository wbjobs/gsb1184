// VRAM budget manager: tracks GPU resource bytes, evicts LRU tiles,
// and escalates to degraded (single-LOD) mode when the budget cannot be met.

export class MemoryManager {
  constructor({ budgetBytes = 256 * 1024 * 1024 } = {}) {
    this.budget = budgetBytes;
    this.used = 0;
    this.entries = new Map(); // key -> { bytes, lastUsed }
    this.degraded = false;
    this._tick = 0;
    this.listeners = new Set();
  }

  onDegrade(fn) { this.listeners.add(fn); }

  _emit() { for (const fn of this.listeners) fn(this.degraded); }

  setBudget(bytes) {
    this.budget = bytes;
    this.enforce();
    // Recover only when the budget was raised and usage is comfortably below
    // it (hysteresis — avoids degrade/recover oscillation).
    if (this.degraded && this.used < this.budget * 0.6) {
      this.degraded = false;
      this._emit();
    }
  }

  // Register a GPU allocation. Returns evicted keys.
  alloc(key, bytes) {
    if (this.entries.has(key)) this.free(key);
    this.entries.set(key, { bytes, lastUsed: ++this._tick });
    this.used += bytes;
    return this.enforce();
  }

  touch(key) {
    const e = this.entries.get(key);
    if (e) e.lastUsed = ++this._tick;
  }

  free(key) {
    const e = this.entries.get(key);
    if (!e) return 0;
    this.entries.delete(key);
    this.used -= e.bytes;
    return e.bytes;
  }

  // Evict LRU entries until under budget. Returns evicted keys.
  enforce() {
    const evicted = [];
    if (this.used <= this.budget) return evicted;
    // Evict LRU first, but never the newest entry — if that alone exceeds the
    // budget we degrade instead of evicting the tile we just built.
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    sorted.pop();
    for (const [key, e] of sorted) {
      if (this.used <= this.budget) break;
      this.entries.delete(key);
      this.used -= e.bytes;
      evicted.push(key);
    }
    // Still over budget after evicting everything evictable -> degrade to single LOD.
    if (this.used > this.budget && !this.degraded) {
      this.degraded = true;
      this._emit();
    }
    return evicted;
  }

  get usageMB() { return this.used / (1024 * 1024); }
  get budgetMB() { return this.budget / (1024 * 1024); }
}

// Byte estimate for one terrain tile (heightmap texture + geometry buffers).
export function tileBytes(res) {
  const tex = res * res * 4;                 // RGBA8 height texture
  const verts = res * res * 4 * 4;           // position+normal+uv+skirt flag (float32 x4 each)
  const idx = (res - 1) * (res - 1) * 6 * 2; // uint16 indices
  const skirt = res * 4 * 4 * 4 + res * 4 * 6 * 2;
  return tex + verts + idx + skirt;
}
