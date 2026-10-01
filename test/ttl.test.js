
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-ttl-cache';

describe('Issue #3: RFC 9111 Cache-Control TTL & 304 Revalidation', () => {
  let mockOriginServer;
  let originCallCount = 0;
  let conditionalReceived = false;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        originCallCount++;
        const ifNoneMatch = req.headers.get('if-none-match');

        // Check if conditional revalidation request
        if (ifNoneMatch === '"etag_v1"') {
          conditionalReceived = true;
          return new Response(null, { status: 304 });
        }

        return Response.json({
          version: '1.0',
          data: 'heavy_payload'
        }, {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=1',
            'ETag': '"etag_v1"'
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

  test('Freshness TTL and conditional 304 revalidation flow', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR
    });

    try {
      // 1. Initial request: MISS
      const res1 = await fetch(`http://localhost:${proxy.server.port}/resource`);
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-cache')).toBe('MISS');
      const body1 = await res1.json();
      expect(body1.version).toBe('1.0');
      expect(originCallCount).toBe(1);

      // 2. Immediate second request: HIT (within 1s max-age)
      const res2 = await fetch(`http://localhost:${proxy.server.port}/resource`);
      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-cache')).toBe('HIT');
      expect(originCallCount).toBe(1); // origin not contacted

      // 3. Wait for max-age (1s) to expire
      await Bun.sleep(1100);

      // 4. Request when stale: should trigger 304 revalidation and return X-Cache: REVALIDATED
      const res3 = await fetch(`http://localhost:${proxy.server.port}/resource`);
      expect(res3.status).toBe(200);
      expect(res3.headers.get('x-cache')).toBe('REVALIDATED');
      const body3 = await res3.json();
      expect(body3.version).toBe('1.0');
      expect(conditionalReceived).toBe(true);
      expect(originCallCount).toBe(2);
    } finally {
      proxy.server.stop(true);
    }
  });
});
