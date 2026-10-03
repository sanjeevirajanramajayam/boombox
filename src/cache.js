
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs'; // POSIX file system primitives
import { join } from 'node:path';                                                         // Path concatenation utility
import { createHash } from 'node:crypto';                                                 // Native cryptographic hashing engine (SHA-256)
import { normalizeUrl, normalizeBody } from './normalize.js';                             // Shared canonical query and JSON normalizers
import { createStorageMatch } from './match.js';                                          // Unified representation factory

export { createStorageMatch };

// File-System Storage Seam: Implements RFC 9111 HTTP caching persisted to local disk
export class DiskCacheAdapter {
  constructor(dirOrOptions = '.boombox-cache', maybeOptions = {}) {
    let cacheDir = '.boombox-cache';                                                      // Default cache directory path
    let maxSizeBytes = null;                                                              // Default unbounded disk quota
    let matchBody = false;                                                                // Default off: match POST requests by body

    if (typeof dirOrOptions === 'object' && dirOrOptions !== null) {                      // Support configuration object argument
      cacheDir = dirOrOptions.cacheDir || '.boombox-cache';                               // Custom directory path from options
      maxSizeBytes = dirOrOptions.maxSizeBytes ?? null;                                   // Max disk quota bytes from options
      matchBody = Boolean(dirOrOptions.matchBody);                                        // Enable POST body matching from options
    } else {
      cacheDir = dirOrOptions || '.boombox-cache';                                        // Positional string argument for directory
      maxSizeBytes = maybeOptions.maxSizeBytes ?? null;                                   // Positional options object quota
      matchBody = Boolean(maybeOptions.matchBody);                                        // Positional options object body matching
    }

    this.cacheDir = cacheDir;                                                             // Persist resolved directory path
    this.maxSizeBytes = maxSizeBytes ? parseInt(maxSizeBytes, 10) : null;                 // Parse and store numeric byte quota
    this.matchBody = matchBody;                                                           // Store body-matching toggle

    if (!existsSync(this.cacheDir)) {                                                     // Check directory existence on initialization
      mkdirSync(this.cacheDir, { recursive: true });                                      // Recursively create cache directory tree
    }
  }

  isCacheable(method) {
    const m = method.toUpperCase();                                                       // Normalize HTTP method to uppercase
    return m === 'GET' || m === 'HEAD' || (this.matchBody && m === 'POST');               // Evaluate method cacheability predicate
  }

  lookup({ method, path, headers, bodyText = null }) {
    if (!this.isCacheable(method)) return null;                                           // Bypass lookup if request method is uncacheable

    const entry = this.get(method, path, bodyText, headers);                              // Retrieve cached entry matching request
    if (!entry) return null;                                                              // Return null on storage MISS

    return createStorageMatch({                                                           // Construct uniform representation match object
      statusCode: entry.statusCode,                                                       // Stored HTTP response status code
      headers: entry.headers,                                                             // Stored HTTP response headers
      body: entry.body,                                                                   // Stored payload text or Base64 string
      isBase64: entry.isBase64,                                                           // Binary MIME flag
      cachedAt: entry.cachedAt,                                                           // ISO 8601 storage timestamp
      etag: entry.etag,                                                                   // RFC 9111 entity tag validator
      lastModified: entry.lastModified,                                                   // RFC 9111 last modified timestamp
      maxAge: entry.maxAge,                                                               // Freshness lifetime in seconds
      staleWhileRevalidate: entry.staleWhileRevalidate,                                   // RFC 5861 stale window in seconds
      signal: 'HIT'                                                                       // Cache hit telemetry signal
    });
  }

  store({ method, path, headers, bodyText = null, response }) {
    if (!this.isCacheable(method)) return;                                                // Refuse storage if method is not cacheable
    if (response.statusCode < 200 || response.statusCode >= 300) return;                 // Refuse storage for non-2xx status codes

    this.set(method, path, {                                                              // Write representation to disk
      statusCode: response.statusCode,                                                    // Store upstream status code
      headers: response.headers,                                                          // Store upstream headers dictionary
      body: response.serializedBody,                                                      // Store serialized body payload
      isBase64: response.isBase64                                                         // Store binary encoding flag
    }, bodyText, headers);
  }

