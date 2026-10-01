
import { ChaosEngine } from './chaos.js';
import { ProxyTelemetry } from './dashboard.js';
import { OriginTransport, filterHeaders, isBinaryContentType, HOP_BY_HOP_HEADERS } from './transport.js';
import { FileCacheAdapter, CassetteTapeAdapter, InMemoryStorageAdapter, DiskCacheAdapter } from './storage.js';
import { ProxyPipeline } from './pipeline.js';

export { filterHeaders, isBinaryContentType, HOP_BY_HOP_HEADERS, OriginTransport, FileCacheAdapter, CassetteTapeAdapter, InMemoryStorageAdapter, DiskCacheAdapter, ProxyPipeline };

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
  matchBody = false,
  maxSizeBytes = null
} = {}) {
  if (!origin && mode !== 'replay' && !cassette) {
    throw new Error('Proxy requires an upstream origin URL (e.g. --origin http://example.com)');
  }

  const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : null;
  const transport = normalizedOrigin ? new OriginTransport({ origin: normalizedOrigin, redirect: 'follow' }) : null;

  const activeStorage = storage || (cassette
    ? new CassetteTapeAdapter({ cassetteName: cassette, cassetteDir, mode, redact, matchBody })
    : new DiskCacheAdapter({ cacheDir, matchBody, maxSizeBytes }));

  const chaos = new ChaosEngine({ latency, jitter, flake, overrides });
  const telemetry = new ProxyTelemetry({ origin: normalizedOrigin || '', mode: cassette ? mode : 'cache', port });

  const pipeline = new ProxyPipeline({
    origin: normalizedOrigin,
    storage: activeStorage,
    transport,
    chaos,
    telemetry,
    cassette: Boolean(cassette)
  });

  const server = Bun.serve({
    port,
    fetch(req) {
      return pipeline.dispatch(req);
    }
  });

  return {
    server,
    pipeline,
    storage: activeStorage,
    cache: activeStorage.cacheManager || activeStorage,
    vcr: activeStorage.cassetteManager || activeStorage,
    chaos,
    telemetry,
    transport
  };
}
