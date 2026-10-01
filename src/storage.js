
import { CacheManager } from './cache.js';
import { CassetteManager } from './vcr.js';

export function createStorageMatch({
  statusCode,
  headers,
  body,
  isBase64 = false,
  cachedAt = new Date().toISOString(),
  etag = null,
  lastModified = null,
  signal = 'HIT',
  isOfflineMiss = false,
  errorMessage = null,
  maxAge = null,
  staleWhileRevalidate = null
}) {
  return {
    statusCode,
    headers,
    body,
    isBase64: Boolean(isBase64),
    cachedAt,
    etag,
    lastModified,
    signal,
    isOfflineMiss: Boolean(isOfflineMiss),
    errorMessage,
    maxAge,
    staleWhileRevalidate
  };
}

export class FileCacheAdapter {
  constructor({ cacheDir = '.boombox-cache', matchBody = false, maxSizeBytes = null } = {}) {
    this.cacheDir = cacheDir;
    this.matchBody = Boolean(matchBody);
    this.cacheManager = new CacheManager(cacheDir, { maxSizeBytes });
  }

  isCacheable(method) {
    const m = method.toUpperCase();
    return m === 'GET' || m === 'HEAD' || (this.matchBody && m === 'POST');
  }

  lookup({ method, path, headers, bodyText = null }) {
    if (!this.isCacheable(method)) return null;

    const entry = this.cacheManager.get(method, path, bodyText, headers);
    if (!entry) return null;

    return createStorageMatch({
      statusCode: entry.statusCode,
      headers: entry.headers,
      body: entry.body,
      isBase64: entry.isBase64,
      cachedAt: entry.cachedAt,
      etag: entry.etag,
      lastModified: entry.lastModified,
      maxAge: entry.maxAge,
      staleWhileRevalidate: entry.staleWhileRevalidate,
      signal: 'HIT'
    });
  }

  store({ method, path, headers, bodyText = null, response }) {
    if (!this.isCacheable(method)) return;
    if (response.statusCode < 200 || response.statusCode >= 300) return;

    this.cacheManager.set(method, path, {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.serializedBody,
      isBase64: response.isBase64
    }, bodyText, headers);
  }

  isFresh(match) {
    return this.cacheManager.isFresh(match);
  }

  isStaleWhileRevalidate(match) {
    return this.cacheManager.isStaleWhileRevalidate(match);
  }

  touch({ method, path, headers, bodyText = null }) {
    this.cacheManager.touch(method, path, bodyText, headers);
  }

  clear() {
    this.cacheManager.clear();
  }

  count() {
    return this.cacheManager.count();
  }
}

export class CassetteTapeAdapter {
  constructor({ cassetteName, cassetteDir = 'cassettes', mode = 'auto', redact = [], matchBody = false } = {}) {
    this.cassetteName = cassetteName;
    this.cassetteDir = cassetteDir;
    this.mode = mode.toLowerCase();
    this.matchBody = Boolean(matchBody);
    this.cassetteManager = new CassetteManager({
      cassetteName,
      cassetteDir,
      mode: this.mode,
      redact,
      matchBody: this.matchBody
    });
  }

  lookup({ method, path, bodyText = null }) {
    if (this.mode === 'record') {
      return null;
    }

    const matched = this.cassetteManager.match(method, path, bodyText);
    if (matched) {
      return createStorageMatch({
        statusCode: matched.statusCode,
        headers: matched.headers,
        body: matched.body,
        isBase64: matched.isBase64,
        cachedAt: matched.recordedAt,
        signal: 'REPLAY'
      });
    }

    if (this.mode === 'replay') {
      return createStorageMatch({
        statusCode: 502,
        headers: { 'X-Cache': 'MISS' },
        body: JSON.stringify({
          error: 'Cassette interaction not found in replay mode',
          cassette: this.cassetteName,
          method: method.toUpperCase(),
          url: path
        }),
        isOfflineMiss: true,
        errorMessage: 'Cassette interaction not found in replay mode',
        signal: 'MISS'
      });
    }

    return null;
  }

  store({ method, path, bodyText = null, response }) {
    if (this.mode === 'replay') return;

    this.cassetteManager.record(method, path, {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.serializedBody,
      isBase64: response.isBase64
    }, bodyText);
  }

  isFresh() {
    return true; // Cassette tapes represent deterministic playback fixtures
  }

  touch() {
    // Cassettes are immutable records; no-op
  }

  clear() {
    // Retain directory, clear in-memory interactions
    this.cassetteManager.interactions.clear();
    this.cassetteManager.flush();
  }

  count() {
    return this.cassetteManager.count();
  }
}

export class InMemoryStorageAdapter {
  constructor({ matchBody = false } = {}) {
    this.matchBody = Boolean(matchBody);
    this.records = new Map();
  }

  isCacheable(method) {
    const m = method.toUpperCase();
    return m === 'GET' || m === 'HEAD' || (this.matchBody && m === 'POST');
  }

  lookup({ method, path, bodyText = null }) {
    const key = `${method.toUpperCase()}:${path}${this.matchBody && bodyText ? ':' + bodyText : ''}`;
    const entry = this.records.get(key);
    if (!entry) return null;
    return createStorageMatch({ ...entry, signal: 'HIT' });
  }

  store({ method, path, bodyText = null, response }) {
    const key = `${method.toUpperCase()}:${path}${this.matchBody && bodyText ? ':' + bodyText : ''}`;
    this.records.set(key, {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.serializedBody,
      isBase64: response.isBase64,
      cachedAt: new Date().toISOString()
    });
  }

  isFresh() {
    return true;
  }

  touch() {}

  clear() {
    this.records.clear();
  }

  count() {
    return this.records.size;
  }
}
