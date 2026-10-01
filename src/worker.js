
import { ChaosEngine } from './chaos.js';
import { ProxyPipeline } from './pipeline.js';
import { createStorageMatch } from './cache.js';

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

export class EdgeCacheAdapter {
  constructor(cache) {
    this.cache = cache;
  }

  isCacheable(method) {
    const m = method.toUpperCase();
    return m === 'GET' || m === 'HEAD';
  }

  async lookup({ method, path, request }) {
    if (!this.isCacheable(method)) return null;
    const key = request || path;
    const matched = await this.cache.match(key);
    if (!matched) return null;

    const headers = {};
    for (const [k, v] of matched.headers.entries()) {
      headers[k] = v;
    }

    const body = await matched.text();
    return createStorageMatch({
      statusCode: matched.status,
      headers,
      body,
      signal: 'HIT'
    });
  }

  async store({ method, path, request, response }) {
    if (!this.isCacheable(method)) return;
    if (response.statusCode < 200 || response.statusCode >= 300) return;

    const key = request || path;
    const res = new Response(response.serializedBody || response.buffer, {
      status: response.statusCode,
      headers: response.headers
    });

    await this.cache.put(key, res);
  }

  isFresh() {
    return true;
  }

  touch() {}
}

const fallbackEdgeCache = new InMemoryEdgeCache();

export default {
  async fetch(request, env = {}, ctx = {}) {
    if (!env.ORIGIN) {
      return Response.json({
        error: 'ORIGIN_NOT_CONFIGURED',
        message: 'Boombox Worker requires the ORIGIN environment variable / secret to be configured.'
      }, { status: 500 });
    }

    const rawCache = env.CACHE || (typeof caches !== 'undefined' && caches.default ? caches.default : fallbackEdgeCache);
    const storage = new EdgeCacheAdapter(rawCache);

    const chaos = new ChaosEngine({
      latency: env.CHAOS_LATENCY,
      jitter: env.CHAOS_JITTER,
      flake: env.CHAOS_FLAKE_RATE,
      overrides: env.CHAOS_OVERRIDE
    });

    const pipeline = new ProxyPipeline({
      origin: env.ORIGIN,
      storage,
      chaos
    });

    return pipeline.dispatch(request, ctx);
  }
};

