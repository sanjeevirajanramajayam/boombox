
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-swr-cache';

describe('Issue #8: RFC 5861 stale-while-revalidate Background Revalidation', () => {
  let mockOriginServer;
  let originUrl;
  let version = 1;

  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({ version, timestamp: Date.now() }, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=1, stale-while-revalidate=3'
          }
        });
      }
    });

    originUrl = `http://localhost:${mockOriginServer.port}`;
  });

  afterAll(() => {
    if (mockOriginServer) mockOriginServer.stop(true);
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  test('Immediately serves stale content with X-Cache: STALE while updating in background', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR
    });

    try {
      const proxyUrl = `http://localhost:${proxy.server.port}`;

      // 1. Initial request -> MISS (version 1)
      const res1 = await fetch(`${proxyUrl}/feed`);
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-cache')).toBe('MISS');
      const body1 = await res1.json();
      expect(body1.version).toBe(1);

      // 2. Wait 1100ms for max-age=1 to expire (now within stale-while-revalidate=3 window)
      await new Promise(r => setTimeout(r, 1100));

      // Upstream origin updates to version 2
      version = 2;

      // 3. Request 2: Must immediately serve STALE version 1 without waiting for origin!
      const t0 = performance.now();
      const res2 = await fetch(`${proxyUrl}/feed`);
      const elapsedMs = performance.now() - t0;

      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-cache')).toBe('STALE');
      expect(elapsedMs).toBeLessThan(50);
      const body2 = await res2.json();
      expect(body2.version).toBe(1); // Stale version served immediately

      // 4. Wait 100ms for background revalidation to complete
      await new Promise(r => setTimeout(r, 100));

      // 5. Request 3: Must now return the freshly revalidated version 2 as a fresh HIT!
      const res3 = await fetch(`${proxyUrl}/feed`);
      expect(res3.status).toBe(200);
      expect(res3.headers.get('x-cache')).toBe('HIT');
      const body3 = await res3.json();
      expect(body3.version).toBe(2);
    } finally {
      proxy.server.stop(true);
    }
  });
});
