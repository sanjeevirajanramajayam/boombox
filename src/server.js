
import { CacheManager } from './cache.js';
import { CassetteManager } from './vcr.js';
import { ChaosEngine } from './chaos.js';

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
  overrides = []
} = {}) {
  if (!origin && mode !== 'replay') {
    throw new Error('Proxy requires an upstream origin URL (e.g. --origin http://example.com)');
  }

  const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : null;
  const cache = cassette ? null : new CacheManager(cacheDir);
  const vcr = cassette ? new CassetteManager({ cassetteName: cassette, cassetteDir, mode }) : null;
  const chaos = new ChaosEngine({ latency, jitter, flake, overrides });

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const targetPath = url.pathname + url.search;
      const method = req.method.toUpperCase();

      // ==========================================
      // PIPELINE STAGE 1: Chaos Simulation Middleware
      // ==========================================
      const chaosResponse = await chaos.evaluate(url.pathname);
      if (chaosResponse) {
        return chaosResponse;
      }

      // ==========================================
      // PIPELINE STAGE 2: VCR Service Virtualization
      // ==========================================
      if (vcr) {
        if (mode === 'replay' || mode === 'auto') {
          const matched = vcr.match(method, targetPath);
          if (matched) {
            const resHeaders = new Headers(filterHeaders(matched.headers));
            resHeaders.set('X-Cache', 'REPLAY');
            return new Response(method === 'HEAD' ? null : matched.body, {
              status: matched.statusCode,
              headers: resHeaders
            });
          }

          if (mode === 'replay') {
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
            redirect: 'manual'
          };

          if (method !== 'GET' && method !== 'HEAD' && req.body) {
            fetchOptions.body = await req.arrayBuffer();
          }

          const originResponse = await fetch(`${normalizedOrigin}${targetPath}`, fetchOptions);
          const originStatus = originResponse.status;
          const originBody = await originResponse.text();

          const outHeaders = {};
          for (const [k, v] of originResponse.headers.entries()) {
            if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'content-encoding') {
              outHeaders[k] = v;
            }
          }

          vcr.record(method, targetPath, {
            statusCode: originStatus,
            headers: outHeaders,
            body: originBody
          });

          const clientHeaders = new Headers(outHeaders);
          clientHeaders.set('X-Cache', 'RECORD');

          return new Response(method === 'HEAD' ? null : originBody, {
            status: originStatus,
            headers: clientHeaders
          });
        } catch (err) {
          return new Response(`502 Bad Gateway: VCR failed connecting to origin ${normalizedOrigin} - ${err.message}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain', 'X-Cache': 'MISS' }
          });
        }
      }

      // ==========================================
      // PIPELINE STAGE 3: Core RFC 9111 Caching Proxy
      // ==========================================
      const isCacheable = method === 'GET' || method === 'HEAD';

      if (isCacheable) {
        const cached = cache.get(method, targetPath);
        if (cached) {
          const responseHeaders = new Headers(filterHeaders(cached.headers));
          responseHeaders.set('X-Cache', 'HIT');

          return new Response(method === 'HEAD' ? null : cached.body, {
            status: cached.statusCode,
            headers: responseHeaders
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
        forwardHeaders.set('host', new URL(normalizedOrigin).host);

        const fetchOptions = {
          method,
          headers: forwardHeaders,
          redirect: 'manual'
        };

        if (method !== 'GET' && method !== 'HEAD' && req.body) {
          fetchOptions.body = await req.arrayBuffer();
        }

        const originResponse = await fetch(`${normalizedOrigin}${targetPath}`, fetchOptions);
        const originStatus = originResponse.status;
        const originBody = await originResponse.text();

        const outHeaders = {};
        for (const [k, v] of originResponse.headers.entries()) {
          if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'content-encoding') {
            outHeaders[k] = v;
          }
        }

        if (isCacheable && originStatus >= 200 && originStatus < 300) {
          cache.set(method, targetPath, {
            statusCode: originStatus,
            headers: outHeaders,
            body: originBody
          });
        }

        const clientHeaders = new Headers(outHeaders);
        clientHeaders.set('X-Cache', isCacheable ? 'MISS' : 'BYPASS');

        return new Response(method === 'HEAD' ? null : originBody, {
          status: originStatus,
          headers: clientHeaders
        });
      } catch (err) {
        return new Response(`502 Bad Gateway: Unable to connect to origin ${normalizedOrigin} - ${err.message}`, {
          status: 502,
          headers: { 'Content-Type': 'text/plain', 'X-Cache': 'MISS' }
        });
      }
    }
  });

  return { server, cache, vcr, chaos };
}
