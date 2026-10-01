
import { ChaosEngine } from './chaos.js';
import { ProxyTelemetry } from './dashboard.js';
import { OriginTransport, filterHeaders, isBinaryContentType, HOP_BY_HOP_HEADERS } from './transport.js';
import { FileCacheAdapter, CassetteTapeAdapter, InMemoryStorageAdapter } from './storage.js';

export { filterHeaders, isBinaryContentType, HOP_BY_HOP_HEADERS, OriginTransport, FileCacheAdapter, CassetteTapeAdapter, InMemoryStorageAdapter };

export function createProxyServer({
  port = 3000,
  origin,
  storage = null,
  cacheDir = '.boombox-cache',
  cassette = null,
  cassetteDir = 'cassettes',
  mode = 'auto',
  latency = 0,
  jitter = null,
  flake = 0,
  overrides = [],
  redact = [],
  matchBody = false
} = {}) {
  if (!origin && mode !== 'replay' && !cassette) {
    throw new Error('Proxy requires an upstream origin URL (e.g. --origin http://example.com)');
  }

  const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : null;
  const transport = normalizedOrigin ? new OriginTransport({ origin: normalizedOrigin, redirect: 'follow' }) : null;

  const activeStorage = storage || (cassette
    ? new CassetteTapeAdapter({ cassetteName: cassette, cassetteDir, mode, redact, matchBody })
    : new FileCacheAdapter({ cacheDir, matchBody }));

  const chaos = new ChaosEngine({ latency, jitter, flake, overrides });
  const telemetry = new ProxyTelemetry({ origin: normalizedOrigin || '', mode: cassette ? mode : 'cache' });

  const server = Bun.serve({
    port,
    async fetch(req) {
      const startTime = performance.now();
      const url = new URL(req.url);
      const targetPath = url.pathname + url.search;
      const method = req.method.toUpperCase();

      let requestBodyText = null;
      if (req.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        requestBodyText = await req.text();
      }

      // ==========================================
      // PIPELINE STAGE 1: Chaos Simulation Middleware
      // ==========================================
      const chaosResponse = await chaos.evaluate(url.pathname);
      if (chaosResponse) {
        telemetry.record({
          method,
          path: targetPath,
          status: chaosResponse.status,
          cacheSignal: chaosResponse.headers.get('x-chaos') || 'CHAOS',
          durationMs: performance.now() - startTime
        });
        return chaosResponse;
      }

      // ==========================================
      // PIPELINE STAGE 2: Storage Lookup (Cache / VCR)
      // ==========================================
      const cached = activeStorage.lookup({
        method,
        path: targetPath,
        headers: req.headers,
        bodyText: requestBodyText
      });

      if (cached) {
        if (cached.isOfflineMiss) {
          telemetry.record({
            method,
            path: targetPath,
            status: 502,
            cacheSignal: 'MISS',
            durationMs: performance.now() - startTime
          });

          return Response.json({
            error: cached.errorMessage,
            cassette,
            method,
            url: targetPath
          }, {
            status: 502,
            headers: { 'X-Cache': 'MISS' }
          });
        }

        const cachedBody = cached.isBase64 ? Buffer.from(cached.body, 'base64') : cached.body;

        if (activeStorage.isFresh(cached)) {
          const resHeaders = new Headers(filterHeaders(cached.headers));
          resHeaders.set('X-Cache', cached.signal);

          telemetry.record({
            method,
            path: targetPath,
            status: cached.statusCode,
            cacheSignal: cached.signal,
            durationMs: performance.now() - startTime
          });

          return new Response(method === 'HEAD' ? null : cachedBody, {
            status: cached.statusCode,
            headers: resHeaders
          });
        }

        // Stale revalidation (RFC 9111 ETag / If-Modified-Since)
        if (normalizedOrigin && (cached.etag || cached.lastModified)) {
          try {
            const condHeaders = new Headers();
            if (cached.etag) condHeaders.set('If-None-Match', cached.etag);
            if (cached.lastModified) condHeaders.set('If-Modified-Since', cached.lastModified);

            const upstream = await transport.forward({
              method,
              path: targetPath,
              headers: condHeaders,
              bodyText: requestBodyText
            });

            if (upstream.statusCode === 304) {
              activeStorage.touch({
                method,
                path: targetPath,
                headers: req.headers,
                bodyText: requestBodyText
              });

              const revalHeaders = new Headers(filterHeaders(cached.headers));
              revalHeaders.set('X-Cache', 'REVALIDATED');

              telemetry.record({
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
            // Revalidation error; fall through to full fetch
          }
        }
      }

      // ==========================================
      // PIPELINE STAGE 3: Upstream Forward & Store
      // ==========================================
      try {
        const upstream = await transport.forward({
          method,
          path: targetPath,
          headers: req.headers,
          bodyText: requestBodyText
        });

        activeStorage.store({
          method,
          path: targetPath,
          headers: req.headers,
          bodyText: requestBodyText,
          response: upstream
        });

        const clientHeaders = new Headers(upstream.headers);
        const signal = cassette ? 'RECORD' : (activeStorage.isCacheable?.(method) ? 'MISS' : 'BYPASS');
        clientHeaders.set('X-Cache', signal);

        telemetry.record({
          method,
          path: targetPath,
          status: upstream.statusCode,
          cacheSignal: signal,
          durationMs: performance.now() - startTime
        });

        return new Response(method === 'HEAD' ? null : upstream.buffer, {
          status: upstream.statusCode,
          headers: clientHeaders
        });
      } catch (err) {
        telemetry.record({
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
  });

  return {
    server,
    storage: activeStorage,
    cache: activeStorage.cacheManager || activeStorage,
    vcr: activeStorage.cassetteManager || activeStorage,
    chaos,
    telemetry,
    transport
  };
}
