
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'; // Node filesystem methods for cassette persistence
import { join } from 'node:path';                                             // Path joining utility for cross-platform file paths
import { createHash } from 'node:crypto';                                     // Cryptographic hashing for deterministic body matching
import { normalizeUrl, normalizeBody } from './normalize.js';                 // Shared canonical URL and body normalization utilities

// Baseline sensitive headers scrubbed per OWASP API Security guidelines
const DEFAULT_REDACT_HEADERS = [
  'authorization',       // Bearer tokens, Basic auth credentials
  'cookie',              // Inbound session identifiers
  'set-cookie',          // Outbound session initialization cookies
  'x-api-key',           // Custom API keys (e.g. Stripe, OpenAI)
  'api-key',             // Generic API key headers
  'proxy-authorization'  // Proxy tollgate credentials
];

// Manages recording, replaying, and persisting HTTP interaction cassette tapes
export class CassetteManager {
  constructor({ cassetteName, cassetteDir = 'cassettes', mode = 'auto', redact = [], matchBody = false } = {}) {
    this.cassetteName = cassetteName;                                         // Name of the cassette tape fixture (e.g. 'checkout')
    this.cassetteDir = cassetteDir;                                           // Directory where tape JSON files are stored on disk
    this.mode = mode.toLowerCase();                                           // Operational mode: 'record', 'replay', or 'auto'
    this.matchBody = Boolean(matchBody);                                      // Flag enabling body-aware hashing (essential for GraphQL)
    this.filePath = join(this.cassetteDir, `${this.cassetteName}.json`);       // Absolute or relative file path to cassette JSON

    this.interactions = new Map();                                            // Map<routeKey, Array<Interaction>> storing sequential tapes
    this.playbackIndices = new Map();                                         // Map<routeKey, number> tracking sequential cursor position

    const customRedact = Array.isArray(redact) ? redact : [redact].filter(Boolean); // Normalize user custom redaction list to array
    this.redactHeadersSet = new Set([                                         // Construct unified Set of lowercase header names to scrub
      ...DEFAULT_REDACT_HEADERS,                                              // Default security headers
      ...customRedact.map(h => h.toLowerCase().trim())                        // User-supplied custom headers
    ]);

    if (!['record', 'replay', 'auto'].includes(this.mode)) {                  // Guard against unsupported operational modes
      throw new Error(`Invalid VCR mode: "${this.mode}". Must be "record", "replay", or "auto".`); // Fail-fast with informative error
    }

    if (!existsSync(this.cassetteDir)) {                                      // Check if destination cassette directory exists on disk
      mkdirSync(this.cassetteDir, { recursive: true });                       // Recursively create cassette directory if absent
    }

    this.load();                                                              // Preload existing cassette file from disk into memory
  }

  // Normalizes URL by delegating to shared RFC 3986 normalization utility
  normalizeUrl(rawUrl) {
    return normalizeUrl(rawUrl);                                              // Delegate to shared normalizeUrl utility
  }

  // Normalizes JSON request bodies by delegating to shared canonical body utility
  normalizeBody(body) {
    return normalizeBody(body);                                               // Delegate to shared normalizeBody utility
  }


  // Computes unique composite index key: METHOD:URL[:BODY_HASH]
  key(method, rawUrl, requestBody = null) {
    let k = `${method.toUpperCase()}:${this.normalizeUrl(rawUrl)}`;           // Base key combines uppercase verb and normalized URL
    if (this.matchBody && requestBody) {                                      // When body matching is enabled and body exists
      const bodyHash = createHash('sha256').update(this.normalizeBody(requestBody)).digest('hex'); // Compute SHA-256 digest of normalized body
      k += `:${bodyHash}`;                                                    // Append body hash to route key
    }
    return k;                                                                 // Return composite indexing key
  }

