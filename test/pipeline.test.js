
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { ProxyPipeline } from '../src/pipeline.js';
import { InMemoryStorageAdapter } from '../src/storage.js';
import { ChaosEngine } from '../src/chaos.js';
import { MetricsCollector } from '../src/metrics.js';

describe('Deep Module: ProxyPipeline', () => {
  let mockServer;
  let originUrl;
  let originHitCount = 0;

  beforeAll(() => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        originHitCount++;
        const url = new URL(req.url);
        if (url.pathname === '/hello') {
          return Response.json({ message: 'Hello from Upstream' }, {
            headers: { 'Cache-Control': 'public, max-age=3600' }
          });
        }
        return new Response('Not Found', { status: 404 });
      }
    });
    originUrl = `http://localhost:${mockServer.port}`;
  });

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  test('Orchestrates MISS and subsequent HIT completely in-memory', async () => {
    const storage = new InMemoryStorageAdapter();
    const telemetry = new MetricsCollector();
    const pipeline = new ProxyPipeline({
      origin: originUrl,
      storage,
      telemetry
    });

    const initialHits = originHitCount;

    // Call 1: Cache MISS
    const req1 = new Request('http://proxy.local/hello');
    const res1 = await pipeline.dispatch(req1);

    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const data1 = await res1.json();
    expect(data1.message).toBe('Hello from Upstream');
    expect(originHitCount).toBe(initialHits + 1);
    expect(telemetry.misses).toBe(1);

    // Call 2: Cache HIT
    const req2 = new Request('http://proxy.local/hello');
    const res2 = await pipeline.dispatch(req2);

    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const data2 = await res2.json();
    expect(data2.message).toBe('Hello from Upstream');
    // Origin hit count did NOT increment
    expect(originHitCount).toBe(initialHits + 1);
    expect(telemetry.hits).toBe(1);
    expect(telemetry.getHitRatio()).toBe('50.0%');
  });

  test('Short-circuits immediately on Chaos route overrides', async () => {
    const storage = new InMemoryStorageAdapter();
    const chaos = new ChaosEngine({ overrides: ['/chaos-route:418'] });
    const pipeline = new ProxyPipeline({
      origin: originUrl,
      storage,
      chaos
    });

    const req = new Request('http://proxy.local/chaos-route');
    const res = await pipeline.dispatch(req);

    expect(res.status).toBe(418);
    expect(res.headers.get('x-chaos')).toBe('OVERRIDE=418');
  });
});
