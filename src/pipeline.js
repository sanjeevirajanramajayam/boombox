
import { ChaosEngine } from './chaos.js';                                                 // Resilience middleware for latency and synthetic faults
import { MetricsCollector } from './metrics.js';                                         // Telemetry aggregator for transaction hit rates
import { OriginTransport, filterHeaders } from './transport.js';                          // Outbound HTTP fetch abstraction and hop header filter
import { Buffer } from 'node:buffer';                                                     // Explicit Buffer import for Cloudflare Workers nodejs_compat

export class ProxyPipeline {
  constructor({
    origin = null,                                                                        // Default upstream origin host (e.g. 'https://dummyjson.com')
    storage,                                                                              // Injected storage adapter (Disk, Memory, or Cassette)
    transport = null,                                                                     // Injected or dynamically created outbound HTTP transport
    chaos = null,                                                                         // Fault injection engine instance
    telemetry = null,                                                                     // Metrics collector instance
    cassette = false                                                                      // Boolean flag toggling VCR cassette recording signal
  } = {}) {
    this.origin = origin ? origin.replace(/\/+$/, '') : null;                            // Normalize origin by stripping trailing slashes
    this.storage = storage;                                                               // Store reference to persistence adapter
    this.transport = transport || (this.origin ? new OriginTransport({ origin: this.origin, redirect: 'follow' }) : null); // Initialize default transport
    this.chaos = chaos || new ChaosEngine();                                              // Fallback to inert chaos engine if not provided
    this.telemetry = telemetry || new MetricsCollector();                                 // Fallback to fresh metrics collector if not provided
    this.cassette = Boolean(cassette);                                                    // Normalize cassette flag to strict boolean
  }

  setOrigin(newOrigin) {
    this.origin = newOrigin ? newOrigin.replace(/\/+$/, '') : null;                      // Strip trailing slashes from updated origin URL
    this.transport = this.origin ? new OriginTransport({ origin: this.origin, redirect: 'follow' }) : null; // Rebind transport to new origin
  }

