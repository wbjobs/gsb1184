// Performance monitoring: PerformanceObserver (longtask) + frame timing stats.
// Powers the quantifiable A/B comparison (LOD on/off, worker on/off, erosion on/off).

export class PerfMonitor {
  constructor() {
    this.frames = [];        // recent frame times (ms)
    this.maxSamples = 240;
    this.longTasks = 0;      // >50ms main-thread tasks observed
    this.lastLongTaskAt = 0;
    this._last = 0;
    this._observer = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this._observer = new PerformanceObserver((list) => {
          for (const _ of list.getEntries()) {
            this.longTasks++;
            this.lastLongTaskAt = performance.now();
          }
        });
        this._observer.observe({ entryTypes: ['longtask'] });
      } catch { /* longtask unsupported (e.g. Firefox) — frame stats still work */ }
    }
  }

  beginFrame() { this._last = performance.now(); }

  endFrame() {
    const dt = performance.now() - this._last;
    this.frames.push(dt);
    if (this.frames.length > this.maxSamples) this.frames.shift();
    return dt;
  }

  get stats() {
    if (!this.frames.length) return { avg: 0, p95: 0, fps: 0 };
    const sorted = [...this.frames].sort((a, b) => a - b);
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
    return { avg, p95, fps: avg > 0 ? 1000 / avg : 0 };
  }

  reset() { this.frames = []; this.longTasks = 0; }

  // Snapshot for the comparison report.
  report(extra = {}) {
    const s = this.stats;
    return {
      timestamp: new Date().toISOString(),
      fps: +s.fps.toFixed(1),
      frameAvgMs: +s.avg.toFixed(2),
      frameP95Ms: +s.p95.toFixed(2),
      longTasks: this.longTasks,
      ...extra,
    };
  }
}
