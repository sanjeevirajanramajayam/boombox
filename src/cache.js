
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

  computeKey(method, rawUrl) {
    const canonical = this.normalizeUrl(rawUrl);
    const serialized = `${method.toUpperCase()}:${canonical}`;
    return createHash('sha256').update(serialized).digest('hex');
  }

  get(method, rawUrl) {
    const key = this.computeKey(method, rawUrl);
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

  set(method, rawUrl, { statusCode, headers, body }) {
    const key = this.computeKey(method, rawUrl);
    const filePath = join(this.cacheDir, `${key}.json`);

    const entry = {
      method: method.toUpperCase(),
      url: rawUrl,
      statusCode,
      headers,
      body,
      cachedAt: new Date().toISOString()
    };

    writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
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