  async dispatch(req, ctx = {}) {
    const startTime = performance.now();                                                  // Benchmark start timestamp for latency telemetry
    const url = new URL(req.url);                                                         // Parse incoming request URL structure
    const method = req.method.toUpperCase();                                              // Normalize HTTP verb to uppercase

    let requestBodyText = null;                                                           // Storage variable for serialized request payload
    if (req.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {      // Only read payload on mutating HTTP methods
      if (typeof req.text === 'function') {                                               // Check for Web Standard ReadableStream text() method
        requestBodyText = await req.text();                                               // Buffer entire request body text for matching and hashing
      }
    }

    // ==========================================
    // ADMIN CONTROL PLANE: Dynamic Origin Management
    // ==========================================
    if (url.pathname === '/_boombox/origin') {                                            // Intercept reserved admin control route
      if (method === 'POST') {                                                            // Mutation: update default origin dynamically
        try {
          const bodyJson = JSON.parse(requestBodyText || '{}');                           // Parse JSON payload containing new origin
          if (bodyJson.origin) {                                                          // Validate origin attribute existence
            this.setOrigin(bodyJson.origin);                                              // Apply origin change across pipeline
            return Response.json({ success: true, origin: this.origin });                 // Return 200 OK with confirmed active origin
          }
          return Response.json({ error: 'MISSING_ORIGIN', message: 'Field "origin" is required.' }, { status: 400 }); // Reject missing origin field
        } catch (err) {
          return Response.json({ error: 'INVALID_JSON', message: err.message }, { status: 400 }); // Reject malformed JSON body
        }
      }
      if (method === 'GET') {                                                             // Query: return currently active default origin
        return Response.json({ origin: this.origin });                                    // Return JSON envelope with current origin
      }
    }

    // ==========================================
    // DYNAMIC TARGET & MULTI-ORIGIN EXTRACTION
    // ==========================================
    const rawPath = url.pathname + url.search;                                            // Full relative path including query string
    const customOriginHeader = req.headers.get('x-boombox-origin') || req.headers.get('x-target-origin'); // Extract dynamic origin headers

    let activeOrigin = this.origin;                                                       // Default target origin
    let targetPath = rawPath;                                                             // Default upstream forward path
    let storageKeyPath = rawPath;                                                         // Default cache storage partition key

    // Pattern 1: Transparent Full-URL Proxying (e.g. /https://api.stripe.com/v1/charges)
    const trimmedPath = url.pathname.replace(/^\/+/, '');                                 // Strip leading slash to inspect embedded scheme
    if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {        // Detect embedded absolute HTTP/HTTPS URL
      try {
        const fullUrl = new URL(trimmedPath + url.search);                                // Parse embedded absolute target URL
        activeOrigin = fullUrl.origin;                                                    // Extract target origin protocol and host
        targetPath = fullUrl.pathname + fullUrl.search;                                   // Extract target path and query parameters
        storageKeyPath = fullUrl.toString();                                              // Full URL as cache key prevents cross-origin collision!
      } catch {}
    } else if (customOriginHeader) {                                                      // Pattern 2: Per-request header override
      activeOrigin = customOriginHeader.replace(/\/+$/, '');                              // Strip trailing slash from header-specified origin
      storageKeyPath = `${activeOrigin}${rawPath}`;                                       // Salt cache key with origin to prevent collisions
    }

    // Instantiate dynamic transport if active target differs from default configured origin
    const activeTransport = (activeOrigin && activeOrigin !== this.origin)
      ? new OriginTransport({ origin: activeOrigin, redirect: 'follow' })
      : this.transport;

    // ==========================================
    // STAGE 1: Chaos Simulation Middleware
    // ==========================================
    const chaosResponse = await this.chaos.evaluate(targetPath);                          // Check for synthetic delays, flakes, or overrides
    if (chaosResponse) {                                                                  // Fault injection triggered short-circuit
      this.telemetry.record({                                                             // Log telemetry event for observability
        method,
        path: targetPath,
        status: chaosResponse.status,
        cacheSignal: chaosResponse.headers.get('x-chaos') || 'CHAOS',
        durationMs: performance.now() - startTime
      });
      return chaosResponse;                                                               // Return synthetic error or delay immediately
    }

    // ==========================================
    // STAGE 2: Storage Lookup (Cache / VCR)
    // ==========================================
    const cached = await this.storage.lookup({                                            // Query storage adapter for matching representation
      method,
      path: storageKeyPath,
      headers: req.headers,
      bodyText: requestBodyText,
      request: req
    });

    if (cached) {
      if (cached.isOfflineMiss) {                                                         // Cassette replay mode with unrecorded interaction
        this.telemetry.record({
          method,
          path: targetPath,
          status: 502,
          cacheSignal: 'MISS',
          durationMs: performance.now() - startTime
        });

        return Response.json({                                                            // Fail-fast with structured 502 error payload
          error: cached.errorMessage,
          method,
          url: targetPath
        }, {
          status: 502,
          headers: { 'X-Cache': 'MISS' }
        });
      }

      // Reconstruct buffer or string payload depending on Base64 binary flag
      const cachedBody = cached.isBase64
        ? (typeof Buffer !== 'undefined' ? Buffer.from(cached.body, 'base64') : cached.body)
        : cached.body;

      // 1. Fresh representation HIT (RFC 9111 §3.2)
      if (this.storage.isFresh(cached)) {                                                 // Representation is within max-age freshness TTL
        const resHeaders = new Headers(filterHeaders(cached.headers));                     // Sanitize stored headers and strip hop-by-hop
        resHeaders.set('X-Cache', cached.signal || 'HIT');                                 // Attach cache telemetry signal header

        this.telemetry.record({                                                           // Record successful cache hit in metrics
          method,
          path: targetPath,
          status: cached.statusCode,
          cacheSignal: cached.signal || 'HIT',
          durationMs: performance.now() - startTime
        });

        return new Response(method === 'HEAD' ? null : cachedBody, {                      // Return cached representation (omit body on HEAD)
          status: cached.statusCode,
          headers: resHeaders
        });
      }

      // 2. RFC 5861 stale-while-revalidate Window
      if (this.storage.isStaleWhileRevalidate?.(cached)) {                                 // Representation is expired but within SWR window
        const resHeaders = new Headers(filterHeaders(cached.headers));                     // Prepare client response headers
        resHeaders.set('X-Cache', 'STALE');                                               // Signal that served representation is stale

        this.telemetry.record({                                                           // Record stale cache hit in metrics
          method,
          path: targetPath,
          status: cached.statusCode,
          cacheSignal: 'STALE',
          durationMs: performance.now() - startTime
        });

        if (activeTransport) {                                                            // Trigger asynchronous background revalidation
          const revalPromise = activeTransport.forward({                                  // Fetch fresh representation from live upstream origin
            method,
            path: targetPath,
            headers: req.headers,
            bodyText: requestBodyText
          }).then(upstream => {
            return this.storage.store({                                                   // Persist updated representation into storage adapter
              method,
              path: storageKeyPath,
              headers: req.headers,
              bodyText: requestBodyText,
              response: upstream,
              request: req
            });
          }).catch(() => {});                                                             // Swallow background errors to protect main thread

          if (ctx && typeof ctx.waitUntil === 'function') {                               // Cloudflare Workers execution extension
            ctx.waitUntil(revalPromise);                                                  // Keep isolate alive until background reval completes
          }
        }

        return new Response(method === 'HEAD' ? null : cachedBody, {                      // Deliver stale representation immediately to client
          status: cached.statusCode,
          headers: resHeaders
        });
      }

      // 3. Conditional 304 Revalidation (RFC 9111 §4.3: ETag / If-Modified-Since)
      if (activeOrigin && activeTransport && (cached.etag || cached.lastModified)) {       // Check for stored validation tokens
        try {
          const condHeaders = new Headers();                                              // Construct conditional upstream request headers
          if (cached.etag) condHeaders.set('If-None-Match', cached.etag);                  // Attach validator ETag
          if (cached.lastModified) condHeaders.set('If-Modified-Since', cached.lastModified); // Attach validator Last-Modified timestamp

          const upstream = await activeTransport.forward({                                // Execute conditional GET to origin
            method,
            path: targetPath,
            headers: condHeaders,
            bodyText: requestBodyText
          });

          if (upstream.statusCode === 304) {                                              // Origin confirmed unmodified representation
            this.storage.touch({                                                          // Update cachedAt timestamp to reset freshness TTL
              method,
              path: storageKeyPath,
              headers: req.headers,
              bodyText: requestBodyText
            });

            const revalHeaders = new Headers(filterHeaders(cached.headers));               // Rebuild client headers from cached representation
            revalHeaders.set('X-Cache', 'REVALIDATED');                                   // Signal successful 304 revalidation

            this.telemetry.record({                                                       // Record revalidation in telemetry
              method,
              path: targetPath,
              status: cached.statusCode,
              cacheSignal: 'REVALIDATED',
              durationMs: performance.now() - startTime
            });

            return new Response(method === 'HEAD' ? null : cachedBody, {                  // Deliver revalidated cached representation
              status: cached.statusCode,
              headers: revalHeaders
            });
          }
        } catch {
          // Fall through to full upstream forward if conditional check fails
        }
      }
    }

    // ==========================================
    // STAGE 3: Upstream Forward & Store
    // ==========================================
    if (!activeTransport) {                                                               // Guard against unconfigured upstream target
      return Response.json({                                                              // Return actionable error guidance
        error: 'ORIGIN_NOT_CONFIGURED',
        message: 'No upstream origin configured to satisfy request. Use --origin, X-Boombox-Origin header, or transparent URL (/https://domain/path).'
      }, { status: 500 });
    }

    try {
      const upstream = await activeTransport.forward({                                    // Forward request payload and headers to live origin
        method,
        path: targetPath,
        headers: req.headers,
        bodyText: requestBodyText
      });

      const storePromise = this.storage.store({                                           // Persist response into storage adapter
        method,
        path: storageKeyPath,
        headers: req.headers,
        bodyText: requestBodyText,
        response: upstream,
        request: req
      });

      if (ctx && typeof ctx.waitUntil === 'function') {                                   // Extend edge worker execution if asynchronous
        ctx.waitUntil(Promise.resolve(storePromise));                                     // Ensure disk or remote KV write finishes
      } else {
        await storePromise;                                                               // Await storage write in standard Node/Bun environments
      }

      const clientHeaders = new Headers(upstream.headers);                                // Clone upstream headers for downstream client
      const signal = this.cassette ? 'RECORD' : (this.storage.isCacheable?.(method) ? 'MISS' : 'BYPASS'); // Determine cache header signal
      clientHeaders.set('X-Cache', signal);                                               // Stamp cache header on outgoing response

      this.telemetry.record({                                                             // Log upstream transaction in metrics
        method,
        path: targetPath,
        status: upstream.statusCode,
        cacheSignal: signal,
        durationMs: performance.now() - startTime
      });

      return new Response(method === 'HEAD' ? null : (upstream.buffer || upstream.serializedBody), { // Deliver live upstream response to client
        status: upstream.statusCode,
        headers: clientHeaders
      });
    } catch (err) {                                                                       // Intercept connection drops or DNS failures
      this.telemetry.record({                                                             // Record 502 error in telemetry
        method,
        path: targetPath,
        status: 502,
        cacheSignal: 'ERROR',
        durationMs: performance.now() - startTime
      });

      return new Response(err.message, {                                                  // Enforce clean 502 Bad Gateway boundary
        status: 502,
        headers: { 'Content-Type': 'text/plain', 'X-Cache': 'MISS' }
      });
    }
  }
}