  // Pure URL query canonicalizer delegate
  normalizeUrl(rawUrl) {
    return normalizeUrl(rawUrl);                                                          // Sort query parameters alphabetically per RFC 3986
  }

  // Pure JSON body canonicalizer delegate
  normalizeBody(body) {
    return normalizeBody(body);                                                           // Sort top-level JSON keys alphabetically
  }

  computeKey(method, rawUrl, requestBody = null) {
    const canonical = this.normalizeUrl(rawUrl);                                          // Canonicalize query string parameter order
    let serialized = `${method.toUpperCase()}:${canonical}`;                              // Form primary key prefix with uppercase method
    if (requestBody) {                                                                    // Check for request payload (GraphQL / POST)
      const bodyHash = createHash('sha256').update(this.normalizeBody(requestBody)).digest('hex'); // Compute SHA-256 digest of normalized body
      serialized += `:${bodyHash}`;                                                       // Append body hash to primary key string
    }
    return createHash('sha256').update(serialized).digest('hex');                         // Return final SHA-256 hex cache key
  }

  parseMaxAge(cacheControlHeader) {
    if (!cacheControlHeader || typeof cacheControlHeader !== 'string') return null;       // Ignore missing or non-string header
    const match = cacheControlHeader.match(/max-age\s*=\s*(\d+)/i);                       // Extract integer value from max-age directive
    return match ? parseInt(match[1], 10) : null;                                         // Return parsed integer freshness lifetime
  }

  parseStaleWhileRevalidate(cacheControlHeader) {
    if (!cacheControlHeader || typeof cacheControlHeader !== 'string') return null;       // Ignore missing or non-string header
    const match = cacheControlHeader.match(/stale-while-revalidate\s*=\s*(\d+)/i);        // Extract integer value from SWR directive
    return match ? parseInt(match[1], 10) : null;                                         // Return parsed integer stale window duration
  }

  isFresh(entry) {
    if (!entry || !entry.cachedAt) return false;                                          // Unrecorded entries are never fresh
    if (entry.maxAge === null || entry.maxAge === undefined) return true;                 // Indefinite freshness if max-age is omitted

    const ageSeconds = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;          // Calculate elapsed age in fractional seconds
    return ageSeconds < entry.maxAge;                                                     // True if current age is less than max-age
  }

  isStaleWhileRevalidate(entry) {
    if (!entry || !entry.cachedAt || entry.maxAge === null || entry.maxAge === undefined) return false; // Inactive without maxAge
    if (!entry.staleWhileRevalidate) return false;                                        // Inactive without stale-while-revalidate

    const ageSeconds = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;          // Calculate elapsed age in fractional seconds
    return ageSeconds >= entry.maxAge && ageSeconds < (entry.maxAge + entry.staleWhileRevalidate); // Check if within SWR window
  }

