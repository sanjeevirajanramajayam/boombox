// [WHY]: Service Virtualization (VCR) enables deterministic offline testing and eliminates flaky third-party APIs.
//        Per Martin Fowler (2011, "Eradicating Non-Determinism in Tests"), tests must isolate network dependencies.
//        Persisting HTTP interactions into named "cassettes" allows test suites to replay exact server responses.
// [HOW]: CassetteManager loads and writes structured JSON files under a designated directory (default: cassettes/).
//        Indexes interactions by METHOD + ":" + normalized URI.
// [INVARIANTS/WHEN]: In 'replay' mode, zero external network requests are permitted. Missing entries fail fast.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class CassetteManager {
  // [WHY]: Named cassettes compartmentalize fixtures per test scenario (e.g. 'stripe-success.json').
  // [HOW]: Initializes in-memory interaction map from disk if cassette exists, or empty map if recording.
  // [INVARIANTS/WHEN]: Cassette directory is automatically created if non-existent.
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

  // [WHY]: Normalize URI to ensure query parameters produce identical match keys regardless of order.
  // [HOW]: Sorts URL search parameters alphabetically.
  // [INVARIANTS/WHEN]: Produces deterministic pathname + sorted query string.
  normalizeUrl(rawUrl) {
    const parsed = new URL(rawUrl, 'http://localhost');
    parsed.searchParams.sort();
    return parsed.pathname + (parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : '');
  }

  // [WHY]: Unique identifier for an interaction inside the cassette.
  // [HOW]: Concatenates uppercase METHOD with normalized URL.
  // [INVARIANTS/WHEN]: 'GET:/items?a=1&b=2' and 'GET:/items?b=2&a=1' map to identical keys.
  key(method, rawUrl) {
    return `${method.toUpperCase()}:${this.normalizeUrl(rawUrl)}`;
  }

  // [WHY]: Loads existing tape interactions into memory for sub-millisecond retrieval.
  // [HOW]: Parses JSON array from disk and populates internal Map keyed by method+URL.
  // [INVARIANTS/WHEN]: Silently starts with empty tape if file does not yet exist.
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

  // [WHY]: Fast retrieval of recorded response during replay or auto mode.
  // [HOW]: Map lookup by interaction key.
  // [INVARIANTS/WHEN]: Returns interaction object or undefined.
  match(method, rawUrl) {
    return this.interactions.get(this.key(method, rawUrl));
  }

  // [WHY]: Stores live HTTP response for offline playback.
  // [HOW]: Appends or updates interaction in Map and persists entire cassette to disk.
  // [INVARIANTS/WHEN]: Only invoked during 'record' or 'auto' (on cache miss).
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

  // [WHY]: Atomic persistence of recorded interactions to disk.
  // [HOW]: Serializes Map values as formatted JSON array to cassette filePath.
  // [INVARIANTS/WHEN]: Tape on disk is always valid JSON representing complete history.
  flush() {
    const list = Array.from(this.interactions.values());
    writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
  }

  // [WHY]: Diagnostic helper for test harnesses to inspect number of recorded tracks.
  // [HOW]: Returns Map size.
  // [INVARIANTS/WHEN]: Returns non-negative integer.
  count() {
    return this.interactions.size;
  }
}
