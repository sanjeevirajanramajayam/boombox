
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-chaos-cache';

describe('Boombox Chaos & Resilience Engine', () => {
  let mockOriginServer;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/normal') {
          return Response.json({ status: 'ok', serverTime: Date.now() });
        }
        return new Response('Not Found', { status: 404 });
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

  test('Chaos Latency: delays response by at least configured duration', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR,
      latency: 80 // 80ms synthetic delay
    });

    try {
      const startTime = performance.now();
      const res = await fetch(`http://localhost:${proxy.server.port}/normal`);
      const elapsed = performance.now() - startTime;

      expect(res.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(75); // accounting for small timer granularity
    } finally {
      proxy.server.stop(true);
    }
  });

  test('Chaos Route Override: forces deterministic status code without contacting origin', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR,
      overrides: ['/checkout:429', '/cart:503']
    });

    try {
      // 1. /checkout returns 429 Too Many Requests
      const res1 = await fetch(`http://localhost:${proxy.server.port}/checkout`);
      expect(res1.status).toBe(429);
      expect(res1.headers.get('x-chaos')).toBe('OVERRIDE=429');
      const data1 = await res1.json();
      expect(data1.chaos).toBe('override');
      expect(data1.status).toBe(429);

      // 2. /cart returns 503 Service Unavailable
      const res2 = await fetch(`http://localhost:${proxy.server.port}/cart`);
      expect(res2.status).toBe(503);
      expect(res2.headers.get('x-chaos')).toBe('OVERRIDE=503');

      // 3. /normal route is not overridden and succeeds
      const res3 = await fetch(`http://localhost:${proxy.server.port}/normal`);
      expect(res3.status).toBe(200);
    } finally {
      proxy.server.stop(true);
    }
  });

  test('Chaos Flake Rate: 100% flake always returns 500 Internal Server Error', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR,
      flake: 100 // 100% flake rate
    });

    try {
      const res = await fetch(`http://localhost:${proxy.server.port}/normal`);
      expect(res.status).toBe(500);
      expect(res.headers.get('x-chaos')).toBe('FLAKE=500');

      const data = await res.json();
      expect(data.chaos).toBe('flake');
      expect(data.status).toBe(500);
    } finally {
      proxy.server.stop(true);
    }
  });

  test('Chaos Jitter: adds variable delay within [min, max] range', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR,
      jitter: '50-100'
    });

    try {
      const startTime = performance.now();
      const res = await fetch(`http://localhost:${proxy.server.port}/normal`);
      const elapsed = performance.now() - startTime;

      expect(res.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(45);
    } finally {
      proxy.server.stop(true);
    }
  });
});
