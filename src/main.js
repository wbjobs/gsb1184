// Bootstrap & orchestration: quadtree LOD + worker tile generation + cache + VRAM budget.
import { TerrainQuadtree } from './quadtree.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { MemoryManager, tileBytes } from './memory.js';
import { TileCache } from './cache.js';
import { PerfMonitor } from './perf.js';
import { generateTile } from './terrain-gen.js';

const CONFIG = {
  worldSize: 8192,
  heightScale: 600,
  maxLevel: 5,
  tileRes: 33,
  seed: 1337,
  vramBudgetMB: 128,
};

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const renderer = new Renderer(canvas);
renderer.heightScale = CONFIG.heightScale;

const quadtree = new TerrainQuadtree({
  worldSize: CONFIG.worldSize,
  maxLevel: CONFIG.maxLevel,
  heightScale: CONFIG.heightScale,
});
const camera = new Camera({ worldSize: CONFIG.worldSize, heightScale: CONFIG.heightScale });
const memory = new MemoryManager({ budgetBytes: CONFIG.vramBudgetMB * 1024 * 1024 });
const cache = new TileCache();
const perf = new PerfMonitor();

const state = {
  useLod: true,
  useWorker: typeof Worker !== 'undefined',
  useErosion: true,
  degraded: false,
  pending: new Map(),   // key -> true (in-flight generation)
  tiles: new Map(),     // key -> { node, heights }
  reports: [],
};

// ---------- Worker pool ----------
let worker = null;
let nextJobId = 1;
const jobs = new Map();
if (state.useWorker) {
  worker = new Worker('./src/terrain-worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const { id, heights } = e.data;
    const job = jobs.get(id);
    jobs.delete(id);
    if (job) job(new Float32Array(heights));
  };
}

function requestTile(node, done) {
  const params = {
    x: node.x, y: node.y, size: node.size, res: CONFIG.tileRes,
    heightScale: CONFIG.heightScale, seed: CONFIG.seed,
    erosion: state.useErosion, worldScale: CONFIG.worldSize,
  };
  if (worker && state.useWorker) {
    const id = nextJobId++;
    jobs.set(id, done);
    worker.postMessage({ id, params });
  } else {
    // Main-thread fallback (for A/B comparison) — chunked via setTimeout to avoid hard freeze.
    setTimeout(() => done(generateTile(params)), 0);
  }
}

// ---------- Tile lifecycle ----------
function loadTile(node) {
  const key = node.key;
  if (state.tiles.has(key) || state.pending.has(key)) return;
  state.pending.set(key, true);
  const finish = (heights) => {
    state.pending.delete(key);
    if (!quadtree.leaves.some((n) => n.key === key)) return; // stale
    const bytes = renderer.addTile(key, node, heights, CONFIG.tileRes, node.size * 0.05);
    state.tiles.set(key, { node, heights });
    const evicted = memory.alloc(key, bytes || tileBytes(CONFIG.tileRes));
    for (const k of evicted) unloadTile(k);
    // If eviction removed a tile that is still a visible leaf, the budget
    // cannot hold the working set -> degrade to single LOD.
    if (!state.degraded && evicted.some((k) => quadtree.leaves.some((n) => n.key === k))) {
      setDegraded(true);
    }
  };
  cache.get(key).then((cached) => {
    if (cached) finish(new Float32Array(cached));
    else requestTile(node, (heights) => {
      cache.put(key, heights.buffer.slice(0));
      finish(heights);
    });
  });
}

function unloadTile(key) {
  const freed = renderer.removeTile(key);
  memory.free(key);
  state.tiles.delete(key);
  return freed;
}

// ---------- Degradation ----------
memory.onDegrade((degraded) => {
  state.degraded = degraded;
  if (degraded) {
    // 降级到单 LOD: pin quadtree to level 1, drop everything else.
    quadtree.forceLevel = 1;
    for (const [key, t] of state.tiles) {
      if (t.node.level !== 1) unloadTile(key);
    }
  } else {
    quadtree.forceLevel = null;
  }
});

// Manual degrade toggle (验收: 降级方案可用 — must be triggerable & recoverable).
function setDegraded(on) {
  memory.degraded = on;
  memory.onDegrade && memory._emit();
}

// ---------- Input ----------
const input = {};
const keys = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyE: 'up', KeyQ: 'down', ShiftLeft: 'boost' };
addEventListener('keydown', (e) => { if (keys[e.code]) input[keys[e.code]] = true; });
addEventListener('keyup', (e) => { if (keys[e.code]) input[keys[e.code]] = false; });
let lookDelta = null;
canvas.addEventListener('click', () => canvas.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    lookDelta = lookDelta || { dx: 0, dy: 0 };
    lookDelta.dx += e.movementX;
    lookDelta.dy += e.movementY;
  }
});

