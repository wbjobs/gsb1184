// Fly camera with terrain-bounds clamping (相机越界处理).

export class Camera {
  constructor({ worldSize = 8192, heightScale = 600 } = {}) {
    this.worldSize = worldSize;
    this.heightScale = heightScale;
    this.pos = { x: worldSize / 2, y: worldSize / 2, z: heightScale * 1.5 };
    this.yaw = 0;          // radians, around Z (up)
    this.pitch = -0.5;     // radians, look-down
    this.speed = 400;      // units / second
    this.minClearance = 8; // min height above terrain
    this.fov = Math.PI / 3;
    this.terrainHeightAt = null; // optional fn(x, y) -> world height
  }

  // input: { forward, back, left, right, up, down } booleans; look: {dx, dy}
  update(dt, input, look) {
    if (look) {
      this.yaw -= look.dx * 0.0025;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - look.dy * 0.0025));
    }
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwd = { x: cp * cy, y: cp * sy, z: sp };
    const right = { x: -sy, y: cy, z: 0 };
    const boost = input.boost ? 4 : 1;
    const v = this.speed * boost * dt;
    if (input.forward) { this.pos.x += fwd.x * v; this.pos.y += fwd.y * v; this.pos.z += fwd.z * v; }
    if (input.back) { this.pos.x -= fwd.x * v; this.pos.y -= fwd.y * v; this.pos.z -= fwd.z * v; }
    if (input.left) { this.pos.x -= right.x * v; this.pos.y -= right.y * v; }
    if (input.right) { this.pos.x += right.x * v; this.pos.y += right.y * v; }
    if (input.up) this.pos.z += v;
    if (input.down) this.pos.z -= v;
    this.clamp();
  }

  // Keep the camera inside the world and above the terrain.
  clamp() {
    const m = 1; // margin
    this.pos.x = Math.max(m, Math.min(this.worldSize - m, this.pos.x));
    this.pos.y = Math.max(m, Math.min(this.worldSize - m, this.pos.y));
    const ceiling = this.heightScale * 4;
    let floor = -this.heightScale * 0.5;
    if (this.terrainHeightAt) {
      floor = this.terrainHeightAt(this.pos.x, this.pos.y) + this.minClearance;
    }
    this.pos.z = Math.max(floor, Math.min(ceiling, this.pos.z));
  }

  viewMatrix() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const f = { x: cp * cy, y: cp * sy, z: sp };
    const r = norm3({ x: -sy, y: cy, z: 0 });
    const u = cross3(r, f);
    // Row-major -> column-major for WebGL.
    return new Float32Array([
      r.x, u.x, -f.x, 0,
      r.y, u.y, -f.y, 0,
      r.z, u.z, -f.z, 0,
      -dot3(r, this.pos), -dot3(u, this.pos), dot3(f, this.pos), 1,
    ]);
  }

  projMatrix(aspect, near = 1, far = 40000) {
    const f = 1 / Math.tan(this.fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }
}

function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross3(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm3(a) { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }
