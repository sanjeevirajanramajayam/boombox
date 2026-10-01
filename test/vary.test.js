
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-vary-cache';

describe('Issue #7: RFC 9111 §4.1 Vary Header Negotiation', () => {
  let mockOriginServer;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const accept = req.headers.get('accept') || 'application/json';

        if (accept.includes('text/csv')) {
          return new Response('id,name\n1,guitar\n2,drums', {
            status: 200,
            headers: {
              'Content-Type': 'text/csv',
              'Vary': 'Accept',
              'Cache-Control': 'max-age=3600'
            }
          });
        }

        return Response.json({ items: ['guitar', 'drums'] }, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Vary': 'Accept',
            'Cache-Control': 'max-age=3600'
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

  test('Caches distinct variants independently when origin specifies Vary: Accept', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR
    });

    try {
      const proxyUrl = `http://localhost:${proxy.server.port}`;

      // 1. Request JSON variant -> MISS
      const res1 = await fetch(`${proxyUrl}/catalog`, {
        headers: { 'Accept': 'application/json' }
      });
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-cache')).toBe('MISS');
      const json1 = await res1.json();
      expect(json1.items).toEqual(['guitar', 'drums']);

      // 2. Request JSON variant again -> HIT
      const res2 = await fetch(`${proxyUrl}/catalog`, {
        headers: { 'Accept': 'application/json' }
      });
      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-cache')).toBe('HIT');

      // 3. Request CSV variant -> MUST BE MISS (different Accept header, not served from JSON cache)
      const res3 = await fetch(`${proxyUrl}/catalog`, {
        headers: { 'Accept': 'text/csv' }
      });
      expect(res3.status).toBe(200);
      expect(res3.headers.get('x-cache')).toBe('MISS');
      const csvText = await res3.text();
      expect(csvText).toContain('id,name');

      // 4. Request CSV variant again -> HIT
      const res4 = await fetch(`${proxyUrl}/catalog`, {
        headers: { 'Accept': 'text/csv' }
      });
      expect(res4.status).toBe(200);
      expect(res4.headers.get('x-cache')).toBe('HIT');

      // 5. Original JSON request still serves cached JSON -> HIT
      const res5 = await fetch(`${proxyUrl}/catalog`, {
        headers: { 'Accept': 'application/json' }
      });
      expect(res5.status).toBe(200);
      expect(res5.headers.get('x-cache')).toBe('HIT');
      const json5 = await res5.json();
      expect(json5.items).toEqual(['guitar', 'drums']);
    } finally {
      proxy.server.stop(true);
    }
  });
});
