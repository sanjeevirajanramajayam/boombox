
import { Buffer } from 'node:buffer';                                                          // Explicit Buffer import for Cloudflare Workers nodejs_compat

// Set containing all 8 connection-specific hop-by-hop headers defined in RFC 9110 §7.6.1
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',          // Controls hop connection options (close/keep-alive)
  'keep-alive',          // Socket persistence timeout for immediate link
  'proxy-authenticate',  // Authentication challenges issued by local proxy
  'proxy-authorization', // Credentials meant for local proxy tollgate
  'te',                  // Transfer encodings client accepts on immediate hop
  'trailer',             // Informs receiver of trailing headers after chunked body
  'transfer-encoding',   // Transport framing (chunked) for immediate hop
  'upgrade'              // Protocol switch request (e.g. HTTP to WebSocket)
]);

// Strips hop-by-hop headers so they are never leaked upstream or downstream
export function filterHeaders(headers) {
  const filtered = {};                                                                    // Object to hold clean end-to-end headers
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers); // Support Web Standard Headers or plain object
  for (const [key, value] of entries) {                                                   // Iterate through every header entry
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {                                     // Check against lowercased hop-by-hop blacklist
      filtered[key] = value;                                                              // Retain legitimate end-to-end application header
    }
  }
  return filtered;                                                                        // Return sanitized header dictionary
}

// Determines if media payload is raw binary bytes requiring Base64 serialization
export function isBinaryContentType(contentType) {
  if (!contentType) return false;                                                         // Missing Content-Type defaults to text
  const ct = contentType.toLowerCase();                                                   // Normalize to lowercase for case-insensitive matching
  return ct.startsWith('image/') ||                                                       // PNG, JPEG, GIF, WebP images
         ct.startsWith('audio/') ||                                                       // MP3, WAV, OGG audio files
         ct.startsWith('video/') ||                                                       // MP4, WebM video files
         ct.includes('octet-stream') ||                                                   // Raw binary blob data
         ct.includes('pdf') ||                                                            // Adobe PDF documents
         ct.includes('zip') ||                                                            // Compressed ZIP archives
         ct.includes('gzip');                                                             // GZIP compressed payloads
}

// Network Seam: Responsible for all outbound HTTP interactions to live origins
export class OriginTransport {
  constructor({ origin = null, redirect = 'follow', timeoutMs = 30000 } = {}) {
    this.origin = origin ? origin.replace(/\/+$/, '') : null;                            // Normalize origin by stripping trailing slashes
    this.redirect = redirect;                                                             // HTTP redirect policy ('follow' or 'manual')
    this.timeoutMs = timeoutMs;                                                           // Upstream connection timeout in milliseconds
  }

  // Executes upstream HTTP fetch, sanitizes headers, tracks latency, and encodes payload
  async forward({ method, path, headers = {}, bodyText = null }) {
    if (!this.origin) {                                                                   // Guard against unconfigured upstream target
      throw new Error('Cannot forward: OriginTransport has no upstream origin configured.'); // Fail-fast with clear configuration error
    }

    const startTime = performance.now();                                                  // High-resolution start timestamp (W3C High Res Time)
    const forwardHeaders = new Headers();                                                 // Web Standard Headers container for upstream request
    const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers); // Normalize input headers to iterable entries

    for (const [key, value] of entries) {                                                 // Loop over inbound client headers
      const lower = key.toLowerCase();                                                    // Case-insensitive header name comparison
      if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'host') {                           // Strip hop-by-hop headers and client's local Host
        forwardHeaders.set(key, value);                                                   // Forward legitimate client header upstream
      }
    }

    forwardHeaders.set('host', new URL(this.origin).host);                                // Rewrite Host header to match upstream origin domain

    const fetchOptions = {
      method: method.toUpperCase(),                                                       // Standardize HTTP verb (GET, POST, etc.)
      headers: forwardHeaders,                                                            // Attach sanitized headers with rewritten Host
      redirect: this.redirect                                                             // Enforce configured redirect behavior
    };

    if (bodyText) {                                                                       // Check if request carries a body payload
      fetchOptions.body = bodyText;                                                       // Attach body to outbound fetch options
    }

    try {
      const originResponse = await fetch(`${this.origin}${path}`, fetchOptions);          // Dispatch live HTTP fetch over loopback/internet
      const originStatus = originResponse.status;                                         // Capture upstream HTTP response status code

      const outHeaders = {};                                                              // Container for sanitized response headers
      for (const [k, v] of originResponse.headers.entries()) {                            // Iterate over origin response headers
        const lower = k.toLowerCase();                                                    // Case-insensitive header key comparison
        if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'content-encoding') {             // Strip hop-by-hop and auto-decompressed encoding
          outHeaders[k] = v;                                                              // Store clean header for client and cache storage
        }
      }

      const originArrayBuffer = await originResponse.arrayBuffer();                       // Read entire body as raw binary ArrayBuffer
      const originBuffer = Buffer.from(originArrayBuffer);                                // Wrap ArrayBuffer in Node/Bun Buffer instance
      const contentType = outHeaders['content-type'] || outHeaders['Content-Type'] || ''; // Extract Content-Type header value
      const isBinary = isBinaryContentType(contentType);                                  // Sniff if payload requires Base64 serialization
      const serializedBody = isBinary ? originBuffer.toString('base64') : originBuffer.toString('utf8'); // Encode as Base64 or UTF-8 string
      const durationMs = performance.now() - startTime;                                   // Compute total round-trip latency in milliseconds

      return {
        statusCode: originStatus,                                                         // Upstream HTTP status (e.g. 200, 404, 500)
        headers: outHeaders,                                                              // Sanitized end-to-end response headers
        buffer: originBuffer,                                                             // Raw binary buffer for streaming client response
        isBase64: isBinary,                                                               // Flag indicating whether serializedBody is Base64
        serializedBody,                                                                   // Stringified body for JSON cassette persistence
        durationMs                                                                        // Round-trip network duration in milliseconds
      };
    } catch (err) {
      const durationMs = performance.now() - startTime;                                   // Compute elapsed duration before error caught
      const error = new Error(`502 Bad Gateway: Failed connecting to origin ${this.origin} - ${err.message}`); // Wrap network drop in 502
      error.statusCode = 502;                                                             // Set explicit HTTP 502 status on error object
      error.durationMs = durationMs;                                                      // Record error duration for metrics telemetry
      throw error;                                                                        // Re-throw to caller (ProxyPipeline)
    }
  }
}
