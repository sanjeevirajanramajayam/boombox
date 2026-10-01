
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function createStorageMatch({
  statusCode,
  headers,
  body,
  isBase64 = false,
  cachedAt = new Date().toISOString(),
  etag = null,
  lastModified = null,
  signal = 'HIT',
  isOfflineMiss = false,
  errorMessage = null,
  maxAge = null,
  staleWhileRevalidate = null
}) {
  return {
    statusCode,
    headers,
    body,
    isBase64: Boolean(isBase64),
    cachedAt,
    etag,
    lastModified,
    signal,
    isOfflineMiss: Boolean(isOfflineMiss),
    errorMessage,
    maxAge,
    staleWhileRevalidate
  };
}

export class DiskCacheAdapter {
  constructor(dirOrOptions = '.boombox-cache', maybeOptions = {}) {
    let cacheDir = '.boombox-cache';
    let maxSizeBytes = null;
    let matchBody = false;

    if (typeof dirOrOptions === 'object' && dirOrOptions !== null) {
      cacheDir = dirOrOptions.cacheDir || '.boombox-cache';
      maxSizeBytes = dirOrOptions.maxSizeBytes ?? null;
      matchBody = Boolean(dirOrOptions.matchBody);
    } else {
      cacheDir = dirOrOptions || '.boombox-cache';
      maxSizeBytes = maybeOptions.maxSizeBytes ?? null;
      matchBody = Boolean(maybeOptions.matchBody);
    }

    this.cacheDir = cacheDir;
    this.maxSizeBytes = maxSizeBytes ? parseInt(maxSizeBytes, 10) : null;
    this.matchBody = matchBody;

    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  isCacheable(method) {
    const m = method.toUpperCase();
    return m === 'GET' || m === 'HEAD' || (this.matchBody && m === 'POST');
  }

  lookup({ method, path, headers, bodyText = null }) {
    if (!this.isCacheable(method)) return null;

    const entry = this.get(method, path, bodyText, headers);
    if (!entry) return null;

    return createStorageMatch({
      statusCode: entry.statusCode,
      headers: entry.headers,
      body: entry.body,
      isBase64: entry.isBase64,
      cachedAt: entry.cachedAt,
      etag: entry.etag,
      lastModified: entry.lastModified,
      maxAge: entry.maxAge,
      staleWhileRevalidate: entry.staleWhileRevalidate,
      signal: 'HIT'
    });
  }

  store({ method, path, headers, bodyText = null, response }) {
    if (!this.isCacheable(method)) return;
    if (response.statusCode < 200 || response.statusCode >= 300) return;

    this.set(method, path, {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.serializedBody,
      isBase64: response.isBase64
    }, bodyText, headers);
  }

  normalizeUrl(rawUrl) {
    const parsed = new URL(rawUrl, 'http://localhost');
    parsed.searchParams.sort();
    return parsed.pathname + (parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : '');
  }

  normalizeBody(body) {
    if (!body) return '';
    if (typeof body === 'string') {
      try {
        const obj = JSON.parse(body);
        return JSON.stringify(obj, Object.keys(obj).sort());
      } catch {
        return body.trim();
      }
    }
    return String(body);
  }

  computeKey(method, rawUrl, requestBody = null) {
    const canonical = this.normalizeUrl(rawUrl);
    let serialized = `${method.toUpperCase()}:${canonical}`;
    if (requestBody) {
      const bodyHash = createHash('sha256').update(this.normalizeBody(requestBody)).digest('hex');
      serialized += `:${bodyHash}`;
    }
    return createHash('sha256').update(serialized).digest('hex');
  }

  parseMaxAge(cacheControlHeader) {
    if (!cacheControlHeader || typeof cacheControlHeader !== 'string') return null;
    const match = cacheControlHeader.match(/max-age\s*=\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  parseStaleWhileRevalidate(cacheControlHeader) {
    if (!cacheControlHeader || typeof cacheControlHeader !== 'string') return null;
    const match = cacheControlHeader.match(/stale-while-revalidate\s*=\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  isFresh(entry) {
    if (!entry || !entry.cachedAt) return false;
    if (entry.maxAge === null || entry.maxAge === undefined) return true;

    const ageSeconds = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;
    return ageSeconds < entry.maxAge;
  }

  isStaleWhileRevalidate(entry) {
    if (!entry || !entry.cachedAt || entry.maxAge === null || entry.maxAge === undefined) return false;
    if (!entry.staleWhileRevalidate) return false;

    const ageSeconds = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;
    return ageSeconds >= entry.maxAge && ageSeconds < (entry.maxAge + entry.staleWhileRevalidate);
  }

  get(method, rawUrl, requestBody = null, requestHeaders = null) {
    const key = this.computeKey(method, rawUrl, requestBody);
    const filePath = join(this.cacheDir, `${key}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      // If representation contains variants from Vary negotiation
      if (Array.isArray(data.variants) && Array.isArray(data.vary)) {
        if (!requestHeaders) return null;

        const matched = data.variants.find(v => {
          return data.vary.every(headerName => {
            const incoming = requestHeaders instanceof Headers
              ? requestHeaders.get(headerName)
              : (requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()] || null);
            return (v.varyMap?.[headerName] || null) === (incoming || null);
          });
        });

        return matched || null;
      }

      try {
        utimesSync(filePath, new Date(), new Date());
      } catch {}

      return data;
    } catch {
      return null;
    }
  }

  set(method, rawUrl, { statusCode, headers, body, isBase64 = false }, requestBody = null, requestHeaders = null) {
    const key = this.computeKey(method, rawUrl, requestBody);
    const filePath = join(this.cacheDir, `${key}.json`);

    const headersMap = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;
    const cacheControl = headersMap['cache-control'] || headersMap['Cache-Control'];
    const etag = headersMap['etag'] || headersMap['ETag'] || null;
    const lastModified = headersMap['last-modified'] || headersMap['Last-Modified'] || null;
    const varyHeader = headersMap['vary'] || headersMap['Vary'] || null;

    const singleData = {
      statusCode,
      headers: headersMap,
      body,
      isBase64: Boolean(isBase64),
      maxAge: this.parseMaxAge(cacheControl),
      staleWhileRevalidate: this.parseStaleWhileRevalidate(cacheControl),
      etag,
      lastModified,
      cachedAt: new Date().toISOString()
    };

    if (varyHeader && typeof varyHeader === 'string') {
      const varyNames = varyHeader.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const requestVaryMap = {};

      if (requestHeaders) {
        for (const name of varyNames) {
          const val = requestHeaders instanceof Headers
            ? requestHeaders.get(name)
            : (requestHeaders[name] || requestHeaders[name.toLowerCase()] || null);
          requestVaryMap[name] = val || null;
        }
      }

      let existing = null;
      if (existsSync(filePath)) {
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {}
      }

      const existingVariants = Array.isArray(existing?.variants) ? existing.variants : [];
      // Remove prior variant with identical varyMap
      const filteredVariants = existingVariants.filter(v => {
        return !varyNames.every(name => v.varyMap?.[name] === requestVaryMap[name]);
      });

      filteredVariants.push({
        ...singleData,
        varyMap: requestVaryMap
      });

      const parentEntry = {
        method: method.toUpperCase(),
        url: rawUrl,
        vary: varyNames,
        variants: filteredVariants
      };

      writeFileSync(filePath, JSON.stringify(parentEntry, null, 2), 'utf8');
    } else {
      const entry = {
        ...singleData,
        method: method.toUpperCase(),
        url: rawUrl
      };
      writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
    }

    this.evictIfNecessary();
  }

  touch(firstArg, rawUrl = null, requestBody = null, requestHeaders = null) {
    let method, path, body, headers;
    if (typeof firstArg === 'object' && firstArg !== null) {
      method = firstArg.method;
      path = firstArg.path;
      body = firstArg.bodyText ?? null;
      headers = firstArg.headers ?? null;
    } else {
      method = firstArg;
      path = rawUrl;
      body = requestBody;
      headers = requestHeaders;
    }

    const key = this.computeKey(method, path, body);
    const filePath = join(this.cacheDir, `${key}.json`);

    if (!existsSync(filePath)) return;

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      if (Array.isArray(data.variants) && Array.isArray(data.vary) && headers) {
        const variant = data.variants.find(v => {
          return data.vary.every(headerName => {
            const incoming = headers instanceof Headers
              ? headers.get(headerName)
              : (headers[headerName] || headers[headerName.toLowerCase()] || null);
            return (v.varyMap?.[headerName] || null) === (incoming || null);
          });
        });

        if (variant) {
          variant.cachedAt = new Date().toISOString();
          writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        }
      } else {
        data.cachedAt = new Date().toISOString();
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      }
    } catch {}
  }

  evictIfNecessary() {
    if (!this.maxSizeBytes || this.maxSizeBytes <= 0) return;
    if (!existsSync(this.cacheDir)) return;

    try {
      const files = readdirSync(this.cacheDir)
        .filter(f => f.endsWith('.json'))
        .map(name => {
          const fullPath = join(this.cacheDir, name);
          try {
            const st = statSync(fullPath);
            return {
              name,
              fullPath,
              size: st.size,
              mtimeMs: st.mtimeMs,
              atimeMs: st.atimeMs
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      let totalSize = files.reduce((acc, f) => acc + f.size, 0);
      if (totalSize <= this.maxSizeBytes) return;

      // Sort by last accessed / modified time ascending (oldest first)
      files.sort((a, b) => (a.mtimeMs || a.atimeMs) - (b.mtimeMs || b.atimeMs));

      const targetWatermark = Math.floor(this.maxSizeBytes * 0.8);
      for (const f of files) {
        if (totalSize <= targetWatermark) break;
        try {
          unlinkSync(f.fullPath);
          totalSize -= f.size;
        } catch {}
      }
    } catch {}
  }

  clear() {
    if (existsSync(this.cacheDir)) {
      rmSync(this.cacheDir, { recursive: true, force: true });
    }
    mkdirSync(this.cacheDir, { recursive: true });
  }

  count() {
    if (!existsSync(this.cacheDir)) return 0;
    return readdirSync(this.cacheDir).filter(f => f.endsWith('.json')).length;
  }
}

export const CacheManager = DiskCacheAdapter;

