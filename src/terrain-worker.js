// Web Worker: generates terrain tiles off the main thread.
// Receives { id, params }, responds { id, heights: ArrayBuffer } (transferred).
import { generateTile } from './terrain-gen.js';

self.onmessage = (e) => {
  const { id, params } = e.data;
  const heights = generateTile(params);
  self.postMessage({ id, heights: heights.buffer }, [heights.buffer]);
};
