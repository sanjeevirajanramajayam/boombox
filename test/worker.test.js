
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import worker, { InMemoryEdgeCache } from '../src/worker.js';

describe('Issue #11: Cloudflare Workers Deployment Adapter (src/worker.js)', () => {
  let mockServer;
  let originUrl;
  let originHitCount = 0;

  beforeAll(() => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        originHitCount++;
        const url = new URL(req.url);
        if (url.pathname === '/items/1') {
          return Response.json(
            { id: 1, name: 'Boombox Edge Item', counter: originHitCount },
            {
              headers: {
                'Cache-Control': 'public, max-age=3600',
                'Content-Type': 'application/json'
              }
            }
          );
        }
        return new Response('Not Found', { status: 404 });
      }
    });

    originUrl = `http://localhost:${mockServer.port}`;
  });

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  test('Worker returns 500 when env.ORIGIN is not configured', async () => {
    const request = new Request('https://edge.boombox.local/items/1');
    const env = {};
    const ctx = { waitUntil: () => {} };

    const res = await worker.fetch(request, env, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('ORIGIN_NOT_CONFIGURED');
  });

  test('Worker proxies request: MISS on first call, HIT on second call', async () => {
    const testCache = new InMemoryEdgeCache();
    const env = {
      ORIGIN: originUrl,
      CACHE: testCache
    };
    const ctx = {
      waitUntil: (promise) => promise
    };

    const initialHits = originHitCount;

    // Call 1: Cache MISS
    const req1 = new Request('https://edge.boombox.local/items/1');
    const res1 = await worker.fetch(req1, env, ctx);

    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const data1 = await res1.json();
    expect(data1.id).toBe(1);
    expect(originHitCount).toBe(initialHits + 1);

    // Call 2: Cache HIT from edge cache
    const req2 = new Request('https://edge.boombox.local/items/1');
    const res2 = await worker.fetch(req2, env, ctx);

    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const data2 = await res2.json();
    expect(data2.id).toBe(1);
    // Origin was NOT contacted
    expect(originHitCount).toBe(initialHits + 1);
  });

  test('Worker injects Chaos overrides and faults at the edge', async () => {
    const env = {
      ORIGIN: originUrl,
      CHAOS_OVERRIDE: ['/chaos-route:418']
    };
    const ctx = { waitUntil: () => {} };

    const req = new Request('https://edge.boombox.local/chaos-route');
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(418);
    expect(res.headers.get('x-chaos')).toBe('OVERRIDE=418');
    const body = await res.json();
    expect(body.chaos).toBe('override');
  });
});