  get(method, rawUrl, requestBody = null, requestHeaders = null) {
    const key = this.computeKey(method, rawUrl, requestBody);                             // Generate deterministic storage key
    const filePath = join(this.cacheDir, `${key}.json`);                                  // Form target JSON file path

    if (!existsSync(filePath)) {                                                          // Verify file presence on disk
      return null;                                                                        // Return null on cache MISS
    }

    try {
      const content = readFileSync(filePath, 'utf8');                                     // Synchronously read JSON file from disk
      const data = JSON.parse(content);                                                   // Parse representation JSON envelope

      // If representation contains variants from Vary negotiation
      if (Array.isArray(data.variants) && Array.isArray(data.vary)) {                     // Check for multi-variant Vary structure
        if (!requestHeaders) return null;                                                 // Cannot match variant without request headers

        const matched = data.variants.find(v => {                                         // Search for matching representation variant
          return data.vary.every(headerName => {                                          // Match every header specified in Vary list
            const incoming = requestHeaders instanceof Headers
              ? requestHeaders.get(headerName)                                            // Extract from Web Standard Headers instance
              : (requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()] || null); // Extract from plain object dictionary
            return (v.varyMap?.[headerName] || null) === (incoming || null);              // Exact match between recorded and incoming header
          });
        });

        return matched || null;                                                           // Return matched variant or null on mismatch
      }

      try {
        utimesSync(filePath, new Date(), new Date());                                     // Touch file access time for LRU tracking
      } catch {}

      return data;                                                                        // Return single cached representation
    } catch {
      return null;                                                                        // Gracefully return null on read or parse failure
    }
  }

  set(method, rawUrl, { statusCode, headers, body, isBase64 = false }, requestBody = null, requestHeaders = null) {
    const key = this.computeKey(method, rawUrl, requestBody);                             // Compute primary storage key
    const filePath = join(this.cacheDir, `${key}.json`);                                  // Compute destination cache file path

    const headersMap = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers; // Normalize to plain object
    const cacheControl = headersMap['cache-control'] || headersMap['Cache-Control'];      // Extract Cache-Control header
    const etag = headersMap['etag'] || headersMap['ETag'] || null;                        // Extract ETag validator token
    const lastModified = headersMap['last-modified'] || headersMap['Last-Modified'] || null; // Extract Last-Modified timestamp
    const varyHeader = headersMap['vary'] || headersMap['Vary'] || null;                  // Extract Vary negotiation header

    const singleData = {                                                                  // Construct representation record
      statusCode,                                                                         // Upstream HTTP response status
      headers: headersMap,                                                                // Serialized headers dictionary
      body,                                                                               // Payload body string or Base64
      isBase64: Boolean(isBase64),                                                        // Binary flag
      maxAge: this.parseMaxAge(cacheControl),                                             // Parsed freshness lifetime in seconds
      staleWhileRevalidate: this.parseStaleWhileRevalidate(cacheControl),                 // Parsed SWR window in seconds
      etag,                                                                               // Validator ETag
      lastModified,                                                                       // Validator Last-Modified
      cachedAt: new Date().toISOString()                                                  // Snapshot storage timestamp
    };

    if (varyHeader && typeof varyHeader === 'string') {                                   // Handle Vary multi-variant negotiation
      const varyNames = varyHeader.split(',').map(s => s.trim().toLowerCase()).filter(Boolean); // Parse list of varied header names
      const requestVaryMap = {};                                                          // Map to store current request's varied values

      if (requestHeaders) {                                                               // Extract incoming request varied header values
        for (const name of varyNames) {
          const val = requestHeaders instanceof Headers
            ? requestHeaders.get(name)                                                    // Extract from Headers instance
            : (requestHeaders[name] || requestHeaders[name.toLowerCase()] || null);       // Extract from plain object
          requestVaryMap[name] = val || null;                                             // Record header value in variant map
        }
      }

      let existing = null;                                                                // Container for existing cache record
      if (existsSync(filePath)) {                                                         // Check if variant file already exists
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf8'));                          // Read and parse existing variant envelope
        } catch {}
      }

      const existingVariants = Array.isArray(existing?.variants) ? existing.variants : []; // Extract existing variant list
      // Remove prior variant with identical varyMap to prevent stale duplicates
      const filteredVariants = existingVariants.filter(v => {
        return !varyNames.every(name => v.varyMap?.[name] === requestVaryMap[name]);
      });

      filteredVariants.push({                                                             // Append new representation variant
        ...singleData,
        varyMap: requestVaryMap
      });

      const parentEntry = {                                                               // Construct multi-variant parent container
        method: method.toUpperCase(),                                                     // HTTP method
        url: rawUrl,                                                                      // Request URL
        vary: varyNames,                                                                  // List of varied header keys
        variants: filteredVariants                                                        // Array of representation variants
      };

      writeFileSync(filePath, JSON.stringify(parentEntry, null, 2), 'utf8');              // Persist multi-variant envelope to disk
    } else {
      const entry = {                                                                     // Construct single-representation record
        ...singleData,
        method: method.toUpperCase(),
        url: rawUrl
      };
      writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');                    // Persist single representation to disk
    }

    this.evictIfNecessary();                                                              // Trigger LRU quota check after write
  }

  touch(firstArg, rawUrl = null, requestBody = null, requestHeaders = null) {
    let method, path, body, headers;
    if (typeof firstArg === 'object' && firstArg !== null) {                              // Support object parameter overload
      method = firstArg.method;
      path = firstArg.path;
      body = firstArg.bodyText ?? null;
      headers = firstArg.headers ?? null;
    } else {                                                                              // Support positional arguments
      method = firstArg;
      path = rawUrl;
      body = requestBody;
      headers = requestHeaders;
    }

    const key = this.computeKey(method, path, body);                                      // Calculate cache key
    const filePath = join(this.cacheDir, `${key}.json`);                                  // Resolve cache file path

    if (!existsSync(filePath)) return;                                                    // Ignore if representation does not exist

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));                           // Read cached data
      if (Array.isArray(data.variants) && Array.isArray(data.vary) && headers) {          // If variant entry, update matching variant
        const variant = data.variants.find(v => {
          return data.vary.every(headerName => {
            const incoming = headers instanceof Headers
              ? headers.get(headerName)
              : (headers[headerName] || headers[headerName.toLowerCase()] || null);
            return (v.varyMap?.[headerName] || null) === (incoming || null);
          });
        });

        if (variant) {
          variant.cachedAt = new Date().toISOString();                                    // Reset freshness timestamp on variant
          writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');                // Write back updated timestamp
        }
      } else {
        data.cachedAt = new Date().toISOString();                                         // Reset freshness timestamp on single record
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');                  // Write back updated timestamp
      }
    } catch {}
  }

  evictIfNecessary() {
    if (!this.maxSizeBytes || this.maxSizeBytes <= 0) return;                             // Skip if quota is unbounded
    if (!existsSync(this.cacheDir)) return;                                               // Skip if directory does not exist

    try {
      const files = readdirSync(this.cacheDir)                                            // Read directory file listing
        .filter(f => f.endsWith('.json'))                                                 // Restrict to cache JSON files
        .map(name => {
          const fullPath = join(this.cacheDir, name);                                     // Absolute file path
          try {
            const st = statSync(fullPath);                                                // Query file stats (size, atime, mtime)
            return {
              name,
              fullPath,
              size: st.size,
              mtimeMs: st.mtimeMs,
              atimeMs: st.atimeMs
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      let totalSize = files.reduce((acc, f) => acc + f.size, 0);                          // Sum total cache size in bytes
      if (totalSize <= this.maxSizeBytes) return;                                         // Quota respected, no eviction needed

      // Sort by last accessed / modified time ascending (oldest first)
      files.sort((a, b) => (a.mtimeMs || a.atimeMs) - (b.mtimeMs || b.atimeMs));          // Oldest timestamp at index 0

      const targetWatermark = Math.floor(this.maxSizeBytes * 0.8);                        // Evict down to 80% watermark to prevent thrashing
      for (const f of files) {
        if (totalSize <= targetWatermark) break;                                          // Stop once storage drops below watermark
        try {
          unlinkSync(f.fullPath);                                                         // Delete oldest file
          totalSize -= f.size;                                                            // Decrement running byte total
        } catch {}
      }
    } catch {}
  }

  // Purge all stored cache files from disk
  clear() {
    if (existsSync(this.cacheDir)) {                                                      // Check if directory exists
      rmSync(this.cacheDir, { recursive: true, force: true });                            // Recursively remove directory
    }
    mkdirSync(this.cacheDir, { recursive: true });                                        // Recreate fresh empty cache directory
  }

  // Count total cached JSON representations
  count() {
    if (!existsSync(this.cacheDir)) return 0;                                             // Zero if directory missing
    return readdirSync(this.cacheDir).filter(f => f.endsWith('.json')).length;            // Count valid JSON files
  }
}

export const CacheManager = DiskCacheAdapter;                                             // Alias for backwards compatibility


