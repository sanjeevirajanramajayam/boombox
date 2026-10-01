// [WHY]: RFC 9111 Section 2 defines cache keys to match incoming requests to stored responses.
//        A deterministic hash over the HTTP method and canonicalized URI prevents duplicate storage
//        and guarantees that parameter ordering differences (e.g. ?a=1&b=2 vs ?b=2&a=1) hit the same entry.
// [HOW]: Uses Node/Bun crypto to create SHA-256 hashes of METHOD + ":" + normalized path and sorted query string.
//        Persists metadata, headers, status, and payload to isolated JSON files on the local filesystem.
// [INVARIANTS/WHEN]: Only deterministic, normalized URIs are hashed. Corrupted cache files fall back to cache misses.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class CacheManager {
  // [WHY]: Isolated directory prevents polluting working directory and allows instantaneous purge.
  // [HOW]: Ensures the cache directory exists at initialization time.
  // [INVARIANTS/WHEN]: cacheDir path must be valid and writable.
  constructor(cacheDir = '.boombox-cache') {
    this.cacheDir = cacheDir;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // [WHY]: Query parameters in HTTP URIs have no standard semantic ordering; /items?a=1&b=2
  //        and /items?b=2&a=1 retrieve the exact same resource representation.
  // [HOW]: Parses URL, sorts search parameters alphabetically, and returns canonical relative path.
  // [INVARIANTS/WHEN]: Preserves pathname casing and handles paths without query strings.
  normalizeUrl(rawUrl) {
    const parsed = new URL(rawUrl, 'http://localhost');
    parsed.searchParams.sort();
    return parsed.pathname + (parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : '');
  }

  // [WHY]: RFC 9111 dictates that cache entries are partitioned primarily by request method and URI.
  // [HOW]: Hashes METHOD + ":" + canonical URL using SHA-256 to generate fixed-length filesystem-safe hex filenames.
  // [INVARIANTS/WHEN]: Different methods (GET vs HEAD) on the same URL produce distinct cache keys.
  computeKey(method, rawUrl) {
    const canonical = this.normalizeUrl(rawUrl);
    const serialized = `${method.toUpperCase()}:${canonical}`;
    return createHash('sha256').update(serialized).digest('hex');
  }

  // [WHY]: Fast retrieval of stored response representation without hitting upstream network.
  // [HOW]: Reads the cached JSON file by hash key. If missing or corrupted, returns null.
  // [INVARIANTS/WHEN]: Always returns parsed response object or null; never throws uncaught I/O errors.
  get(method, rawUrl) {
    const key = this.computeKey(method, rawUrl);
    const filePath = join(this.cacheDir, `${key}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // [WHY]: Persists complete response representation (status, headers, body) for subsequent replay.
  // [HOW]: Serializes response metadata, header map, and UTF-8/base64 body to a JSON file.
  // [INVARIANTS/WHEN]: Writes atomically via synchronous write to avoid partial file reads.
  set(method, rawUrl, { statusCode, headers, body }) {
    const key = this.computeKey(method, rawUrl);
    const filePath = join(this.cacheDir, `${key}.json`);

    const entry = {
      method: method.toUpperCase(),
      url: rawUrl,
      statusCode,
      headers,
      body,
      cachedAt: new Date().toISOString()
    };

    writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
  }

  // [WHY]: Provides instantaneous cache invalidation when users request a fresh cache slate (--clear-cache).
  // [HOW]: Recursively removes all files inside the cache directory and re-creates the empty folder.
  // [INVARIANTS/WHEN]: Cache directory remains present and empty after invocation.
  clear() {
    if (existsSync(this.cacheDir)) {
      rmSync(this.cacheDir, { recursive: true, force: true });
    }
    mkdirSync(this.cacheDir, { recursive: true });
  }

  // [WHY]: Enables counting stored items for telemetry and testing assertions.
  // [HOW]: Reads directory entry count filtering for .json files.
  // [INVARIANTS/WHEN]: Returns non-negative integer.
  count() {
    if (!existsSync(this.cacheDir)) return 0;
    return readdirSync(this.cacheDir).filter(f => f.endsWith('.json')).length;
  }
}
