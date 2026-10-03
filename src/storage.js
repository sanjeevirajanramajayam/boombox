
import { DiskCacheAdapter, createStorageMatch } from './cache.js';              // Import RFC 9111 disk adapter and normalized match factory
import { CassetteManager } from './vcr.js';                                     // Import VCR tape manager for recording and sequential playback

export { DiskCacheAdapter, DiskCacheAdapter as FileCacheAdapter, createStorageMatch }; // Re-export for external and internal consumers

// Wraps CassetteManager under the unified CacheStorage polymorphic interface
export class CassetteTapeAdapter {
  constructor({ cassetteName, cassetteDir = 'cassettes', mode = 'auto', redact = [], matchBody = false } = {}) {
    this.cassetteName = cassetteName;                                           // Name of the cassette tape fixture (e.g. 'checkout')
    this.cassetteDir = cassetteDir;                                             // Directory where cassette JSON files are persisted
    this.mode = mode.toLowerCase();                                             // Operational mode: 'record', 'replay', or 'auto'
    this.matchBody = Boolean(matchBody);                                        // Whether to partition interaction keys by body hash
    this.cassetteManager = new CassetteManager({                                // Instantiate core VCR manager instance
      cassetteName,                                                             // Pass cassette fixture name
      cassetteDir,                                                              // Pass storage directory
      mode: this.mode,                                                          // Pass normalized operational mode
      redact,                                                                   // Pass sensitive headers list for redaction
      matchBody: this.matchBody                                                 // Pass body matching flag
    });
  }

  // Looks up recorded interaction from cassette tape matching method, URL, and body
  lookup({ method, path, bodyText = null }) {
    if (this.mode === 'record') {                                               // In pure record mode, bypass prior recordings
      return null;                                                              // Force cache MISS so request always contacts origin
    }

    const matched = this.cassetteManager.match(method, path, bodyText);         // Query cassette manager and advance playback cursor
    if (matched) {                                                              // If matching interaction frame exists on tape
      return createStorageMatch({                                               // Return standardized storage representation
        statusCode: matched.statusCode,                                         // Preserved HTTP response status code
        headers: matched.headers,                                               // Scrubbed response headers
        body: matched.body,                                                     // Stored payload string
        isBase64: matched.isBase64,                                             // Boolean flag indicating if body is Base64 binary
        cachedAt: matched.recordedAt,                                           // ISO timestamp when interaction was originally taped
        signal: 'REPLAY'                                                        // Stamped with VCR REPLAY signal
      });
    }

    if (this.mode === 'replay') {                                               // In replay mode, touching live origin is strictly forbidden
      return createStorageMatch({                                               // Return offline synthetic 502 error representation
        statusCode: 502,                                                        // Fail fast with HTTP 502 Bad Gateway
        headers: { 'X-Cache': 'MISS' },                                         // Attach diagnostic header indicating missing cassette frame
        body: JSON.stringify({                                                  // Provide descriptive error JSON explaining missing frame
          error: 'Cassette interaction not found in replay mode',               // Error message detailing offline miss
          cassette: this.cassetteName,                                          // Name of the cassette fixture missing interaction
          method: method.toUpperCase(),                                         // HTTP verb that was not found
          url: path                                                             // Target URL that was not recorded
        }),
        isOfflineMiss: true,                                                    // Signal to ProxyPipeline to fail fast without forwarding
        errorMessage: 'Cassette interaction not found in replay mode',          // Human-readable error message
        signal: 'MISS'                                                          // Diagnostic cache signal
      });
    }

    return null;                                                                // In 'auto' mode, fall through to live origin recording
  }

  // Persists upstream response to cassette tape unless operating in replay mode
  store({ method, path, bodyText = null, response }) {
    if (this.mode === 'replay') return;                                         // Never mutate tape when operating in pure replay mode

    this.cassetteManager.record(method, path, {                                 // Delegate recording to underlying cassette manager
      statusCode: response.statusCode,                                         // Upstream HTTP status code
      headers: response.headers,                                               // Upstream response headers (will be redacted)
      body: response.serializedBody,                                           // Serialized UTF-8 or Base64 payload
      isBase64: response.isBase64                                              // Binary flag
    }, bodyText);                                                               // Optional request body for GraphQL matching
  }

  // Cassette fixtures represent immutable recorded truth and never expire
  isFresh() {
    return true;                                                                // Cassettes are always fresh deterministic fixtures
  }

  // Cassettes are immutable fixture records; touching TTL is a no-op
  touch() {
    // No-op for cassette tapes                                                 // Retain recorded timestamp without TTL updates
  }

  // Purges all recorded interactions from memory and clears file
  clear() {
    this.cassetteManager.interactions.clear();                                  // Empty in-memory interactions map
    this.cassetteManager.flush();                                               // Flush empty array to disk to clear tape file
  }

  // Returns total interaction frames recorded on this cassette
  count() {
    return this.cassetteManager.count();                                        // Delegate count to cassette manager
  }
}

// Zero-disk in-memory storage adapter for sub-millisecond unit tests
export class InMemoryStorageAdapter {
  constructor({ matchBody = false } = {}) {
    this.matchBody = Boolean(matchBody);                                        // Whether to incorporate request body into cache keys
    this.records = new Map();                                                   // Map<string, Object> storing in-memory cache representations
  }

  // Determines if an HTTP method is eligible for caching
  isCacheable(method) {
    const m = method.toUpperCase();                                             // Normalize HTTP verb to uppercase
    return m === 'GET' || m === 'HEAD' || (this.matchBody && m === 'POST');     // Safe idempotent verbs + body-matched GraphQL POST
  }

  // Looks up cached entry in memory Map
  lookup({ method, path, bodyText = null }) {
    const key = `${method.toUpperCase()}:${path}${this.matchBody && bodyText ? ':' + bodyText : ''}`; // Compute composite in-memory key
    const entry = this.records.get(key);                                        // Lookup key in JavaScript Map
    if (!entry) return null;                                                    // Cache MISS
    return createStorageMatch({ ...entry, signal: 'HIT' });                     // Cache HIT: return representation with HIT signal
  }

  // Stores response in memory Map with current timestamp
  store({ method, path, bodyText = null, response }) {
    const key = `${method.toUpperCase()}:${path}${this.matchBody && bodyText ? ':' + bodyText : ''}`; // Derive composite in-memory key
    this.records.set(key, {                                                     // Store in Map with zero disk I/O
      statusCode: response.statusCode,                                         // Stored HTTP response status code
      headers: response.headers,                                               // Stored response headers
      body: response.serializedBody,                                           // Stored response body payload
      isBase64: response.isBase64,                                             // Boolean binary flag
      cachedAt: new Date().toISOString()                                       // Record current cache timestamp
    });
  }

  // In-memory unit test entries default to fresh
  isFresh() {
    return true;                                                                // Always considered fresh for testing
  }

  // Touch no-op for basic in-memory adapter
  touch() {}                                                                    // In-memory test entries do not track rolling TTL

  // Flushes all entries from memory Map
  clear() {
    this.records.clear();                                                       // Reset Map
  }

  // Returns total number of cached entries in memory
  count() {
    return this.records.size;                                                   // Return total active keys in Map
  }
}
