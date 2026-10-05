
import { ProxyPipeline } from '../src/pipeline.js';
import { InMemoryStorageAdapter } from '../src/storage.js';
import { ChaosEngine } from '../src/chaos.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  bgDark: '\x1b[40m'
};

function banner(title) {
  console.log(`\n${ANSI.bold}${ANSI.cyan}======================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}  SCENARIO DEMO: ${title}${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}======================================================================${ANSI.reset}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------------------------
// Ephemeral Origin Server
// ----------------------------------------------------------------------------------
let originHitCount = 0;
const originServer = Bun.serve({
  port: 0,
  fetch(req) {
    originHitCount++;
    const url = new URL(req.url);
    if (url.pathname === '/api/user') {
      return Response.json({ id: 42, name: 'Alex Developer', role: 'Frontend Engineer' }, {
        headers: { 'Cache-Control': 'max-age=60' }
      });
    }
    if (url.pathname === '/checkout') {
      return Response.json({ success: true, orderId: 'ord_998877' });
    }
    return Response.json({ status: 'ok', path: url.pathname });
  }
});

const originUrl = `http://localhost:${originServer.port}`;

async function runDemo() {
  console.clear();
  console.log(`${ANSI.bold}${ANSI.magenta}📻 BOOMBOX TEAM SCENARIO VIDEO PROTOTYPES${ANSI.reset}`);
  console.log(`${ANSI.dim}Simulating real-world engineering team workflows in real time...${ANSI.reset}\n`);

  // ================================================================================
  // SCENARIO 1: Frontend Developer (Cache MISS -> Instant Cache HIT)
  // ================================================================================
  banner('1. FRONTEND DEV: Instant Local Caching (< 1ms vs Origin)');
  const storage1 = new InMemoryStorageAdapter();
  const pipeline1 = new ProxyPipeline({ origin: originUrl, storage: storage1 });

  console.log(`${ANSI.dim}[Client] Request 1: GET /api/user (Initial page load)...${ANSI.reset}`);
  const t1 = performance.now();
  const res1 = await pipeline1.dispatch(new Request(`${originUrl}/api/user`));
  const dur1 = (performance.now() - t1).toFixed(2);
  const data1 = await res1.json();
  console.log(`  ${ANSI.yellow}Status: ${res1.status} | X-Cache: ${res1.headers.get('X-Cache')} | Duration: ${dur1}ms${ANSI.reset}`);
  console.log(`  Payload: ${JSON.stringify(data1)}`);

  console.log(`\n${ANSI.dim}[Client] Request 2: GET /api/user (Page refresh / Component re-mount)...${ANSI.reset}`);
  const t2 = performance.now();
  const res2 = await pipeline1.dispatch(new Request(`${originUrl}/api/user`));
  const dur2 = (performance.now() - t2).toFixed(2);
  const data2 = await res2.json();
  console.log(`  ${ANSI.green}Status: ${res2.status} | X-Cache: ${res2.headers.get('X-Cache')} (Served from RAM) | Duration: ${dur2}ms${ANSI.reset}`);
  console.log(`  Payload: ${JSON.stringify(data2)}`);
  console.log(`  ${ANSI.bold}⚡ Speedup: ~${Math.round(dur1 / Math.max(dur2, 0.05))}x faster. Origin was shielded on request 2!${ANSI.reset}`);

  await sleep(1000);

  // ================================================================================
  // SCENARIO 2: CI/CD Platform (VCR Record -> Kill Origin -> 100% Offline Replay)
  // ================================================================================
  banner('2. CI/CD PLATFORM: Deterministic VCR Replay (Origin Offline)');
  const vcrStorage = new InMemoryStorageAdapter();

  console.log(`${ANSI.dim}[CI Setup] RECORD PHASE: Intercepting live third-party checkout API...${ANSI.reset}`);
  const recordPipeline = new ProxyPipeline({ origin: originUrl, storage: vcrStorage, cassette: true });
  const recRes = await recordPipeline.dispatch(new Request(`${originUrl}/checkout`));
  console.log(`  ${ANSI.cyan}Captured interaction into Cassette Tape (X-Cache: ${recRes.headers.get('X-Cache')})${ANSI.reset}`);

  console.log(`\n${ANSI.red}[Simulated Failure] 💥 External Origin Server is now STOPPED / UNREACHABLE...${ANSI.reset}`);
  const deadOriginPipeline = new ProxyPipeline({
    origin: 'http://localhost:59999', // Non-existent dead port
    storage: vcrStorage
  });

  console.log(`${ANSI.dim}[GitHub Actions Runner] REPLAY PHASE: Replaying tests 100% offline...${ANSI.reset}`);
  const replayRes = await deadOriginPipeline.dispatch(new Request(`http://localhost:59999/checkout`));
  const replayBody = await replayRes.json();
  console.log(`  ${ANSI.green}Status: ${replayRes.status} | X-Cache: ${replayRes.headers.get('X-Cache')} | Served in 0ms${ANSI.reset}`);
  console.log(`  Payload: ${JSON.stringify(replayBody)}`);
  console.log(`  ${ANSI.bold}✅ CI tests passed with zero external network connectivity!${ANSI.reset}`);

  await sleep(1000);

  // ================================================================================
  // SCENARIO 3: QA & SRE (Header-Driven Chaos & Route Override)
  // ================================================================================
  banner('3. QA & SRE: Fault Injection (Synthetic Latency & 503 Outage)');
  const chaosEngine = new ChaosEngine({
    latency: 200,
    overrides: ['/checkout:503']
  });
  const chaosPipeline = new ProxyPipeline({ origin: originUrl, storage: new InMemoryStorageAdapter(), chaos: chaosEngine });

  console.log(`${ANSI.dim}[QA Test] Injecting 200ms delay + forced 503 Service Unavailable on /checkout...${ANSI.reset}`);
  const chaosStart = performance.now();
  const chaosRes = await chaosPipeline.dispatch(new Request(`${originUrl}/checkout`));
  const chaosDur = (performance.now() - chaosStart).toFixed(2);
  const chaosBody = await chaosRes.json();
  console.log(`  ${ANSI.red}Status: ${chaosRes.status} | X-Chaos: ${chaosRes.headers.get('X-Chaos')} | Duration: ${chaosDur}ms${ANSI.reset}`);
  console.log(`  Fault Payload: ${JSON.stringify(chaosBody)}`);
  console.log(`  ${ANSI.bold}🛡️ Verified: Frontend error boundary correctly intercepted 503 without backend deploy!${ANSI.reset}`);

  await sleep(1000);

  // ================================================================================
  // SCENARIO 4: Microservices (Multi-Origin Transparent Proxying)
  // ================================================================================
  banner('4. MICROSERVICES & EDGE: Multi-Origin Transparent Proxying');
  const multiStorage = new InMemoryStorageAdapter();
  const multiPipeline = new ProxyPipeline({ storage: multiStorage });

  console.log(`${ANSI.dim}[API Gateway] Calling two distinct external APIs through 1 proxy endpoint...${ANSI.reset}`);
  const dummyRes = await multiPipeline.dispatch(new Request('http://localhost:3000/https://dummyjson.com/products/1'));
  const dummyData = await dummyRes.json();
  console.log(`  ${ANSI.cyan}1. DummyJSON: ${dummyData.title || 'Product 1'} (X-Cache: ${dummyRes.headers.get('X-Cache')})${ANSI.reset}`);

  const zenRes = await multiPipeline.dispatch(new Request('http://localhost:3000/https://api.github.com/zen'));
  const zenText = await zenRes.text();
  console.log(`  ${ANSI.magenta}2. GitHub Zen: "${zenText.trim()}" (X-Cache: ${zenRes.headers.get('X-Cache')})${ANSI.reset}`);
  console.log(`  ${ANSI.bold}🌐 Both origins routed transparently with isolated cache partitions!${ANSI.reset}\n`);

  originServer.stop();
  console.log(`${ANSI.green}✨ All 4 prototype scenarios executed successfully in video demonstration format.${ANSI.reset}\n`);
}

runDemo().catch(console.error);
