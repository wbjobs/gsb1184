import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryManager, tileBytes } from '../src/memory.js';

test('LRU eviction keeps usage under budget (显存不足)', () => {
  const mm = new MemoryManager({ budgetBytes: 1000 });
  mm.alloc('a', 400);
  mm.alloc('b', 400);
  mm.touch('a'); // b is now LRU
  const evicted = mm.alloc('c', 400);
  assert.deepEqual(evicted, ['b']);
  assert.ok(mm.used <= 1000);
});

test('degrades when budget cannot be met, recovers when possible', () => {
  const mm = new MemoryManager({ budgetBytes: 100 });
  let events = [];
  mm.onDegrade((d) => events.push(d));
  mm.alloc('big', 500); // single alloc exceeds budget, nothing else to evict
  assert.equal(mm.degraded, true);
  assert.deepEqual(events, [true]);
  mm.free('big');
  mm.alloc('small', 10);
  assert.equal(mm.degraded, true); // no auto-recover: hysteresis
  mm.setBudget(1000); // recover only when budget is raised with headroom
  assert.equal(mm.degraded, false);
  assert.deepEqual(events, [true, false]);
});

test('tileBytes scales with resolution', () => {
  assert.ok(tileBytes(65) > tileBytes(33));
  assert.ok(tileBytes(33) > 0);
});
