
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class CacheManager {
  constructor(cacheDir = '.boombox-cache') {
    this.cacheDir = cacheDir;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
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

  isFresh(entry) {
    if (!entry || !entry.cachedAt) return false;
    if (entry.maxAge === null || entry.maxAge === undefined) return true;

    const ageSeconds = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;
    return ageSeconds < entry.maxAge;
  }

  get(method, rawUrl, requestBody = null) {
    const key = this.computeKey(method, rawUrl, requestBody);
    const filePath = join(this.cacheDir, `${key}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  set(method, rawUrl, { statusCode, headers, body, isBase64 = false }, requestBody = null) {
    const key = this.computeKey(method, rawUrl, requestBody);
    const filePath = join(this.cacheDir, `${key}.json`);

    const headersMap = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;
    const cacheControl = headersMap['cache-control'] || headersMap['Cache-Control'];
    const etag = headersMap['etag'] || headersMap['ETag'] || null;
    const lastModified = headersMap['last-modified'] || headersMap['Last-Modified'] || null;

    const entry = {
      method: method.toUpperCase(),
      url: rawUrl,
      statusCode,
      headers: headersMap,
      body,
      isBase64: Boolean(isBase64),
      maxAge: this.parseMaxAge(cacheControl),
      etag,
      lastModified,
      cachedAt: new Date().toISOString()
    };

    writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
  }


  touch(method, rawUrl, requestBody = null) {
    const key = this.computeKey(method, rawUrl, requestBody);
    const filePath = join(this.cacheDir, `${key}.json`);
    const entry = this.get(method, rawUrl, requestBody);
    if (entry) {
      entry.cachedAt = new Date().toISOString();
      writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
    }
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
