
import { ChaosEngine } from './chaos.js';
import { HOP_BY_HOP_HEADERS, filterHeaders } from './transport.js';

export class InMemoryEdgeCache {
  constructor() {
    this.store = new Map();
  }

  async match(request) {
    const key = typeof request === 'string' ? request : request.url;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return entry.clone();
  }

  async put(request, response) {
    const key = typeof request === 'string' ? request : request.url;
    this.store.set(key, response.clone());
  }

  async delete(request) {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.delete(key);
  }
}

const fallbackEdgeCache = new InMemoryEdgeCache();

export default {
  async fetch(request, env = {}, ctx = {}) {
    // 1. Validate upstream origin configuration
    if (!env.ORIGIN) {
      return Response.json({
        error: 'ORIGIN_NOT_CONFIGURED',
        message: 'Boombox Worker requires the ORIGIN environment variable / secret to be configured.'
      }, { status: 500 });
    }

    const requestUrl = new URL(request.url);

    // 2. Evaluate Edge Chaos Fault Injection
    const chaos = new ChaosEngine({
      latency: env.CHAOS_LATENCY,
      jitter: env.CHAOS_JITTER,
      flake: env.CHAOS_FLAKE_RATE,
      overrides: env.CHAOS_OVERRIDE
    });

    const chaosResponse = await chaos.evaluate(requestUrl.pathname);
    if (chaosResponse) {
      return chaosResponse;
    }

    // 3. Resolve Edge Cache instance
    const edgeCache = env.CACHE || (typeof caches !== 'undefined' && caches.default ? caches.default : fallbackEdgeCache);
    const method = request.method.toUpperCase();
    const isCacheable = method === 'GET' || method === 'HEAD';

    // 4. Edge Cache Lookup
    if (isCacheable) {
      const cached = await edgeCache.match(request);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        hitHeaders.set('X-Cache', 'HIT');
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: hitHeaders
        });
      }
    }

    // 5. Origin Forwarding
    const originBase = env.ORIGIN.replace(/\/+$/, '');
    const targetUrl = `${originBase}${requestUrl.pathname}${requestUrl.search}`;

    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'host') {
        forwardHeaders.set(key, value);
      }
    }
    forwardHeaders.set('host', new URL(originBase).host);

    const init = {
      method,
      headers: forwardHeaders,
      redirect: 'follow'
    };

    if (method !== 'GET' && method !== 'HEAD') {
      init.body = request.body;
    }

    let originResponse;
    try {
      originResponse = await fetch(targetUrl, init);
    } catch (err) {
      return Response.json({
        error: 'BAD_GATEWAY',
        message: `Failed to connect to upstream origin: ${err.message}`
      }, { status: 502 });
    }

    // 6. Build Client Response & Cache Storage
    const responseHeaders = new Headers();
    for (const [k, v] of originResponse.headers.entries()) {
      const lower = k.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'content-encoding') {
        responseHeaders.set(k, v);
      }
    }
    responseHeaders.set('X-Cache', 'MISS');

    const clientResponse = new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders
    });

    if (isCacheable && originResponse.status >= 200 && originResponse.status < 300) {
      const cacheResponse = clientResponse.clone();
      const putPromise = edgeCache.put(request, cacheResponse);
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(putPromise);
      } else {
        await putPromise;
      }
    }

    return clientResponse;
  }
};
