
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CASSETTES_DIR = '.test-graphql-cassettes';

describe('Issue #2: Body-Aware Request Matching for GraphQL', () => {
  let mockOriginServer;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CASSETTES_DIR)) {
      rmSync(TEST_CASSETTES_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json();
        if (body.query?.includes('getUser')) {
          return Response.json({ data: { user: { id: 'u_1', name: 'Alice' } } });
        }
        if (body.query?.includes('getCart')) {
          return Response.json({ data: { cart: { items: ['laptop', 'mouse'] } } });
        }
        return Response.json({ errors: ['Unknown query'] }, { status: 400 });
      }
    });

    originUrl = `http://localhost:${mockOriginServer.port}`;
  });

  afterAll(() => {
    if (mockOriginServer) mockOriginServer.stop(true);
    if (existsSync(TEST_CASSETTES_DIR)) {
      rmSync(TEST_CASSETTES_DIR, { recursive: true, force: true });
    }
  });

  test('Distinguishes two POST queries to identical /graphql URL by body hash in VCR mode', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cassette: 'graphql-tape',
      cassetteDir: TEST_CASSETTES_DIR,
      mode: 'auto',
      matchBody: true
    });

    try {
      const q1 = JSON.stringify({ query: 'query getUser { user { name } }' });
      const q2 = JSON.stringify({ query: 'query getCart { cart { items } }' });

      // 1. Record Query 1
      const res1 = await fetch(`http://localhost:${proxy.server.port}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: q1
      });
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-cache')).toBe('RECORD');
      const data1 = await res1.json();
      expect(data1.data.user.name).toBe('Alice');

      // 2. Record Query 2 (Same URL, different payload)
      const res2 = await fetch(`http://localhost:${proxy.server.port}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: q2
      });
      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-cache')).toBe('RECORD');
      const data2 = await res2.json();
      expect(data2.data.cart.items).toEqual(['laptop', 'mouse']);

      // 3. Replay Query 1 -> must return Alice, NOT Cart items!
      const res1Replay = await fetch(`http://localhost:${proxy.server.port}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: q1
      });
      expect(res1Replay.headers.get('x-cache')).toBe('REPLAY');
      const data1Replay = await res1Replay.json();
      expect(data1Replay.data.user.name).toBe('Alice');

      // 4. Replay Query 2 -> must return Cart items, NOT Alice!
      const res2Replay = await fetch(`http://localhost:${proxy.server.port}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: q2
      });
      expect(res2Replay.headers.get('x-cache')).toBe('REPLAY');
      const data2Replay = await res2Replay.json();
      expect(data2Replay.data.cart.items).toEqual(['laptop', 'mouse']);
    } finally {
      proxy.server.stop(true);
    }
  });
});
