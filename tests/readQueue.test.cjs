const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
let createReadQueue;
test.before(async () => {
  const source = stripTypeScriptTypes(fs.readFileSync('frontend/src/readQueue.ts', 'utf8'));
  ({ createReadQueue } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  ));
});
test('a burst of workspace reads respects a constrained server and delivers every result', async () => {
  const read = createReadQueue(2);
  let active = 0,
    peak = 0;
  const values = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      read(async () => {
        active++;
        peak = Math.max(peak, active);
        if (active > 2) throw new Error('Local server connection backlog exceeded');
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return index;
      }),
    ),
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(
    values,
    Array.from({ length: 40 }, (_, i) => i),
  );
});
test('a rejected read releases capacity without retrying or blocking other requests', async () => {
  const read = createReadQueue(1);
  let calls = 0;
  const first = read(async () => {
    calls++;
    throw new Error('Unknown source');
  });
  const second = read(async () => 42);
  await assert.rejects(first, /Unknown source/);
  assert.equal(await second, 42);
  assert.equal(calls, 1);
  assert.throws(() => createReadQueue(0), RangeError);
});
test('closing tabs cancels queued reads; cancelling an active read cannot overbook the server', async () => {
  const read = createReadQueue(1),
    active = new AbortController(),
    queued = new AbortController();
  let release,
    started = 0;
  const first = read(() => {
    started++;
    return new Promise((resolve) => {
      release = resolve;
    });
  }, active.signal);
  const dropped = read(async () => {
    throw new Error('Closed tab reached the server');
  }, queued.signal);
  const next = read(async () => {
    started++;
    return 'next';
  });
  await new Promise((resolve) => setImmediate(resolve));
  queued.abort();
  active.abort();
  await assert.rejects(dropped, { name: 'AbortError' });
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(started, 1);
  release('finished');
  assert.equal(await next, 'next');
  assert.equal(started, 2);
});
