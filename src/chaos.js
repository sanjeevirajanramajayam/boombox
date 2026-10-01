
export class ChaosEngine {
  constructor({ latency = 0, jitter = null, flake = 0, overrides = [] } = {}) {
    this.latency = Math.max(0, parseInt(latency, 10) || 0);
    this.flake = Math.min(100, Math.max(0, parseFloat(flake) || 0));
    this.jitter = this.parseJitter(jitter);
    this.overrides = this.parseOverrides(overrides);
  }

  parseJitter(jitterStr) {
    if (!jitterStr || typeof jitterStr !== 'string') return null;
    const parts = jitterStr.split('-').map(p => parseInt(p.trim(), 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] <= parts[1]) {
      return { min: Math.max(0, parts[0]), max: Math.max(0, parts[1]) };
    }
    return null;
  }

  parseOverrides(overrideList) {
    const map = new Map();
    const list = Array.isArray(overrideList) ? overrideList : [overrideList].filter(Boolean);

    for (const item of list) {
      if (typeof item !== 'string') continue;
      const [path, statusStr] = item.split(':');
      if (path && statusStr) {
        const code = parseInt(statusStr.trim(), 10);
        if (!isNaN(code) && code >= 100 && code <= 599) {
          const normalizedPath = path.trim().startsWith('/') ? path.trim() : '/' + path.trim();
          map.set(normalizedPath, code);
        }
      }
    }
    return map;
  }

  computeDelayMs() {
    let delay = this.latency;
    if (this.jitter) {
      const extra = Math.floor(Math.random() * (this.jitter.max - this.jitter.min + 1)) + this.jitter.min;
      delay += extra;
    }
    return delay;
  }

  async evaluate(pathname) {
    // 1. Route Override Fault Injection
    if (this.overrides.has(pathname)) {
      const status = this.overrides.get(pathname);
      return Response.json({
        chaos: 'override',
        status,
        path: pathname,
        message: `Simulated chaos route override (${status})`
      }, {
        status,
        headers: { 'X-Chaos': `OVERRIDE=${status}` }
      });
    }

    // 2. Random Flake Fault Injection (Transient 500 errors)
    if (this.flake > 0) {
      const roll = Math.random() * 100;
      if (roll < this.flake) {
        return Response.json({
          chaos: 'flake',
          status: 500,
          path: pathname,
          message: `Simulated chaos flake error (${this.flake}% chance triggered)`
        }, {
          status: 500,
          headers: { 'X-Chaos': 'FLAKE=500' }
        });
      }
    }

    // 3. Synthetic Latency & Jitter Delay
    const delayMs = this.computeDelayMs();
    if (delayMs > 0) {
      await Bun.sleep(delayMs);
    }

    return null;
  }
}
