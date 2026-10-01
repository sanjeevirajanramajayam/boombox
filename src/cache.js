
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
  }

  touch(method, rawUrl, requestBody = null, requestHeaders = null) {
    const key = this.computeKey(method, rawUrl, requestBody);
    const filePath = join(this.cacheDir, `${key}.json`);

    if (!existsSync(filePath)) return;

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      if (Array.isArray(data.variants) && Array.isArray(data.vary) && requestHeaders) {
        const variant = data.variants.find(v => {
          return data.vary.every(headerName => {
            const incoming = requestHeaders instanceof Headers
              ? requestHeaders.get(headerName)
              : (requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()] || null);
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
