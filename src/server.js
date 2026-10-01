
import { CacheManager } from './cache.js';
import { CassetteManager } from './vcr.js';
import { ChaosEngine } from './chaos.js';
import { ProxyTelemetry } from './dashboard.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export function filterHeaders(headers) {
  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function isBinaryContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.startsWith('image/') ||
         ct.startsWith('audio/') ||
         ct.startsWith('video/') ||
         ct.includes('octet-stream') ||
         ct.includes('pdf') ||
         ct.includes('zip') ||
         ct.includes('gzip');
}

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
          const forwardHeaders = new Headers();
          for (const [key, value] of req.headers.entries()) {
            if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'host') {
              forwardHeaders.set(key, value);
            }
          }
          if (normalizedOrigin) {
            forwardHeaders.set('host', new URL(normalizedOrigin).host);
          }

          const fetchOptions = {
            method,
            headers: forwardHeaders,
            redirect: 'follow'
          };

          if (requestBodyText) {
            fetchOptions.body = requestBodyText;
          }

          const originResponse = await fetch(`${normalizedOrigin}${targetPath}`, fetchOptions);
          const originStatus = originResponse.status;

          const outHeaders = {};
          for (const [k, v] of originResponse.headers.entries()) {
            if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'content-encoding') {
              outHeaders[k] = v;
            }
          }

          const originArrayBuffer = await originResponse.arrayBuffer();
          const originBuffer = Buffer.from(originArrayBuffer);
          const isBinary = isBinaryContentType(outHeaders['content-type'] || outHeaders['Content-Type']);
          const serializedBody = isBinary ? originBuffer.toString('base64') : originBuffer.toString('utf8');

          vcr.record(method, targetPath, {
            statusCode: originStatus,
            headers: outHeaders,
            body: serializedBody,
            isBase64: isBinary
          }, requestBodyText);

          const clientHeaders = new Headers(outHeaders);
          clientHeaders.set('X-Cache', 'RECORD');

          telemetry.record({
            method,
            path: targetPath,
            status: originStatus,
            cacheSignal: 'RECORD',
            durationMs: performance.now() - startTime
          });

          return new Response(method === 'HEAD' ? null : originBuffer, {
            status: originStatus,
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

          return new Response(`502 Bad Gateway: VCR failed connecting to origin ${normalizedOrigin} - ${err.message}`, {
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
        const forwardHeaders = new Headers();
        for (const [key, value] of req.headers.entries()) {
          if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'host') {
            forwardHeaders.set(key, value);
          }
        }
        forwardHeaders.set('host', new URL(normalizedOrigin).host);

        const fetchOptions = {
          method,
          headers: forwardHeaders,
          redirect: 'follow'
        };

        if (requestBodyText) {
          fetchOptions.body = requestBodyText;
        }

        const originResponse = await fetch(`${normalizedOrigin}${targetPath}`, fetchOptions);
        const originStatus = originResponse.status;

        const outHeaders = {};
        for (const [k, v] of originResponse.headers.entries()) {
          if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'content-encoding') {
            outHeaders[k] = v;
          }
        }

        const originArrayBuffer = await originResponse.arrayBuffer();
        const originBuffer = Buffer.from(originArrayBuffer);
        const isBinary = isBinaryContentType(outHeaders['content-type'] || outHeaders['Content-Type']);
        const serializedBody = isBinary ? originBuffer.toString('base64') : originBuffer.toString('utf8');

        if (isCacheable && originStatus >= 200 && originStatus < 300) {
          cache.set(method, targetPath, {
            statusCode: originStatus,
            headers: outHeaders,
            body: serializedBody,
            isBase64: isBinary
          }, requestBodyText, req.headers);
        }

        const clientHeaders = new Headers(outHeaders);
        const signal = isCacheable ? 'MISS' : 'BYPASS';
        clientHeaders.set('X-Cache', signal);

        telemetry.record({
          method,
          path: targetPath,
          status: originStatus,
          cacheSignal: signal,
          durationMs: performance.now() - startTime
        });

        return new Response(method === 'HEAD' ? null : originBuffer, {
          status: originStatus,
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

        return new Response(`502 Bad Gateway: Unable to connect to origin ${normalizedOrigin} - ${err.message}`, {
          status: 502,
          headers: { 'Content-Type': 'text/plain', 'X-Cache': 'MISS' }
        });
      }
    }
  });

  return { server, cache, vcr, chaos, telemetry };
}
