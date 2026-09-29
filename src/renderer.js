// WebGL renderer: one program, per-tile interleaved buffers, Lambert + height tint.
import { buildTileGeometry } from './geometry.js';

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMVP;
varying vec3 vNormal;
varying float vHeight;
void main() {
  vNormal = aNormal;
  vHeight = aPos.z;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
varying float vHeight;
uniform vec3 uLightDir;
uniform float uHeightScale;
uniform vec3 uTint;
uniform float uDebugLod;
void main() {
  float t = clamp(vHeight / uHeightScale, 0.0, 1.0);
  vec3 low = vec3(0.18, 0.35, 0.16);
  vec3 mid = vec3(0.45, 0.38, 0.28);
  vec3 high = vec3(0.9, 0.9, 0.92);
  vec3 base = t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, (t - 0.5) * 2.0);
  base = mix(base, uTint, uDebugLod);
  float diff = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  vec3 col = base * (0.35 + 0.65 * diff);
  gl_FragColor = vec4(col, 1.0);
}`;

const LOD_COLORS = [
  [0.9, 0.2, 0.2], [0.9, 0.6, 0.1], [0.9, 0.9, 0.2],
  [0.2, 0.9, 0.3], [0.2, 0.6, 0.9], [0.6, 0.3, 0.9], [0.9, 0.3, 0.8],
];

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;
    this.uint32 = gl.getExtension('OES_element_index_uint');
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._initProgram(); });

    this._initProgram();
    this.tiles = new Map(); // key -> { vbo, ibo, indexCount, x, y, size, level }
    this.heightScale = 600;
    this.debugLod = 0;
  }

  _initProgram() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aNormal = gl.getAttribLocation(prog, 'aNormal');
    this.uMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uLightDir = gl.getUniformLocation(prog, 'uLightDir');
    this.uHeightScale = gl.getUniformLocation(prog, 'uHeightScale');
    this.uTint = gl.getUniformLocation(prog, 'uTint');
    this.uDebugLod = gl.getUniformLocation(prog, 'uDebugLod');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0.53, 0.75, 0.95, 1);
  }

  // Upload a generated tile. Returns GPU byte estimate.
  addTile(key, node, heights, res, skirtDepth) {
    const gl = this.gl;
    this.removeTile(key);
    const geo = buildTileGeometry({
      x: node.x, y: node.y, size: node.size, res, heights, skirtDepth,
    });
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    this.tiles.set(key, {
      vbo, ibo, indexCount: geo.indexCount,
      level: node.level, bytes: geo.verts.byteLength + geo.idx.byteLength,
    });
    return this.tiles.get(key).bytes;
  }

  removeTile(key) {
    const t = this.tiles.get(key);
    if (!t) return 0;
    this.gl.deleteBuffer(t.vbo);
    this.gl.deleteBuffer(t.ibo);
    this.tiles.delete(key);
    return t.bytes;
  }

  render(view, proj) {
    const gl = this.gl;
    if (this.lost) return;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform3f(this.uLightDir, 0.5, 0.4, 0.75);
    gl.uniform1f(this.uHeightScale, this.heightScale);
    gl.uniform1f(this.uDebugLod, this.debugLod);
    const mvp = multiply4(proj, view);
    gl.uniformMatrix4fv(this.uMVP, false, mvp);
    for (const [key, t] of this.tiles) {
      gl.bindBuffer(gl.ARRAY_BUFFER, t.vbo);
      gl.enableVertexAttribArray(this.aPos);
      gl.enableVertexAttribArray(this.aNormal);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, t.ibo);
      const tint = LOD_COLORS[t.level % LOD_COLORS.length];
      gl.uniform3f(this.uTint, tint[0], tint[1], tint[2]);
      gl.drawElements(gl.TRIANGLES, t.indexCount,
        this.uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }
  }
}

function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}
