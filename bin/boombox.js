#!/usr/bin/env bun


import { createProxyServer } from '../src/server.js';
import { CacheManager } from '../src/cache.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Boombox 📻 - Caching Proxy, VCR Service Virtualization & Chaos Simulator CLI

Usage:
  boombox --port <number> --origin <url>             Start core caching proxy server
  boombox --clear-cache                              Purge all cached responses
  boombox --cassette <name> [--mode <mode>]          Run with VCR tape isolation
  boombox [chaos options]                            Inject transport-level faults
  boombox --dashboard, --ui                          Launch live interactive terminal UI
  boombox --help, -h                                 Display this help manual

VCR Modes (--mode):
  auto    (default) Replay existing tape tracks; fetch and record unrecorded routes.
  record            Always fetch from origin and record/update tape tracks.
  replay            100% offline playback. Zero external network calls.

Advanced & Chaos Options:
  --redact <header>          Mask sensitive header with [REDACTED] in cassettes
  --match-body               Enable body-aware matching for GraphQL and JSON-RPC
  --latency <ms>             Add synthetic delay in milliseconds (e.g. 1500)
  --jitter <min-max>         Add randomized latency variance range in ms (e.g. 100-500)
  --flake <percent>          Inject randomized 500 errors on X% of requests (e.g. 20)
  --override <path:status>   Force specific route to return HTTP status code (e.g. /checkout:429)
  --dashboard, --ui          Display live ANSI telemetry dashboard

Examples:
  boombox --port 3000 --origin http://dummyjson.com
  boombox --port 3000 --origin https://api.stripe.com --cassette stripe-test --mode record
  boombox --port 3000 --cassette stripe-test --mode replay
  boombox --port 3000 --origin http://dummyjson.com --latency 1500 --flake 25
  boombox --port 3000 --origin http://dummyjson.com --override /checkout:429
  boombox --port 3000 --origin http://dummyjson.com --dashboard
  boombox --clear-cache
`);
}

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp();
  process.exit(0);
}

if (args.includes('--clear-cache')) {
  const cache = new CacheManager('.boombox-cache');
  cache.clear();
  console.log('✓ Boombox cache cleared successfully.');
  process.exit(0);
}

let port = 3000;
let origin = null;
let cassette = null;
let mode = 'auto';
let latency = 0;
let jitter = null;
let flake = 0;
let matchBody = false;
let showDashboard = false;
const overrides = [];
const redact = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.error('Error: --port must be a valid port number (1-65535).');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--origin' && args[i + 1]) {
    origin = args[i + 1];
    try {
      new URL(origin);
    } catch {
      console.error('Error: --origin must be a valid HTTP or HTTPS URL.');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--cassette' && args[i + 1]) {
    cassette = args[i + 1].trim();
    i++;
  } else if (args[i] === '--mode' && args[i + 1]) {
    mode = args[i + 1].toLowerCase();
    if (!['auto', 'record', 'replay'].includes(mode)) {
      console.error('Error: --mode must be one of: "auto", "record", "replay".');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--latency' && args[i + 1]) {
    latency = parseInt(args[i + 1], 10);
    if (isNaN(latency) || latency < 0) {
      console.error('Error: --latency must be a non-negative integer in milliseconds.');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--jitter' && args[i + 1]) {
    jitter = args[i + 1].trim();
    i++;
  } else if (args[i] === '--flake' && args[i + 1]) {
    flake = parseFloat(args[i + 1]);
    if (isNaN(flake) || flake < 0 || flake > 100) {
      console.error('Error: --flake must be a percentage between 0 and 100.');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--override' && args[i + 1]) {
    overrides.push(args[i + 1].trim());
    i++;
  } else if (args[i] === '--redact' && args[i + 1]) {
    redact.push(args[i + 1].trim());
    i++;
  } else if (args[i] === '--match-body') {
    matchBody = true;
  } else if (args[i] === '--dashboard' || args[i === '--ui']) {
    showDashboard = true;
  }
}

if (!origin && mode !== 'replay') {
  console.error('Error: Missing required argument: --origin <url>');
  printHelp();
  process.exit(1);
}

const { server, telemetry } = createProxyServer({
  port,
  origin,
  cassette,
  mode,
  latency,
  jitter,
  flake,
  overrides,
  redact,
  matchBody
});

if (showDashboard) {
  setInterval(() => {
    console.clear();
    console.log(telemetry.render());
  }, 1000);
} else {
  console.log(`📻 Boombox proxy running at http://localhost:${server.port}`);
  if (origin) console.log(`↳ Upstream origin: ${origin}`);
  if (cassette) {
    console.log(`📼 VCR Active: cassette "${cassette}" (mode: ${mode.toUpperCase()})`);
  } else {
    console.log(`↳ Local cache: .boombox-cache/`);
  }
  if (latency > 0) console.log(`⚡ Chaos Latency: +${latency}ms`);
  if (jitter) console.log(`⚡ Chaos Jitter: ${jitter}ms`);
  if (flake > 0) console.log(`⚡ Chaos Flake Rate: ${flake}% (HTTP 500)`);
  if (overrides.length > 0) console.log(`⚡ Chaos Route Overrides: ${overrides.join(', ')}`);
}
