
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-binary-cache';

describe('Issue #4: Binary Media Base64 Serialization', () => {
  let mockOriginServer;
  let originUrl;
  // Sample PNG header bytes
  const fakePngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF, 0xEE]);

  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(fakePngBytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(fakePngBytes.length)
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

  test('Preserves raw binary byte fidelity across MISS and HIT', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR
    });

    try {
      // 1. First fetch (MISS)
      const res1 = await fetch(`http://localhost:${proxy.server.port}/logo.png`);
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-cache')).toBe('MISS');
      const bytes1 = new Uint8Array(await res1.arrayBuffer());
      expect(bytes1).toEqual(fakePngBytes);

      // 2. Second fetch (HIT from Base64 deserialization)
      const res2 = await fetch(`http://localhost:${proxy.server.port}/logo.png`);
      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-cache')).toBe('HIT');
      const bytes2 = new Uint8Array(await res2.arrayBuffer());
      expect(bytes2).toEqual(fakePngBytes);
    } finally {
      proxy.server.stop(true);
    }
  });
});
