
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { CacheManager } from '../src/cache.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_CACHE_DIR = '.test-lru-quota-cache';

describe('Issue #9: Bounded Disk Quota & LRU Cache Eviction', () => {
  beforeAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  test('Evicts least recently used cache files when total disk quota is exceeded', async () => {
    // 1. Quota set to 4000 bytes (~4KB, enough for 3 items of ~1.1KB each)
    const cache = new CacheManager(TEST_CACHE_DIR, { maxSizeBytes: 4000 });

    const payload1 = 'A'.repeat(800);
    const payload2 = 'B'.repeat(800);
    const payload3 = 'C'.repeat(800);
    const payload4 = 'D'.repeat(800);

    // Write item 1 (~1.2KB on disk with JSON envelope)
    cache.set('GET', '/item1', { statusCode: 200, headers: {}, body: payload1 });
    await new Promise(r => setTimeout(r, 20));

    // Write item 2
    cache.set('GET', '/item2', { statusCode: 200, headers: {}, body: payload2 });
    await new Promise(r => setTimeout(r, 20));

    // Write item 3
    cache.set('GET', '/item3', { statusCode: 200, headers: {}, body: payload3 });
    await new Promise(r => setTimeout(r, 20));

    // Touch item 1 by accessing it (making item 1 more recent than item 2 and item 3)
    expect(cache.get('GET', '/item1')).not.toBe(null);
    await new Promise(r => setTimeout(r, 20));

    // Write item 4 -> Total size exceeds 3KB quota! Must trigger eviction!
    cache.set('GET', '/item4', { statusCode: 200, headers: {}, body: payload4 });

    // Item 2 was least recently used -> should be evicted!
    expect(cache.get('GET', '/item2')).toBe(null);

    // Item 1 was touched -> should still exist!
    expect(cache.get('GET', '/item1')).not.toBe(null);

    // Item 4 was just added -> must exist!
    expect(cache.get('GET', '/item4')).not.toBe(null);
  });
});