  // Loads cassette tape from disk and partitions interactions into sequential queues
  load() {
    this.interactions.clear();                                                // Reset in-memory interaction map
    this.playbackIndices.clear();                                             // Reset sequential playback cursors
    if (existsSync(this.filePath)) {                                          // Check if cassette tape file exists on disk
      try {
        const raw = readFileSync(this.filePath, 'utf8');                      // Read raw JSON string from disk
        const data = JSON.parse(raw);                                         // Parse JSON array of recorded interactions
        for (const item of data) {                                            // Iterate through each recorded interaction
          const k = this.key(item.method, item.url, item.requestBody);        // Recompute indexing key for interaction
          if (!this.interactions.has(k)) {                                    // If key does not exist yet in map
            this.interactions.set(k, []);                                     // Initialize empty array for sequential interactions
          }
          this.interactions.get(k).push(item);                                // Push interaction onto route sequence array
        }
      } catch {
        this.interactions.clear();                                            // Clear map on JSON corruption to avoid undefined state
      }
    }
  }

  // Matches incoming request against sequential tape; advances cursor monotonically
  match(method, rawUrl, requestBody = null) {
    const k = this.key(method, rawUrl, requestBody);                          // Derive key for inbound request
    const sequence = this.interactions.get(k);                                // Fetch sequence of recorded interactions for route
    if (!sequence || sequence.length === 0) return null;                      // Return null if route was never recorded

    const currentIndex = this.playbackIndices.get(k) || 0;                    // Read current sequential cursor index (default: 0)
    const item = currentIndex < sequence.length                               // Check if cursor is within sequence bounds
      ? sequence[currentIndex]                                                // Return current item in sequence
      : sequence[sequence.length - 1];                                        // Terminal stickiness: Repeat final state indefinitely

    this.playbackIndices.set(k, currentIndex + 1);                            // Advance playback cursor monotonically for next request
    return item;                                                              // Return matched interaction representation
  }

  // Scrubs sensitive credentials from header dictionary before persistence
  sanitizeHeaders(headers) {
    const sanitized = {};                                                     // Container for sanitized headers
    for (const [k, v] of Object.entries(headers)) {                           // Iterate over all header name/value pairs
      if (this.redactHeadersSet.has(k.toLowerCase())) {                       // Check if header name matches redaction blacklist
        sanitized[k] = '[REDACTED]';                                          // Replace credential with safe placeholder string
      } else {
        sanitized[k] = v;                                                     // Retain benign application header unmodified
      }
    }
    return sanitized;                                                         // Return scrubbed headers object
  }

  // Appends interaction to route sequence and commits updated tape to disk
  record(method, rawUrl, { statusCode, headers, body, isBase64 = false }, requestBody = null) {
    const canonicalUrl = this.normalizeUrl(rawUrl);                           // Compute canonical normalized URL
    const item = {
      method: method.toUpperCase(),                                           // Uppercase HTTP method (GET, POST, etc.)
      url: canonicalUrl,                                                      // Normalized URL path with sorted query parameters
      requestBody: this.matchBody && requestBody ? this.normalizeBody(requestBody) : undefined, // Normalized body if enabled
      statusCode,                                                             // HTTP response status code (e.g. 200, 201)
      headers: this.sanitizeHeaders(headers),                                 // Scrubbed response headers
      body,                                                                   // Payload string (UTF-8 or Base64)
      isBase64: Boolean(isBase64),                                            // Flag specifying if payload is Base64 binary
      recordedAt: new Date().toISOString()                                    // ISO 8601 recording timestamp
    };

    const k = this.key(method, rawUrl, requestBody);                          // Derive indexing key for route
    if (!this.interactions.has(k)) {                                          // If route sequence does not exist yet
      this.interactions.set(k, []);                                           // Initialize new array for route
    }
    this.interactions.get(k).push(item);                                      // Append interaction frame to sequential queue
    this.flush();                                                             // Immediately persist updated tape to disk
  }

  // Flattens grouped route interactions into a single linear array and writes to disk
  flush() {
    const list = Array.from(this.interactions.values()).flat();               // Flatten all route interaction arrays into one flat list
    writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');       // Write formatted JSON file to filesystem
  }

  // Counts total number of recorded interaction frames across all routes
  count() {
    let total = 0;                                                            // Accumulator for interaction frames
    for (const list of this.interactions.values()) {                          // Iterate over each route interaction array
      total += list.length;                                                   // Add count of interactions in route array
    }
    return total;                                                             // Return total count
  }
}
