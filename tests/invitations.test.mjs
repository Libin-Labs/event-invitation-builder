import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildInvitations } from '../dist/esm/index.js';

const guests = [
  {
    id: 'g1',
    name: '<Ada>',
    email: 'ada@example.test',
    eventName: 'Launch',
    eventDate: 'Friday',
    url: 'https://example.test/i/1?a=1&b=2',
  },
  {
    id: 'g2',
    name: 'Lin',
    email: 'lin@example.test',
    eventName: 'Launch',
    eventDate: 'Friday',
    url: 'https://example.test/i/2',
  },
];
const template = '<h1>Hello {{name}}</h1><p>{{eventName}} · {{eventDate}}</p>';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=';

test('binds per-guest values safely and preserves result order', async () => {
  const batch = await buildInvitations(guests, { template });
  assert.equal(batch.cancelled, false);
  assert.deepEqual(
    batch.results.map((result) => result.guestId),
    ['g1', 'g2'],
  );
  assert.equal(batch.results[0].status, 'ready');
  assert.match(batch.results[0].html, /&lt;Ada&gt;/);
  assert.doesNotMatch(batch.results[0].html, /<h1>Hello <Ada>/);
  assert.match(batch.results[0].html, /href="https:\/\/example\.test\/i\/1\?a=1&amp;b=2"/);
  assert.equal(batch.results[1].status, 'ready');
});

test('uses only injected bounded PNG QR output and records adapter failures per guest', async () => {
  const qrCode = {
    async generate(url, context) {
      assert.match(url, /^https:/);
      assert.equal(typeof context.guestId, 'string');
      if (context.guestId === 'g2') throw new Error('provider unavailable');
      return `data:image/png;base64,${Buffer.from('not a real QR').toString('base64')}`;
    },
  };
  const batch = await buildInvitations(guests, { template, qrCode, concurrency: 1 });
  assert.equal(batch.results[0].status, 'error');
  assert.match(batch.results[0].error, /PNG data URL/);
  assert.deepEqual(batch.results[1], {
    guestId: 'g2',
    status: 'error',
    error: 'provider unavailable',
  });
  const goodQr = {
    async generate() {
      return png;
    },
  };
  const good = await buildInvitations([guests[0]], { template, qrCode: goodQr });
  assert.equal(good.results[0].status, 'ready');
  assert.match(good.results[0].html, /<img alt="Invitation QR code"/);
});

test('limits concurrent asynchronous QR work and keeps errors isolated', async () => {
  let active = 0;
  let maximum = 0;
  const qrCode = {
    async generate() {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
      return png;
    },
  };
  const batch = await buildInvitations(guests, { template, qrCode, concurrency: 1 });
  assert.equal(maximum, 1);
  assert.ok(batch.results.every((result) => result.status === 'ready'));
});

test('cancellation marks pending and adapter-aborted work explicitly', async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = await buildInvitations(guests, { template, signal: controller.signal });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(
    cancelled.results.map((result) => result.status),
    ['cancelled', 'cancelled'],
  );
  const active = new AbortController();
  const adapter = {
    async generate(_url, { signal }) {
      active.abort();
      assert.equal(signal.aborted, true);
      return `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    },
  };
  const result = await buildInvitations(guests, {
    template,
    signal: active.signal,
    qrCode: adapter,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.results[0].status, 'cancelled');
  assert.equal(result.results[1].status, 'cancelled');
});

test('rejects unknown bindings, unsafe URLs, duplicates, and excessive batch limits', async () => {
  await assert.rejects(
    buildInvitations(guests, { template: '{{admin}}' }),
    /Unknown invitation placeholder/,
  );
  await assert.rejects(
    buildInvitations([{ ...guests[0], url: 'javascript:alert(1)' }], { template }),
    /HTTPS/,
  );
  await assert.rejects(buildInvitations([guests[0], guests[0]], { template }), /unique safe/);
  await assert.rejects(buildInvitations(guests, { template, concurrency: 33 }), /concurrency/);
  await assert.rejects(buildInvitations([{ ...guests[0], email: 'nope' }], { template }), /email/);
  await assert.rejects(buildInvitations(guests, { template: 'x'.repeat(10_001) }), /template/);
  await assert.rejects(buildInvitations(Array(2_001).fill(guests[0]), { template }), /guest count/);
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.equal(typeof cjs.buildInvitations, 'function');
});
