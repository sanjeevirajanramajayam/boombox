// [WHY]: Validates VCR Service Virtualization per Boombox specification and Martin Fowler's
//        deterministic testing principles. Tests verify 100% offline isolation by killing origin servers.
// [HOW]: Creates a live mock origin server, records interactions into a cassette file, kills the origin,
//        and validates that offline replay serves byte-identical responses over real loopback sockets.
// [INVARIANTS/WHEN]: In replay mode, requests must succeed even when the origin server is unreachable or dead.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CASSETTES_DIR = '.test-cassettes';

describe('Boombox VCR Mode (Service Virtualization & Cassettes)', () => {
  let mockOriginServer;
  let originCallCount = 0;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CASSETTES_DIR)) {
      rmSync(TEST_CASSETTES_DIR, { recursive: true, force: true });
    }

    // Ephemeral mock origin server
    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        originCallCount++;
        const url = new URL(req.url);

        if (url.pathname === '/user/profile') {
          return Response.json({
            id: 'usr_123',
            name: 'Ada Lovelace',
            role: 'System Architect',
            callCount: originCallCount
          });
        }

        if (url.pathname === '/billing/invoice') {
          return Response.json({
            invoiceId: 'inv_999',
            amount: 4200,
            status: 'paid'
          });
        }

        return new Response('Not Found', { status: 404 });
      }
    });

    originUrl = `http://localhost:${mockOriginServer.port}`;
  });

  afterAll(() => {
    if (mockOriginServer) mockOriginServer.stop(true);
    if (existsSync(TEST_CASSETTES_DIR)) {
      rmSync(TEST_CASSETTES_DIR, { recursive: true, force: true });
    }
  });

  test('VCR Record Mode: forwards to live origin, attaches X-Cache: RECORD, and writes cassette', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cassette: 'test-tape',
      cassetteDir: TEST_CASSETTES_DIR,
      mode: 'record'
    });

    try {
      const res = await fetch(`http://localhost:${proxy.server.port}/user/profile`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-cache')).toBe('RECORD');

      const data = await res.json();
      expect(data.name).toBe('Ada Lovelace');
      expect(proxy.vcr.count()).toBe(1);
    } finally {
      proxy.server.stop(true);
    }
  });

  test('VCR Offline Replay: serves responses with X-Cache: REPLAY even when origin is completely offline', async () => {
    // 1. Terminate the mock origin server completely to simulate network partition / offline airplane mode!
    mockOriginServer.stop(true);

    // 2. Start proxy in REPLAY mode without origin URL
    const proxy = createProxyServer({
      port: 0,
      cassette: 'test-tape',
      cassetteDir: TEST_CASSETTES_DIR,
      mode: 'replay'
    });

    try {
      const res = await fetch(`http://localhost:${proxy.server.port}/user/profile`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-cache')).toBe('REPLAY');

      const data = await res.json();
      expect(data.id).toBe('usr_123');
      expect(data.name).toBe('Ada Lovelace');
    } finally {
      proxy.server.stop(true);
    }
  });

  test('VCR Replay Mode: unrecorded route fails fast with 502 Bad Gateway and informative JSON', async () => {
    const proxy = createProxyServer({
      port: 0,
      cassette: 'test-tape',
      cassetteDir: TEST_CASSETTES_DIR,
      mode: 'replay'
    });

    try {
      const res = await fetch(`http://localhost:${proxy.server.port}/unrecorded/route`);
      expect(res.status).toBe(502);
      expect(res.headers.get('x-cache')).toBe('MISS');

      const err = await res.json();
      expect(err.error).toBe('Cassette interaction not found in replay mode');
      expect(err.url).toBe('/unrecorded/route');
    } finally {
      proxy.server.stop(true);
    }
  });

  test('VCR Auto Mode: replays recorded routes and records new ones', async () => {
    // Restart mock origin server for auto recording
    const liveOrigin = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/billing/invoice') {
          return Response.json({ invoiceId: 'inv_999', amount: 4200 });
        }
        return new Response('Not Found', { status: 404 });
      }
    });

    const proxy = createProxyServer({
      port: 0,
      origin: `http://localhost:${liveOrigin.port}`,
      cassette: 'test-tape',
      cassetteDir: TEST_CASSETTES_DIR,
      mode: 'auto'
    });

    try {
      // 1. Existing route should REPLAY
      const res1 = await fetch(`http://localhost:${proxy.server.port}/user/profile`);
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-cache')).toBe('REPLAY');

      // 2. New route should RECORD
      const res2 = await fetch(`http://localhost:${proxy.server.port}/billing/invoice`);
      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-cache')).toBe('RECORD');
      const invoice = await res2.json();
      expect(invoice.invoiceId).toBe('inv_999');

      // 3. Second call to new route should now REPLAY
      const res3 = await fetch(`http://localhost:${proxy.server.port}/billing/invoice`);
      expect(res3.status).toBe(200);
      expect(res3.headers.get('x-cache')).toBe('REPLAY');
    } finally {
      liveOrigin.stop(true);
      proxy.server.stop(true);
    }
  });
});
