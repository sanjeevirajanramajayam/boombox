
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-boombox-cache';

describe('Boombox Core Caching Proxy', () => {
  let mockOriginServer;
  let originCallCount = 0;
  let proxyInstance;
  let originUrl;
  let proxyUrl;

  beforeAll(async () => {
    // Clean any prior test cache
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    // 1. Start mock origin server on an ephemeral port
    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        originCallCount++;
        const url = new URL(req.url);

        if (req.method === 'POST') {
          const body = await req.json();
          return Response.json({ status: 'created', received: body }, { status: 201 });
        }

        if (url.pathname === '/products') {
          return Response.json({
            items: ['guitar', 'amplifier', 'pedal'],
            callCount: originCallCount
          });
        }

        return new Response('Not Found', { status: 404 });
      }
    });

    originUrl = `http://localhost:${mockOriginServer.port}`;

    // 2. Start Boombox proxy on an ephemeral port pointing to mock origin
    proxyInstance = createProxyServer({
      port: 0,
      origin: originUrl,
      cacheDir: TEST_CACHE_DIR
    });

    proxyUrl = `http://localhost:${proxyInstance.server.port}`;
  });

  afterAll(() => {
    if (mockOriginServer) mockOriginServer.stop(true);
    if (proxyInstance?.server) proxyInstance.server.stop(true);
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  test('Request 1: Cache MISS forwards to origin and attaches X-Cache: MISS', async () => {
    const res = await fetch(`${proxyUrl}/products`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');

    const data = await res.json();
    expect(data.items).toEqual(['guitar', 'amplifier', 'pedal']);
    expect(data.callCount).toBe(1);
    expect(originCallCount).toBe(1);
  });

  test('Request 2: Cache HIT returns stored response without contacting origin', async () => {
    const res = await fetch(`${proxyUrl}/products`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');

    const data = await res.json();
    expect(data.items).toEqual(['guitar', 'amplifier', 'pedal']);
    // Call count from origin must NOT increment
    expect(data.callCount).toBe(1);
    expect(originCallCount).toBe(1);
  });

  test('Query normalization: ?b=2&a=1 matches prior cache for ?a=1&b=2', async () => {
    // Prime cache with sorted params
    const res1 = await fetch(`${proxyUrl}/products?a=1&b=2`);
    expect(res1.headers.get('x-cache')).toBe('MISS');

    // Request with swapped params should HIT
    const res2 = await fetch(`${proxyUrl}/products?b=2&a=1`);
    expect(res2.headers.get('x-cache')).toBe('HIT');
  });

  test('Mutating methods (POST) bypass cache and reach origin directly', async () => {
    const res = await fetch(`${proxyUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'drum kit' })
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('x-cache')).toBe('BYPASS');
    const data = await res.json();
    expect(data.received.item).toBe('drum kit');
  });

  test('Cache clearing: clear() purges files and next request is a MISS', async () => {
    expect(proxyInstance.cache.count()).toBeGreaterThan(0);

    proxyInstance.cache.clear();
    expect(proxyInstance.cache.count()).toBe(0);

    const res = await fetch(`${proxyUrl}/products`);
    expect(res.headers.get('x-cache')).toBe('MISS');
  });
});
