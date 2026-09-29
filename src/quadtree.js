// Restricted quadtree for terrain LOD. Pure logic — no WebGL — so it is unit-testable.
//
// - Screen-space-error driven split/merge.
// - Restricted: neighbor level difference <= 1 (keeps cracks stitchable).
// - Incremental: update() returns diffs (toLoad / toUnload) instead of rebuilding.

export class TerrainQuadtree {
  constructor({
    worldSize = 8192,
    maxLevel = 6,
    heightScale = 600,
    // Split when geometric error projected on screen exceeds this many pixels.
    errorThresholdPx = 2.0,
    // screenHeightPx / (2 * tan(fov/2)) — set per-frame via setProjection.
    projFactor = 1080,
  } = {}) {
    this.worldSize = worldSize;
    this.maxLevel = maxLevel;
    this.heightScale = heightScale;
    this.errorThresholdPx = errorThresholdPx;
    this.projFactor = projFactor;
    this.forceLevel = null; // degradation: pin all leaves to a single level
    this.root = this._makeNode(0, 0, 0, worldSize);
    this._leaves = []; // empty so the first update() diffs correctly
  }

  _makeNode(level, x, y, size) {
    return { level, x, y, size, children: null, key: `${level}:${x}:${y}` };
  }

  setProjection(screenHeightPx, fovRadians) {
    this.projFactor = screenHeightPx / (2 * Math.tan(fovRadians / 2));
  }

  // Geometric error of a node in world units. Calibrated so that, with the
  // default projection, a node splits when the camera is within ~2x its size.
  nodeError(level) {
    return this.heightScale * 0.05 / (1 << level);
  }

  // Should this node split given a camera position?
  shouldSplit(node, cam) {
    if (this.forceLevel !== null) return node.level < this.forceLevel;
    if (node.level >= this.maxLevel) return false;
    const cx = node.x + node.size / 2, cy = node.y + node.size / 2;
    const dx = cx - cam.x, dy = cy - cam.y, dz = -cam.z;
    const dist = Math.max(1e-3, Math.hypot(dx, dy, dz) - node.size * 0.5);
    const screenErr = (this.nodeError(node.level) / dist) * this.projFactor;
    return screenErr > this.errorThresholdPx;
  }

  // Recompute the leaf set for a camera position. Returns { toLoad, toUnload, leaves }.
  update(cam) {
    const desired = [];
    const collect = (node) => {
      if (this.shouldSplit(node, cam)) {
        const h = node.size / 2;
        if (!node.children) {
          node.children = [
            this._makeNode(node.level + 1, node.x, node.y, h),
            this._makeNode(node.level + 1, node.x + h, node.y, h),
            this._makeNode(node.level + 1, node.x, node.y + h, h),
            this._makeNode(node.level + 1, node.x + h, node.y + h, h),
          ];
        }
        for (const c of node.children) collect(c);
      } else {
        node.children = null; // merge: drop subtree
        desired.push(node);
      }
    };
    collect(this.root);
    this._enforceRestriction();
    const leaves = [];
    this._collectLeaves(this.root, leaves);

    const prevKeys = new Set(this._leaves.map((n) => n.key));
    const nextKeys = new Set(leaves.map((n) => n.key));
    const toLoad = leaves.filter((n) => !prevKeys.has(n.key));
    const toUnload = this._leaves.filter((n) => !nextKeys.has(n.key));
    this._leaves = leaves;
    return { toLoad, toUnload, leaves };
  }

  // Split nodes until no leaf has a neighbor more than 1 level finer.
  _enforceRestriction() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 64) {
      changed = false;
      const leaves = [];
      this._collectLeaves(this.root, leaves);
      const byKey = new Map();
      const keyOf = (level, x, y) => `${level}:${x}:${y}`;
      for (const n of leaves) byKey.set(keyOf(n.level, n.x, n.y), n);
      const step = (l) => this.worldSize / (1 << l);
      for (const n of leaves) {
        const s = step(n.level);
        const neighbors = [
          [n.x - s, n.y], [n.x + s, n.y], [n.x, n.y - s], [n.x, n.y + s],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= this.worldSize || ny >= this.worldSize) continue;
          // Find leaf covering (nx, ny) — may be coarser; walk up levels.
          let lvl = n.level;
          while (lvl >= 0) {
            const ls = step(lvl);
            const k = keyOf(lvl, Math.floor(nx / ls) * ls, Math.floor(ny / ls) * ls);
            const found = byKey.get(k);
            if (found) {
              if (n.level - found.level > 1) {
                this._splitLeaf(found);
                changed = true;
              }
              break;
            }
            lvl--;
          }
        }
        if (changed) break;
      }
    }
  }

  _splitLeaf(node) {
    const h = node.size / 2;
    node.children = [
      this._makeNode(node.level + 1, node.x, node.y, h),
      this._makeNode(node.level + 1, node.x + h, node.y, h),
      this._makeNode(node.level + 1, node.x, node.y + h, h),
      this._makeNode(node.level + 1, node.x + h, node.y + h, h),
    ];
  }

  _collectLeaves(node, out) {
    if (!node.children) { out.push(node); return; }
    for (const c of node.children) this._collectLeaves(c, out);
  }

  get leaves() { return this._leaves; }

  // Neighbor level for each of the 4 edges of a leaf (for stitching/skirts).
  // edges: 0=west 1=east 2=north 3=south. Returns array of 4 levels (own level if off-world).
  neighborLevels(leaf) {
    const leaves = this._leaves;
    const s = leaf.size;
    const result = [leaf.level, leaf.level, leaf.level, leaf.level];
    const pts = [
      [leaf.x - 1, leaf.y + s / 2],
      [leaf.x + s + 1, leaf.y + s / 2],
      [leaf.x + s / 2, leaf.y - 1],
      [leaf.x + s / 2, leaf.y + s + 1],
    ];
    for (let e = 0; e < 4; e++) {
      const [px, py] = pts[e];
      if (px < 0 || py < 0 || px >= this.worldSize || py >= this.worldSize) continue;
      for (const n of leaves) {
        if (px >= n.x && px < n.x + n.size && py >= n.y && py < n.y + n.size) {
          result[e] = n.level;
          break;
        }
      }
    }
    return result;
  }
}
