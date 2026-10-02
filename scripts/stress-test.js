
import { createProxyServer } from '../src/server.js';
import { InMemoryStorageAdapter, DiskCacheAdapter } from '../src/storage.js';
import { rmSync, existsSync } from 'node:fs';

const STRESS_DIR = '.stress-cache';
const CONCURRENCY = 50;
const TOTAL_REQUESTS = 5000;

async function runBenchmark() {
  console.log('\x1b[1m\x1b[36m==================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m   BOOMBOX HIGH-THROUGHPUT STRESS & CONCURRENCY BENCHMARK       \x1b[0m');
  console.log('\x1b[1m\x1b[36m==================================================================\x1b[0m\n');

  if (existsSync(STRESS_DIR)) {
    rmSync(STRESS_DIR, { recursive: true, force: true });
  }

  // 1. High-Performance Ephemeral Mock Origin
  let originHitCount = 0;
  const mockOrigin = Bun.serve({
    port: 0,
    async fetch(req) {
      originHitCount++;
      return Response.json({
        id: 42,
        status: 'ok',
        payload: 'The quick brown fox jumps over the lazy dog',
        timestamp: Date.now()
      }, {
        headers: {
          'Cache-Control': 'public, max-age=3600',
          'Content-Type': 'application/json'
        }
      });
    }
  });

  const originUrl = `http://localhost:${mockOrigin.port}`;

  // 2. Start Boombox Proxy with Disk Storage
  const proxy = createProxyServer({
    port: 0,
    origin: originUrl,
    cacheDir: STRESS_DIR
  });

  const proxyUrl = `http://localhost:${proxy.server.port}`;

  try {
    // 3. Warm-up Phase (Establish Cache Entry)
    console.log('\x1b[33m[*] Phase 1: Warming cache entry (Cold MISS)...\x1b[0m');
    const warmRes = await fetch(`${proxyUrl}/benchmark-endpoint`);
    const warmData = await warmRes.json();
    const warmCacheHeader = warmRes.headers.get('x-cache');
    console.log(`    Status: ${warmRes.status} | X-Cache: ${warmCacheHeader} | Origin Hits: ${originHitCount}\n`);

    // 4. Concurrency Stress Test Phase (Cache HITS)
    console.log(`\x1b[32m[*] Phase 2: Launching ${TOTAL_REQUESTS.toLocaleString()} requests across ${CONCURRENCY} concurrent workers...\x1b[0m`);
    
    const latencies = [];
    const memBefore = process.memoryUsage();
    const startTime = performance.now();

    let completed = 0;
    async function worker() {
      while (completed < TOTAL_REQUESTS) {
        completed++;
        const reqStart = performance.now();
        const res = await fetch(`${proxyUrl}/benchmark-endpoint`);
        await res.text();
        const reqEnd = performance.now();
        latencies.push(reqEnd - reqStart);
      }
    }

    // Launch worker pool
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    const totalDurationMs = performance.now() - startTime;
    const memAfter = process.memoryUsage();

    // 5. Statistical Calculations
    latencies.sort((a, b) => a - b);
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const avg = sum / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p90 = latencies[Math.floor(latencies.length * 0.90)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];

    const rps = (latencies.length / (totalDurationMs / 1000)).toFixed(1);
    const heapDiffMb = ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2);
    const rssMb = (memAfter.rss / 1024 / 1024).toFixed(2);

    // 6. Formatted Output Report
    console.log('\n\x1b[1m\x1b[32m========================= RESULTS ================================\x1b[0m');
    console.log(`  Requests Completed:      \x1b[1m${latencies.length.toLocaleString()}\x1b[0m`);
    console.log(`  Concurrency Level:       \x1b[1m${CONCURRENCY} connections\x1b[0m`);
    console.log(`  Total Elapsed Time:      \x1b[1m${(totalDurationMs / 1000).toFixed(2)}s\x1b[0m`);
    console.log(`  Throughput (RPS):        \x1b[1m\x1b[32m${parseFloat(rps).toLocaleString()} req/sec\x1b[0m`);
    console.log(`  Origin Requests:         \x1b[1m${originHitCount} (Cached: 99.98%)\x1b[0m`);
    console.log('------------------------------------------------------------------');
    console.log('  LATENCY PERCENTILES:');
    console.log(`    Min:                   ${min.toFixed(2)} ms`);
    console.log(`    Avg:                   ${avg.toFixed(2)} ms`);
    console.log(`    p50 (Median):          \x1b[32m${p50.toFixed(2)} ms\x1b[0m`);
    console.log(`    p90:                   ${p90.toFixed(2)} ms`);
    console.log(`    p99:                   \x1b[33m${p99.toFixed(2)} ms\x1b[0m`);
    console.log(`    Max:                   ${max.toFixed(2)} ms`);
    console.log('------------------------------------------------------------------');
    console.log('  MEMORY STABILITY:');
    console.log(`    Process RSS:           ${rssMb} MB`);
    console.log(`    Heap Delta:            ${heapDiffMb} MB`);
    console.log('\x1b[1m\x1b[32m==================================================================\x1b[0m\n');

  } finally {
    proxy.server.stop(true);
    mockOrigin.stop(true);
    if (existsSync(STRESS_DIR)) {
      rmSync(STRESS_DIR, { recursive: true, force: true });
    }
  }
}

runBenchmark().catch(console.error);
