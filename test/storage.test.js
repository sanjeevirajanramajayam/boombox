
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { FileCacheAdapter, CassetteTapeAdapter, InMemoryStorageAdapter } from '../src/storage.js';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-storage-seam-cache';
const TEST_CASSETTE_DIR = '.test-storage-seam-cassettes';

describe('Unified Seam: CacheStorage Adapters', () => {
  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    if (existsSync(TEST_CASSETTE_DIR)) rmSync(TEST_CASSETTE_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    if (existsSync(TEST_CACHE_DIR)) rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    if (existsSync(TEST_CASSETTE_DIR)) rmSync(TEST_CASSETTE_DIR, { recursive: true, force: true });
  });

  test('InMemoryStorageAdapter provides zero-disk storage for fast unit tests', async () => {
    const memory = new InMemoryStorageAdapter();

    expect(memory.lookup({ method: 'GET', path: '/items' })).toBe(null);

    memory.store({
      method: 'GET',
      path: '/items',
      response: {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        serializedBody: JSON.stringify({ inMemory: true }),
        isBase64: false
      }
    });

    const match = memory.lookup({ method: 'GET', path: '/items' });
    expect(match).not.toBe(null);
    expect(match.signal).toBe('HIT');
    expect(match.statusCode).toBe(200);
    expect(JSON.parse(match.body)).toEqual({ inMemory: true });
    expect(memory.count()).toBe(1);

    memory.clear();
    expect(memory.count()).toBe(0);
  });

  test('Polymorphic Dependency Injection: Proxy server accepts custom InMemoryStorageAdapter', async () => {
    const mockOrigin = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ originCalls: 1 });
      }
    });

    try {
      const inMemoryStorage = new InMemoryStorageAdapter();
      const proxy = createProxyServer({
        port: 0,
        origin: `http://localhost:${mockOrigin.port}`,
        storage: inMemoryStorage
      });

      try {
        const proxyUrl = `http://localhost:${proxy.server.port}`;

        // 1. Request 1: MISS (stored into memory)
        const res1 = await fetch(`${proxyUrl}/test`);
        expect(res1.status).toBe(200);
        expect(res1.headers.get('x-cache')).toBe('MISS');
        expect(inMemoryStorage.count()).toBe(1);

        // 2. Request 2: HIT (served directly from inMemoryStorage)
        const res2 = await fetch(`${proxyUrl}/test`);
        expect(res2.status).toBe(200);
        expect(res2.headers.get('x-cache')).toBe('HIT');
        const body2 = await res2.json();
        expect(body2.originCalls).toBe(1);
      } finally {
        proxy.server.stop(true);
      }
    } finally {
      mockOrigin.stop(true);
    }
  });

  test('CassetteTapeAdapter enforces offline 502 miss semantics in replay mode', () => {
    const adapter = new CassetteTapeAdapter({
      cassetteName: 'empty-test-tape',
      cassetteDir: TEST_CASSETTE_DIR,
      mode: 'replay'
    });

    const miss = adapter.lookup({ method: 'GET', path: '/unrecorded-route' });
    expect(miss).not.toBe(null);
    expect(miss.isOfflineMiss).toBe(true);
    expect(miss.statusCode).toBe(502);
  });
});