// Terrain height lookup for camera clamping (bilinear over loaded tiles).
camera.terrainHeightAt = (x, y) => {
  let best = null;
  for (const t of state.tiles.values()) {
    const n = t.node;
    if (x >= n.x && x <= n.x + n.size && y >= n.y && y <= n.y + n.size) {
      if (!best || n.level > best.node.level) best = t;
    }
  }
  if (!best) return 0;
  const n = best.node, res = CONFIG.tileRes;
  const fx = ((x - n.x) / n.size) * (res - 1);
  const fy = ((y - n.y) / n.size) * (res - 1);
  const i = Math.min(res - 2, Math.floor(fx)), j = Math.min(res - 2, Math.floor(fy));
  const u = fx - i, v = fy - j;
  const h = best.heights;
  const h00 = h[j * res + i], h10 = h[j * res + i + 1];
  const h01 = h[(j + 1) * res + i], h11 = h[(j + 1) * res + i + 1];
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
};

// ---------- HUD / controls ----------
function bindToggle(id, get, set) {
  const el = document.getElementById(id);
  el.checked = get();
  el.addEventListener('change', () => { set(el.checked); perf.reset(); });
}
bindToggle('opt-lod', () => state.useLod, (v) => {
  state.useLod = v;
  quadtree.forceLevel = v ? (state.degraded ? 1 : null) : 0;
});
bindToggle('opt-worker', () => state.useWorker, (v) => { state.useWorker = v && !!worker; });
bindToggle('opt-erosion', () => state.useErosion, (v) => {
  state.useErosion = v;
  cache.clear();
  for (const key of [...state.tiles.keys()]) unloadTile(key);
});
bindToggle('opt-debuglod', () => renderer.debugLod > 0, (v) => { renderer.debugLod = v ? 0.45 : 0; });
bindToggle('opt-degrade', () => state.degraded, (v) => setDegraded(v));

document.getElementById('opt-budget').addEventListener('change', (e) => {
  memory.setBudget(+e.target.value * 1024 * 1024);
});
document.getElementById('btn-report').addEventListener('click', () => {
  const r = perf.report({
    lod: state.useLod, worker: state.useWorker, erosion: state.useErosion,
    degraded: state.degraded, tiles: state.tiles.size,
    vramMB: +memory.usageMB.toFixed(1),
  });
  state.reports.push(r);
  const blob = new Blob([JSON.stringify(state.reports, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'terrain-perf-report.json';
  a.click();
});

// ---------- Main loop ----------
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  quadtree.setProjection(canvas.height, camera.fov);
}
addEventListener('resize', resize);
resize();

let lastT = performance.now();
function frame() {
  perf.beginFrame();
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  camera.update(dt, input, lookDelta);
  lookDelta = null;

  const camPos = { x: camera.pos.x, y: camera.pos.y, z: camera.pos.z };
  const { toLoad, toUnload } = quadtree.update(camPos);
  for (const n of toUnload) unloadTile(n.key);
  for (const n of toLoad) loadTile(n);
  // Re-request leaves whose tiles were evicted (LRU pressure) and mark the
  // rest as recently used so eviction hits stale tiles first.
  for (const n of quadtree.leaves) {
    if (state.tiles.has(n.key)) memory.touch(n.key);
    else loadTile(n);
  }

  renderer.render(camera.viewMatrix(), camera.projMatrix(canvas.width / canvas.height));

  const s = perf.stats;
  hud.textContent = [
    `FPS ${s.fps.toFixed(0)}  avg ${s.avg.toFixed(1)}ms  p95 ${s.p95.toFixed(1)}ms  longtasks ${perf.longTasks}`,
    `tiles ${state.tiles.size} (+${state.pending.size} loading)  VRAM ${memory.usageMB.toFixed(0)}/${memory.budgetMB.toFixed(0)}MB`,
    `LOD ${state.useLod ? 'on' : 'off'}  worker ${state.useWorker ? 'on' : 'off'}  erosion ${state.useErosion ? 'on' : 'off'}${state.degraded ? '  [DEGRADED: single LOD]' : ''}`,
    `pos ${camera.pos.x.toFixed(0)}, ${camera.pos.y.toFixed(0)}, ${camera.pos.z.toFixed(0)}`,
  ].join('\n');

  perf.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
