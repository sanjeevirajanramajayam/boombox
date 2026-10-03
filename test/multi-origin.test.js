
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { ProxyPipeline } from '../src/pipeline.js';
import { InMemoryStorageAdapter } from '../src/storage.js';

describe('Multi-Origin Emulation & Dynamic Routing', () => {
  let mockServerA;
  let mockServerB;
  let originUrlA;
  let originUrlB;
  let callCountA = 0;
  let callCountB = 0;

  beforeAll(() => {
    // Mock Origin A (e.g. Stripe)
    mockServerA = Bun.serve({
      port: 0,
      fetch(req) {
        callCountA++;
        return Response.json({ service: 'Stripe', count: callCountA });
      }
    });

    // Mock Origin B (e.g. Twilio)
    mockServerB = Bun.serve({
      port: 0,
      fetch(req) {
        callCountB++;
        return Response.json({ service: 'Twilio', count: callCountB });
      }
    });

    originUrlA = `http://localhost:${mockServerA.port}`;
    originUrlB = `http://localhost:${mockServerB.port}`;
  });

  afterAll(() => {
    if (mockServerA) mockServerA.stop(true);
    if (mockServerB) mockServerB.stop(true);
  });

  test('Transparent Full-URL Proxying: proxies to multiple origins through 1 pipeline without collision', async () => {
    const pipeline = new ProxyPipeline({
      storage: new InMemoryStorageAdapter()
    });

    // Request 1: Target Origin A
    const reqA1 = new Request(`http://boombox.local/${originUrlA}/v1/status`);
    const resA1 = await pipeline.dispatch(reqA1);
    expect(resA1.status).toBe(200);
    expect(resA1.headers.get('x-cache')).toBe('MISS');
    const dataA1 = await resA1.json();
    expect(dataA1.service).toBe('Stripe');

    // Request 2: Target Origin A (Cache HIT)
    const reqA2 = new Request(`http://boombox.local/${originUrlA}/v1/status`);
    const resA2 = await pipeline.dispatch(reqA2);
    expect(resA2.status).toBe(200);
    expect(resA2.headers.get('x-cache')).toBe('HIT');

    // Request 3: Target Origin B with identical path /v1/status (Must NOT collide with A)
    const reqB1 = new Request(`http://boombox.local/${originUrlB}/v1/status`);
    const resB1 = await pipeline.dispatch(reqB1);
    expect(resB1.status).toBe(200);
    expect(resB1.headers.get('x-cache')).toBe('MISS');
    const dataB1 = await resB1.json();
    expect(dataB1.service).toBe('Twilio');

    // Request 4: Target Origin B (Cache HIT)
    const reqB2 = new Request(`http://boombox.local/${originUrlB}/v1/status`);
    const resB2 = await pipeline.dispatch(reqB2);
    expect(resB2.status).toBe(200);
    expect(resB2.headers.get('x-cache')).toBe('HIT');
  });

  test('Dynamic Header: X-Boombox-Origin overrides default origin on the fly', async () => {
    const pipeline = new ProxyPipeline({
      origin: originUrlA,
      storage: new InMemoryStorageAdapter()
    });

    // Call with dynamic header directing to Origin B instead of default A
    const req = new Request('http://boombox.local/test-header', {
      headers: { 'X-Boombox-Origin': originUrlB }
    });
    const res = await pipeline.dispatch(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.service).toBe('Twilio');
  });

  test('Admin Control Plane: POST /_boombox/origin reconfigures default origin at runtime', async () => {
    const pipeline = new ProxyPipeline({
      origin: originUrlA,
      storage: new InMemoryStorageAdapter()
    });

    // Check initial origin
    const getRes = await pipeline.dispatch(new Request('http://boombox.local/_boombox/origin'));
    const initial = await getRes.json();
    expect(initial.origin).toBe(originUrlA);

    // Reconfigure origin to Origin B
    const updateRes = await pipeline.dispatch(new Request('http://boombox.local/_boombox/origin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: originUrlB })
    }));
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.success).toBe(true);
    expect(updateData.origin).toBe(originUrlB);

    // Subsequent normal request now forwards to Origin B
    const req = new Request('http://boombox.local/verify-admin');
    const res = await pipeline.dispatch(req);
    const data = await res.json();
    expect(data.service).toBe('Twilio');
  });
});
