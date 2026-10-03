
import { ChaosEngine } from './chaos.js';
import { MetricsCollector } from './metrics.js';
import { OriginTransport, filterHeaders } from './transport.js';
import { Buffer } from 'node:buffer';

export class ProxyPipeline {
  constructor({
    origin = null,
    storage,
    transport = null,
    chaos = null,
    telemetry = null,
    cassette = false
  } = {}) {
    this.origin = origin ? origin.replace(/\/+$/, '') : null;
    this.storage = storage;
    this.transport = transport || (this.origin ? new OriginTransport({ origin: this.origin, redirect: 'follow' }) : null);
    this.chaos = chaos || new ChaosEngine();
    this.telemetry = telemetry || new MetricsCollector();
    this.cassette = Boolean(cassette);
  }

  setOrigin(newOrigin) {
    this.origin = newOrigin ? newOrigin.replace(/\/+$/, '') : null;
    this.transport = this.origin ? new OriginTransport({ origin: this.origin, redirect: 'follow' }) : null;
  }

  async dispatch(req, ctx = {}) {
    const startTime = performance.now();
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    let requestBodyText = null;
    if (req.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      if (typeof req.text === 'function') {
        requestBodyText = await req.text();
      }
    }

    // ==========================================
    // ADMIN CONTROL PLANE: Dynamic Origin Management
    // ==========================================
    if (url.pathname === '/_boombox/origin') {
      if (method === 'POST') {
        try {
          const bodyJson = JSON.parse(requestBodyText || '{}');
          if (bodyJson.origin) {
            this.setOrigin(bodyJson.origin);
            return Response.json({ success: true, origin: this.origin });
          }
          return Response.json({ error: 'MISSING_ORIGIN', message: 'Field "origin" is required.' }, { status: 400 });
        } catch (err) {
          return Response.json({ error: 'INVALID_JSON', message: err.message }, { status: 400 });
        }
      }
      if (method === 'GET') {
        return Response.json({ origin: this.origin });
      }
    }

    // ==========================================
    // DYNAMIC TARGET & MULTI-ORIGIN EXTRACTION
    // ==========================================
    const rawPath = url.pathname + url.search;
    const customOriginHeader = req.headers.get('x-boombox-origin') || req.headers.get('x-target-origin');

    let activeOrigin = this.origin;
    let targetPath = rawPath;
    let storageKeyPath = rawPath;

    // Pattern 1: Transparent Full-URL Proxying (e.g. /https://api.stripe.com/v1/charges or /http://...)
    const trimmedPath = url.pathname.replace(/^\/+/, '');
    if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {
      try {
        const fullUrl = new URL(trimmedPath + url.search);
        activeOrigin = fullUrl.origin;
        targetPath = fullUrl.pathname + fullUrl.search;
        storageKeyPath = fullUrl.toString(); // Full URL prevents cross-origin cache collision!
      } catch {}
    } else if (customOriginHeader) {
      activeOrigin = customOriginHeader.replace(/\/+$/, '');
      storageKeyPath = `${activeOrigin}${rawPath}`;
    }

    const activeTransport = (activeOrigin && activeOrigin !== this.origin)
      ? new OriginTransport({ origin: activeOrigin, redirect: 'follow' })
      : this.transport;

    // ==========================================
    // STAGE 1: Chaos Simulation Middleware
    // ==========================================
    const chaosResponse = await this.chaos.evaluate(targetPath);
    if (chaosResponse) {
      this.telemetry.record({
        method,
        path: targetPath,
        status: chaosResponse.status,
        cacheSignal: chaosResponse.headers.get('x-chaos') || 'CHAOS',
        durationMs: performance.now() - startTime
      });
      return chaosResponse;
    }

    // ==========================================
    // STAGE 2: Storage Lookup (Cache / VCR)
    // ==========================================
    const cached = await this.storage.lookup({
      method,
      path: storageKeyPath,
      headers: req.headers,
      bodyText: requestBodyText,
      request: req
    });

    if (cached) {
      if (cached.isOfflineMiss) {
        this.telemetry.record({
          method,
          path: targetPath,
          status: 502,
          cacheSignal: 'MISS',
          durationMs: performance.now() - startTime
        });

        return Response.json({
          error: cached.errorMessage,
          method,
          url: targetPath
        }, {
          status: 502,
          headers: { 'X-Cache': 'MISS' }
        });
      }

      const cachedBody = cached.isBase64
        ? (typeof Buffer !== 'undefined' ? Buffer.from(cached.body, 'base64') : cached.body)
        : cached.body;

      // 1. Fresh representation HIT
      if (this.storage.isFresh(cached)) {
        const resHeaders = new Headers(filterHeaders(cached.headers));
        resHeaders.set('X-Cache', cached.signal || 'HIT');

        this.telemetry.record({
          method,
          path: targetPath,
          status: cached.statusCode,
          cacheSignal: cached.signal || 'HIT',
          durationMs: performance.now() - startTime
        });

        return new Response(method === 'HEAD' ? null : cachedBody, {
          status: cached.statusCode,
          headers: resHeaders
        });
      }

      // 2. RFC 5861 stale-while-revalidate Window
      if (this.storage.isStaleWhileRevalidate?.(cached)) {
        const resHeaders = new Headers(filterHeaders(cached.headers));
        resHeaders.set('X-Cache', 'STALE');

        this.telemetry.record({
          method,
          path: targetPath,
          status: cached.statusCode,
          cacheSignal: 'STALE',
          durationMs: performance.now() - startTime
        });

        if (activeTransport) {
          const revalPromise = activeTransport.forward({
            method,
            path: targetPath,
            headers: req.headers,
            bodyText: requestBodyText
          }).then(upstream => {
            return this.storage.store({
              method,
              path: storageKeyPath,
              headers: req.headers,
              bodyText: requestBodyText,
              response: upstream,
              request: req
            });
          }).catch(() => {});

          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(revalPromise);
          }
        }

        return new Response(method === 'HEAD' ? null : cachedBody, {
          status: cached.statusCode,
          headers: resHeaders
        });
      }

      // 3. Conditional 304 Revalidation (ETag / If-Modified-Since)
      if (activeOrigin && activeTransport && (cached.etag || cached.lastModified)) {
        try {
          const condHeaders = new Headers();
          if (cached.etag) condHeaders.set('If-None-Match', cached.etag);
          if (cached.lastModified) condHeaders.set('If-Modified-Since', cached.lastModified);

          const upstream = await activeTransport.forward({
            method,
            path: targetPath,
            headers: condHeaders,
            bodyText: requestBodyText
          });

          if (upstream.statusCode === 304) {
            this.storage.touch({
              method,
              path: storageKeyPath,
              headers: req.headers,
              bodyText: requestBodyText
            });

            const revalHeaders = new Headers(filterHeaders(cached.headers));
            revalHeaders.set('X-Cache', 'REVALIDATED');

            this.telemetry.record({
              method,
              path: targetPath,
              status: cached.statusCode,
              cacheSignal: 'REVALIDATED',
              durationMs: performance.now() - startTime
            });

            return new Response(method === 'HEAD' ? null : cachedBody, {
              status: cached.statusCode,
              headers: revalHeaders
            });
          }
        } catch {
          // Fall through to full upstream forward
        }
      }
    }

