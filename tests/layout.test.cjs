const test = require('node:test');
const assert = require('node:assert/strict');

test('Barnes-Hut layout is finite, deterministic, respects pins and missing edges', async () => {
  const { createLayout } = await import('../frontend/src/layout.mjs');
  const nodes = Array.from({ length: 500 }, (_, i) => ({ id: String(i), kind: i % 4 ? 'domain' : 'artifact', weight: 1 }));
  const edges = nodes.slice(1).map((_, i) => ({ source: String(Math.floor(i / 4)), target: String(i + 1), relation: 'mentions' }));
  edges.push({ source: 'missing', target: '0', relation: 'mentions' });
  const a = createLayout(nodes, edges), b = createLayout(nodes, edges);
  a.step(40); b.step(40);
  assert.deepEqual(a.positions, b.positions);
  assert.ok(a.positions.every(Number.isFinite));
  a.pin('10', 100, -200); a.step(30);
  assert.equal(a.positions[20], 100); assert.equal(a.positions[21], -200);
  a.unpin('10'); a.step(3); assert.notEqual(a.positions[20], 100);
});
test('Empty and single-node layouts are stable', async () => {
  const { createLayout } = await import('../frontend/src/layout.mjs');
  assert.equal(createLayout([], []).step(10).length, 0);
  assert.ok(createLayout([{ id: 'a' }], []).step(50).every(Number.isFinite));
});
