
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'proxy-authorization'
];

export class CassetteManager {
  constructor({ cassetteName, cassetteDir = 'cassettes', mode = 'auto', redact = [], matchBody = false } = {}) {
    this.cassetteName = cassetteName;
    this.cassetteDir = cassetteDir;
    this.mode = mode.toLowerCase(); // 'record', 'replay', 'auto'
    this.matchBody = Boolean(matchBody);
    this.filePath = join(this.cassetteDir, `${this.cassetteName}.json`);
    this.interactions = new Map();

    const customRedact = Array.isArray(redact) ? redact : [redact].filter(Boolean);
    this.redactHeadersSet = new Set([
      ...DEFAULT_REDACT_HEADERS,
      ...customRedact.map(h => h.toLowerCase().trim())
    ]);

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

  key(method, rawUrl, requestBody = null) {
    let k = `${method.toUpperCase()}:${this.normalizeUrl(rawUrl)}`;
    if (this.matchBody && requestBody) {
      const bodyHash = createHash('sha256').update(this.normalizeBody(requestBody)).digest('hex');
      k += `:${bodyHash}`;
    }
    return k;
  }

  load() {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const item of data) {
          const k = this.key(item.method, item.url, item.requestBody);
          this.interactions.set(k, item);
        }
      } catch {
        this.interactions.clear();
      }
    }
  }

  match(method, rawUrl, requestBody = null) {
    return this.interactions.get(this.key(method, rawUrl, requestBody));
  }

  sanitizeHeaders(headers) {
    const sanitized = {};
    for (const [k, v] of Object.entries(headers)) {
      if (this.redactHeadersSet.has(k.toLowerCase())) {
        sanitized[k] = '[REDACTED]';
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  record(method, rawUrl, { statusCode, headers, body, isBase64 = false }, requestBody = null) {
    const canonicalUrl = this.normalizeUrl(rawUrl);
    const item = {
      method: method.toUpperCase(),
      url: canonicalUrl,
      requestBody: this.matchBody && requestBody ? this.normalizeBody(requestBody) : undefined,
      statusCode,
      headers: this.sanitizeHeaders(headers),
      body,
      isBase64: Boolean(isBase64),
      recordedAt: new Date().toISOString()
    };

    this.interactions.set(this.key(method, rawUrl, requestBody), item);
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
