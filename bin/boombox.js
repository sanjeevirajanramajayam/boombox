#!/usr/bin/env bun

// [WHY]: Provides a user-friendly CLI binary according to Boombox specification.
//        Supports core caching and VCR record/replay flags (--cassette, --mode).
// [HOW]: Parses process.argv arguments, validates port, origin, and VCR modes, launching the proxy server.
// [INVARIANTS/WHEN]: In --mode replay, --origin is optional. In record or auto, --origin is required.

import { createProxyServer } from '../src/server.js';
import { CacheManager } from '../src/cache.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Boombox 📻 - Caching Proxy & VCR Service Virtualization CLI

Usage:
  boombox --port <number> --origin <url>             Start core caching proxy server
  boombox --clear-cache                              Purge all cached responses
  boombox --cassette <name> [--mode <mode>]          Run with VCR tape isolation
  boombox --help, -h                                 Display this help manual

VCR Modes (--mode):
  auto    (default) Replay existing tape tracks; fetch and record unrecorded routes.
  record            Always fetch from origin and record/update tape tracks.
  replay            100% offline playback. Zero external network calls.

Examples:
  boombox --port 3000 --origin http://dummyjson.com
  boombox --port 3000 --origin https://api.stripe.com --cassette stripe-test --mode record
  boombox --port 3000 --cassette stripe-test --mode replay
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
  }
}

if (!origin && mode !== 'replay') {
  console.error('Error: Missing required argument: --origin <url>');
  printHelp();
  process.exit(1);
}

const { server } = createProxyServer({ port, origin, cassette, mode });
console.log(`📻 Boombox proxy running at http://localhost:${server.port}`);
if (origin) console.log(`↳ Upstream origin: ${origin}`);
if (cassette) {
  console.log(`📼 VCR Active: cassette "${cassette}" (mode: ${mode.toUpperCase()})`);
} else {
  console.log(`↳ Local cache: .boombox-cache/`);
}
