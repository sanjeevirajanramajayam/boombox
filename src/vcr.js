
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class CassetteManager {
  constructor({ cassetteName, cassetteDir = 'cassettes', mode = 'auto' }) {
    this.cassetteName = cassetteName;
    this.cassetteDir = cassetteDir;
    this.mode = mode.toLowerCase(); // 'record', 'replay', 'auto'
    this.filePath = join(this.cassetteDir, `${this.cassetteName}.json`);
    this.interactions = new Map();

    if (!['record', 'replay', 'auto'].includes(this.mode)) {
      throw new Error(`Invalid VCR mode: "${this.mode}". Must be "record", "replay", or "auto".`);
    }

    if (!existsSync(this.cassetteDir)) {
      mkdirSync(this.cassetteDir, { recursive: true });
    }

    this.load();
  }

  normalizeUrl(rawUrl) {
    const parsed = new URL(rawUrl, 'http://localhost');
    parsed.searchParams.sort();
    return parsed.pathname + (parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : '');
  }

  key(method, rawUrl) {
    return `${method.toUpperCase()}:${this.normalizeUrl(rawUrl)}`;
  }

  load() {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const item of data) {
          const k = this.key(item.method, item.url);
          this.interactions.set(k, item);
        }
      } catch {
        this.interactions.clear();
      }
    }
  }

  match(method, rawUrl) {
    return this.interactions.get(this.key(method, rawUrl));
  }

  record(method, rawUrl, { statusCode, headers, body }) {
    const canonicalUrl = this.normalizeUrl(rawUrl);
    const item = {
      method: method.toUpperCase(),
      url: canonicalUrl,
      statusCode,
      headers,
      body,
      recordedAt: new Date().toISOString()
    };

    this.interactions.set(this.key(method, rawUrl), item);
    this.flush();
  }

  flush() {
    const list = Array.from(this.interactions.values());
    writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
  }

  count() {
    return this.interactions.size;
  }
}
