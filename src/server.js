
import { CacheManager } from './cache.js';
import { CassetteManager } from './vcr.js';
import { ChaosEngine } from './chaos.js';
import { ProxyTelemetry } from './dashboard.js';
import { OriginTransport, filterHeaders, isBinaryContentType, HOP_BY_HOP_HEADERS } from './transport.js';

export { filterHeaders, isBinaryContentType, HOP_BY_HOP_HEADERS, OriginTransport };

export function createProxyServer({
  port = 3000,
  origin,
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
  if (!origin && mode !== 'replay') {
    throw new Error('Proxy requires an upstream origin URL (e.g. --origin http://example.com)');
  }

  const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : null;
  const transport = normalizedOrigin ? new OriginTransport({ origin: normalizedOrigin, redirect: 'follow' }) : null;
  const cache = cassette ? null : new CacheManager(cacheDir);
  const vcr = cassette ? new CassetteManager({ cassetteName: cassette, cassetteDir, mode, redact, matchBody }) : null;
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
      // PIPELINE STAGE 2: VCR Service Virtualization
      // ==========================================
      if (vcr) {
        if (mode === 'replay' || mode === 'auto') {
          const matched = vcr.match(method, targetPath, requestBodyText);
          if (matched) {
            const resHeaders = new Headers(filterHeaders(matched.headers));
            resHeaders.set('X-Cache', 'REPLAY');

            const responsePayload = matched.isBase64
              ? Buffer.from(matched.body, 'base64')
              : matched.body;

            telemetry.record({
              method,
              path: targetPath,
              status: matched.statusCode,
              cacheSignal: 'REPLAY',
              durationMs: performance.now() - startTime
            });

            return new Response(method === 'HEAD' ? null : responsePayload, {
              status: matched.statusCode,
              headers: resHeaders
            });
          }

          if (mode === 'replay') {
            telemetry.record({
              method,
              path: targetPath,
              status: 502,
              cacheSignal: 'MISS',
              durationMs: performance.now() - startTime
            });

            return Response.json({
              error: 'Cassette interaction not found in replay mode',
              cassette,
              method,
              url: targetPath
            }, {
              status: 502,
              headers: { 'X-Cache': 'MISS' }
            });
          }
        }

        try {
          const upstream = await transport.forward({
            method,
            path: targetPath,
            headers: req.headers,
            bodyText: requestBodyText
          });

          vcr.record(method, targetPath, {
            statusCode: upstream.statusCode,
            headers: upstream.headers,
            body: upstream.serializedBody,
            isBase64: upstream.isBase64
          }, requestBodyText);

          const clientHeaders = new Headers(upstream.headers);
          clientHeaders.set('X-Cache', 'RECORD');

          telemetry.record({
            method,
            path: targetPath,
            status: upstream.statusCode,
            cacheSignal: 'RECORD',
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

      // ==========================================
      // PIPELINE STAGE 3: Core RFC 9111 Caching Proxy
      // ==========================================
      const isCacheable = method === 'GET' || method === 'HEAD' || (matchBody && method === 'POST');

      if (isCacheable) {
        const cached = cache.get(method, targetPath, requestBodyText, req.headers);
        if (cached) {
          const cachedBody = cached.isBase64 ? Buffer.from(cached.body, 'base64') : cached.body;

          if (cache.isFresh(cached)) {
            const responseHeaders = new Headers(filterHeaders(cached.headers));
            responseHeaders.set('X-Cache', 'HIT');

            telemetry.record({
              method,
              path: targetPath,
              status: cached.statusCode,
              cacheSignal: 'HIT',
              durationMs: performance.now() - startTime
            });

            return new Response(method === 'HEAD' ? null : cachedBody, {
              status: cached.statusCode,
              headers: responseHeaders
            });
          }

          if (cached.etag || cached.lastModified) {
            try {
              const condHeaders = new Headers();
              if (cached.etag) condHeaders.set('If-None-Match', cached.etag);
              if (cached.lastModified) condHeaders.set('If-Modified-Since', cached.lastModified);
              if (normalizedOrigin) condHeaders.set('host', new URL(normalizedOrigin).host);

              const revalRes = await fetch(`${normalizedOrigin}${targetPath}`, {
                method,
                headers: condHeaders
              });

              if (revalRes.status === 304) {
                cache.touch(method, targetPath, requestBodyText, req.headers);
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
              // Revalidation connection error; fall through
            }
          }
        }
      }

      try {
        const upstream = await transport.forward({
          method,
          path: targetPath,
          headers: req.headers,
          bodyText: requestBodyText
        });

        if (isCacheable && upstream.statusCode >= 200 && upstream.statusCode < 300) {
          cache.set(method, targetPath, {
            statusCode: upstream.statusCode,
            headers: upstream.headers,
            body: upstream.serializedBody,
            isBase64: upstream.isBase64
          }, requestBodyText, req.headers);
        }

        const clientHeaders = new Headers(upstream.headers);
        const signal = isCacheable ? 'MISS' : 'BYPASS';
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

  return { server, cache, vcr, chaos, telemetry, transport };
}
