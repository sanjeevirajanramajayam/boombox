
export class ProxyTelemetry {
  constructor({ maxRecent = 8, origin = '', mode = 'standard' } = {}) {
    this.maxRecent = maxRecent;
    this.origin = origin;
    this.mode = mode;
    this.startTime = Date.now();
    this.requests = 0;
    this.hits = 0;
    this.misses = 0;
    this.replays = 0;
    this.records = 0;
    this.faults = 0;
    this.recent = [];
  }

  record({ method, path, status, cacheSignal, durationMs }) {
    this.requests++;

    if (cacheSignal === 'HIT') this.hits++;
    else if (cacheSignal === 'MISS') this.misses++;
    else if (cacheSignal === 'REPLAY') this.replays++;
    else if (cacheSignal === 'RECORD') this.records++;

    if (String(status).startsWith('4') || String(status).startsWith('5') || cacheSignal?.includes('CHAOS') || cacheSignal?.includes('OVERRIDE')) {
      this.faults++;
    }

    this.recent.unshift({
      method: method.toUpperCase(),
      path: path.length > 32 ? path.slice(0, 29) + '...' : path,
      status,
      cacheSignal: cacheSignal || 'DIRECT',
      durationMs: Math.round(durationMs * 10) / 10,
      timestamp: new Date().toLocaleTimeString()
    });

    if (this.recent.length > this.maxRecent) {
      this.recent.pop();
    }
  }

  getHitRatio() {
    const cachedServed = this.hits + this.replays;
    if (this.requests === 0) return '0.0%';
    const ratio = (cachedServed / this.requests) * 100;
    return `${ratio.toFixed(1)}%`;
  }

  getUptime() {
    const secTotal = Math.floor((Date.now() - this.startTime) / 1000);
    const hrs = String(Math.floor(secTotal / 3600)).padStart(2, '0');
    const mins = String(Math.floor((secTotal % 3600) / 60)).padStart(2, '0');
    const secs = String(secTotal % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  }

  render() {
    const hitRatio = this.getHitRatio();
    const uptime = this.getUptime();

    const lines = [
      '┌────────────────────────────────────────────────────────────────────────┐',
      '│ 📻  BOOMBOX PROXY TELEMETRY DASHBOARD                                  │',
      '├────────────────────────────────────────────────────────────────────────┤',
      `│ Uptime:   ${uptime.padEnd(12)} │ Requests: ${String(this.requests).padEnd(10)} │ Hit Ratio: ${hitRatio.padEnd(12)}│`,
      `│ Hits:     ${String(this.hits).padEnd(12)} │ Misses:   ${String(this.misses).padEnd(10)} │ Replays:   ${String(this.replays).padEnd(12)}│`,
      `│ Faults:   ${String(this.faults).padEnd(12)} │ Mode:     ${this.mode.toUpperCase().padEnd(10)} │ Records:   ${String(this.records).padEnd(12)}│`,
      '├────────────────────────────────────────────────────────────────────────┤',
      '│ RECENT TRANSACTIONS:                                                   │'
    ];

    if (this.recent.length === 0) {
      lines.push('│ (Waiting for incoming HTTP requests...)                                │');
    } else {
      for (const item of this.recent) {
        const tag = `[${item.cacheSignal}]`.padEnd(10);
        const verb = item.method.padEnd(6);
        const p = item.path.padEnd(32);
        const stat = String(item.status).padEnd(5);
        const ms = `${item.durationMs}ms`.padStart(8);
        lines.push(`│ ${tag} ${verb} ${p} ${stat} ${ms} │`);
      }
    }

    lines.push('└────────────────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}
