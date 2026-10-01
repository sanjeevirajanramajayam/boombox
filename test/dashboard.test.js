
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-dashboard-cache';

describe('Issue #5: Real-time Terminal UI Dashboard', () => {
  let mockOriginServer;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({ status: 'ok' });
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

  test('Tracks transaction counts, hit ratios, and renders box-drawing ASCII table', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR
    });

    try {
      // 1. Request 1: MISS
      await fetch(`http://localhost:${proxy.server.port}/items`);
      expect(proxy.telemetry.requests).toBe(1);
      expect(proxy.telemetry.misses).toBe(1);
      expect(proxy.telemetry.hits).toBe(0);
      expect(proxy.telemetry.getHitRatio()).toBe('0.0%');

      // 2. Request 2: HIT
      await fetch(`http://localhost:${proxy.server.port}/items`);
      expect(proxy.telemetry.requests).toBe(2);
      expect(proxy.telemetry.misses).toBe(1);
      expect(proxy.telemetry.hits).toBe(1);
      expect(proxy.telemetry.getHitRatio()).toBe('50.0%');

      // 3. Render dashboard string
      const dashboard = proxy.telemetry.render();
      expect(dashboard).toContain('BOOMBOX PROXY TELEMETRY DASHBOARD');
      expect(dashboard).toContain('Hit Ratio: 50.0%');
      expect(dashboard).toContain('/items');
    } finally {
      proxy.server.stop(true);
    }
  });
});