    // ==========================================
    // STAGE 3: Upstream Forward & Store
    // ==========================================
    if (!activeTransport) {
      return Response.json({
        error: 'ORIGIN_NOT_CONFIGURED',
        message: 'No upstream origin configured to satisfy request. Use --origin, X-Boombox-Origin header, or transparent URL (/https://domain/path).'
      }, { status: 500 });
    }

    try {
      const upstream = await activeTransport.forward({
        method,
        path: targetPath,
        headers: req.headers,
        bodyText: requestBodyText
      });

      const storePromise = this.storage.store({
        method,
        path: storageKeyPath,
        headers: req.headers,
        bodyText: requestBodyText,
        response: upstream,
        request: req
      });

      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(Promise.resolve(storePromise));
      } else {
        await storePromise;
      }

      const clientHeaders = new Headers(upstream.headers);
      const signal = this.cassette ? 'RECORD' : (this.storage.isCacheable?.(method) ? 'MISS' : 'BYPASS');
      clientHeaders.set('X-Cache', signal);

      this.telemetry.record({
        method,
        path: targetPath,
        status: upstream.statusCode,
        cacheSignal: signal,
        durationMs: performance.now() - startTime
      });

      return new Response(method === 'HEAD' ? null : (upstream.buffer || upstream.serializedBody), {
        status: upstream.statusCode,
        headers: clientHeaders
      });
    } catch (err) {
      this.telemetry.record({
        method,
        path: targetPath,
        status: 502,
        cacheSignal: 'ERROR',
        durationMs: performance.now() - startTime
      });

      return new Response(err.message, {
        status: 502,
        headers: { 'Content-Type': 'text/plain', 'X-Cache': 'MISS' }
      });
    }
  }
}
