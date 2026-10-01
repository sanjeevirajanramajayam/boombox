
import { createProxyServer } from '../src/server.js';

// 1. Mock origin
const originServer = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'POST') {
      return Response.json({ status: 'created' }, { status: 201 });
    }
    return Response.json({ items: ['guitar', 'drums', 'bass'], path: url.pathname });
  }
});

// 2. Start Boombox with chaos overrides and telemetry
const proxy = createProxyServer({
  port: 0,
  origin: `http://localhost:${originServer.port}`,
  overrides: ['/checkout:429']
});

const proxyUrl = `http://localhost:${proxy.server.port}`;

console.log('⚡ Generating simulated proxy traffic...\n');

// 3. Send requests
// Request 1: MISS
await fetch(`${proxyUrl}/products`);
// Request 2: HIT
await fetch(`${proxyUrl}/products`);
// Request 3: MISS (different path)
await fetch(`${proxyUrl}/products/1`);
// Request 4: HIT
await fetch(`${proxyUrl}/products/1`);
// Request 5: POST mutation (BYPASS)
await fetch(`${proxyUrl}/cart`, { method: 'POST', body: JSON.stringify({ item: 'amp' }) });
// Request 6: Route override (CHAOS 429)
await fetch(`${proxyUrl}/checkout`);

// 4. Render live TUI dashboard frame
console.log(proxy.telemetry.render());

// 5. Cleanup
proxy.server.stop(true);
originServer.stop(true);
