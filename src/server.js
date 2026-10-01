// [WHY]: RFC 9111 specifies caching proxy requirements for intermediaries forwarding HTTP traffic.
//        Intermediaries must preserve payload fidelity, strip connection-specific hop-by-hop headers (RFC 9110 §7.6.1),
//        and signal cache telemetry via X-Cache headers (HIT, MISS, REPLAY, RECORD, BYPASS).
// [HOW]: Uses Bun.serve to create a high-throughput HTTP proxy loop.
//        Supports two storage engines:
//        1. Core Cache Engine (CacheManager): Global key-value cache with RFC 9111 method filtering.
//        2. VCR Engine (CassetteManager): Named tape recording and 100% offline replay.
// [INVARIANTS/WHEN]: In VCR 'replay' mode, outbound network calls are strictly prohibited; unrecorded routes fail fast with 502.

import { CacheManager } from './cache.js';
import { CassetteManager } from './vcr.js';

// [WHY]: RFC 9110 Section 7.6.1 mandates hop-by-hop headers apply only to a single transport link
//        and must not be forwarded by proxies to prevent socket desynchronization.
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
  mode = 'auto'
} = {}) {
  // [WHY]: Replay mode must function 100% offline without requiring an active origin URL.
  // [HOW]: Allows missing origin only when explicitly running in replay mode.
  // [INVARIANTS/WHEN]: In record or auto mode, origin is strictly required.
  if (!origin && mode !== 'replay') {
    throw new Error('Proxy requires an upstream origin URL (e.g. --origin http://example.com)');
  }

  const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : null;
  const cache = cassette ? null : new CacheManager(cacheDir);
  const vcr = cassette ? new CassetteManager({ cassetteName: cassette, cassetteDir, mode }) : null;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const targetPath = url.pathname + url.search;
      const method = req.method.toUpperCase();

      // ==========================================
      // PIPELINE BRANCH 1: VCR Service Virtualization
      // ==========================================
      if (vcr) {
        // [WHY]: Replay and auto modes check local tape before touching external networks.
        // [HOW]: Performs deterministic lookup against the active cassette JSON.
        // [INVARIANTS/WHEN]: Returns recorded status and payload; attaches X-Cache: REPLAY.
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

          // [WHY]: In replay mode, missing entries must fail fast with informative telemetry rather than hanging.
          // [HOW]: Returns RFC-compliant 502 Bad Gateway with diagnostic JSON payload.
          // [INVARIANTS/WHEN]: Zero outbound network requests are initiated in replay mode.
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

        // [WHY]: In 'record' or 'auto' (on miss), forward to live origin and record tape track.
        // [HOW]: Executes origin fetch, stores interaction into cassette, returns response with X-Cache: RECORD.
        // [INVARIANTS/WHEN]: Requires valid origin URL.
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

          // Record track to cassette
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
      // PIPELINE BRANCH 2: Core RFC 9111 Caching Proxy
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

  return { server, cache, vcr };
}
