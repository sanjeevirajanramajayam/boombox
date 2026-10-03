
export class ChaosEngine {
  constructor({ latency = 0, jitter = null, flake = 0, overrides = [] } = {}) {
    this.latency = Math.max(0, parseInt(latency, 10) || 0);                               // Base synthetic delay in milliseconds (clamped >= 0)
    this.flake = Math.min(100, Math.max(0, parseFloat(flake) || 0));                      // Fault injection probability clamped to [0.0, 100.0]%
    this.jitter = this.parseJitter(jitter);                                               // Parsed min/max variance object or null
    this.overrides = this.parseOverrides(overrides);                                       // Parsed Map of pathname -> HTTP status code overrides
  }

  parseJitter(jitterStr) {
    if (!jitterStr || typeof jitterStr !== 'string') return null;                         // Ignore missing or non-string inputs
    const parts = jitterStr.split('-').map(p => parseInt(p.trim(), 10));                  // Split by hyphen and parse bounded integer pairs
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] <= parts[1]) { // Validate two valid numbers where min <= max
      return { min: Math.max(0, parts[0]), max: Math.max(0, parts[1]) };                 // Return normalized min/max boundary object
    }
    return null;                                                                          // Fall back to inert jitter if invalid
  }

  parseOverrides(overrideList) {
    const map = new Map();                                                                // Destination map: normalized path -> status code
    const list = Array.isArray(overrideList) ? overrideList : [overrideList].filter(Boolean); // Coerce single string or array to list

    for (const item of list) {                                                            // Iterate across each override configuration entry
      if (typeof item !== 'string') continue;                                             // Skip non-string malformed entries
      const [path, statusStr] = item.split(':');                                          // Split 'pathname:status' on colon separator
      if (path && statusStr) {                                                            // Ensure both route path and status code are provided
        const code = parseInt(statusStr.trim(), 10);                                      // Parse target HTTP status code to integer
        if (!isNaN(code) && code >= 100 && code <= 599) {                                 // Verify valid RFC 9110 HTTP status range [100, 599]
          const normalizedPath = path.trim().startsWith('/') ? path.trim() : '/' + path.trim(); // Guarantee leading forward slash on path
          map.set(normalizedPath, code);                                                  // Register override into lookup map
        }
      }
    }
    return map;                                                                           // Return compiled route override table
  }

  computeDelayMs() {
    let delay = this.latency;                                                             // Start with configured deterministic baseline latency
    if (this.jitter) {                                                                    // Check if synthetic jitter variance is enabled
      const extra = Math.floor(Math.random() * (this.jitter.max - this.jitter.min + 1)) + this.jitter.min; // Uniform random variance in [min, max]
      delay += extra;                                                                     // Combine baseline latency with jitter delay
    }
    return delay;                                                                         // Return total calculated delay in milliseconds
  }

  async evaluate(pathname) {
    // 1. Route Override Fault Injection
    if (this.overrides.has(pathname)) {                                                   // Check if exact requested path has forced override
      const status = this.overrides.get(pathname);                                        // Retrieve target HTTP status code
      return Response.json({                                                              // Immediately short-circuit with simulated payload
        chaos: 'override',                                                                // Identify failure mode as intentional route override
        status,                                                                           // Forced HTTP response status code
        path: pathname,                                                                   // Intercepted path
        message: `Simulated chaos route override (${status})`                            // Descriptive diagnostics message
      }, {
        status,                                                                           // Apply status code to HTTP response headers
        headers: { 'X-Chaos': `OVERRIDE=${status}` }                                      // Tag response for telemetry and observability
      });
    }

    // 2. Random Flake Fault Injection (Transient 500 errors)
    if (this.flake > 0) {                                                                 // Check if random flake simulation is enabled (> 0%)
      const roll = Math.random() * 100;                                                   // Roll pseudo-random floating point number in [0, 100)
      if (roll < this.flake) {                                                            // Check if rolled value falls within flake probability
        return Response.json({                                                            // Short-circuit request with transient 500 server error
          chaos: 'flake',                                                                 // Identify failure mode as probabilistic flake
          status: 500,                                                                    // Force HTTP 500 Internal Server Error
          path: pathname,                                                                 // Intercepted path
          message: `Simulated chaos flake error (${this.flake}% chance triggered)`       // Diagnostic probability explanation
        }, {
          status: 500,                                                                    // HTTP status code 500
          headers: { 'X-Chaos': 'FLAKE=500' }                                             // Tag response for telemetry and downstream tests
        });
      }
    }

    // 3. Synthetic Latency & Jitter Delay
    const delayMs = this.computeDelayMs();                                                // Calculate compound latency + jitter millisecond duration
    if (delayMs > 0) {                                                                    // Only pause if delay duration exceeds zero
      if (typeof Bun !== 'undefined' && typeof Bun.sleep === 'function') {                // Check for high-performance native Bun runtime timer
        await Bun.sleep(delayMs);                                                         // Native microsecond-accurate sleep
      } else {
        await new Promise(resolve => setTimeout(resolve, delayMs));                       // Standard event loop timer for Node.js / V8 Isolates
      }
    }

    return null;                                                                          // Request passed chaos filters without short-circuiting
  }
}

