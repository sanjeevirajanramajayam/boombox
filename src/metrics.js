
export class MetricsCollector {
  constructor({ maxRecent = 10, origin = '', mode = 'cache', port = 3000 } = {}) {
    this.maxRecent = maxRecent;
    this.origin = origin;
    this.mode = mode;
    this.port = port;
    this.statusMessage = 'System online. Monitoring loopback traffic.';
    this.statusTime = Date.now();
    this.reset();
  }

  reset() {
    this.startTime = Date.now();
    this.requests = 0;
    this.hits = 0;
    this.misses = 0;
    this.replays = 0;
    this.records = 0;
    this.faults = 0;
    this.revalidations = 0;
    this.totalDurationMs = 0;
    this.recent = [];
  }

  setStatus(msg) {
    this.statusMessage = msg;
    this.statusTime = Date.now();
  }

  record({ method, path, status, cacheSignal, durationMs = 0 }) {
    this.requests++;
    this.totalDurationMs += durationMs;

    if (cacheSignal === 'HIT') this.hits++;
    else if (cacheSignal === 'MISS') this.misses++;
    else if (cacheSignal === 'REPLAY') this.replays++;
    else if (cacheSignal === 'RECORD') this.records++;
    else if (cacheSignal === 'REVALIDATED') this.revalidations++;

    const isFault = String(status).startsWith('4') ||
                    String(status).startsWith('5') ||
                    String(cacheSignal || '').includes('CHAOS') ||
                    String(cacheSignal || '').includes('OVERRIDE') ||
                    String(cacheSignal || '').includes('FLAKE');

    if (isFault) {
      this.faults++;
    }

    const cleanPath = path.length > 32 ? path.slice(0, 29) + '...' : path;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    this.recent.unshift({
      method: method.toUpperCase(),
      path: cleanPath,
      rawPath: path,
      status,
      cacheSignal: cacheSignal || 'DIRECT',
      durationMs: Math.round(durationMs * 10) / 10,
      timestamp: timeStr
    });

    if (this.recent.length > this.maxRecent) {
      this.recent.pop();
    }
  }

  getHitRatio() {
    if (this.requests === 0) return '0.0%';
    const cachedServed = this.hits + this.replays + this.revalidations;
    const ratio = (cachedServed / this.requests) * 100;
    return `${ratio.toFixed(1)}%`;
  }

  getHitRatioNumeric() {
    if (this.requests === 0) return 0;
    const cachedServed = this.hits + this.replays + this.revalidations;
    return (cachedServed / this.requests) * 100;
  }

  getAvgLatency() {
    if (this.requests === 0) return '0.0ms';
    const avg = this.totalDurationMs / this.requests;
    return `${avg.toFixed(1)}ms`;
  }

  getUptime() {
    const secTotal = Math.floor((Date.now() - this.startTime) / 1000);
    const hrs = String(Math.floor(secTotal / 3600)).padStart(2, '0');
    const mins = String(Math.floor((secTotal % 3600) / 60)).padStart(2, '0');
    const secs = String(secTotal % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  }

  snapshot() {
    return {
      uptime: this.getUptime(),
      requests: this.requests,
      hits: this.hits,
      misses: this.misses,
      replays: this.replays,
      records: this.records,
      revalidations: this.revalidations,
      faults: this.faults,
      hitRatio: this.getHitRatio(),
      hitRatioNumeric: this.getHitRatioNumeric(),
      avgLatency: this.getAvgLatency(),
      recent: [...this.recent]
    };
  }
}
