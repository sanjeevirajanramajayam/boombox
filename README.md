# Boombox 📻

[![CI](https://github.com/sanjeevirajanramajayam/boombox/actions/workflows/ci.yml/badge.svg)](https://github.com/sanjeevirajanramajayam/boombox/actions)
[![Bun](https://img.shields.io/badge/Bun-v1.4+-black?logo=bun)](https://bun.sh)
[![RFC 9111](https://img.shields.io/badge/Standard-RFC%209111-blue)](https://www.rfc-editor.org/rfc/rfc9111.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **High-performance CLI caching proxy, VCR record/replay service virtualization engine, and network chaos simulator built with Bun.**

---

## Architecture Overview

```
+-------------------------------------------------------------------------+
|                               BOOMBOX                                   |
|                                                                         |
|  [Client] ---> (1. Transport Rules) ---> (2. Cache & VCR Engine)        |
|                      |                            |                     |
|            [Chaos / Delays]               [HIT] --+--> Return Stored    |
|                                                   |    Response         |
|                                            [MISS]                       |
|                                                   v                     |
|                                         (3. Origin Forwarding)          |
|                                                   |                     |
|                                                   v                     |
|                                           [Upstream Origin]             |
+-------------------------------------------------------------------------+
```

1. **RFC 9111 Compliance**: Caches safe idempotent verbs (`GET`, `HEAD`) while passing mutating verbs (`POST`, `PUT`, `DELETE`) to the origin with `X-Cache: BYPASS`.
2. **Hop-by-Hop Sanitization**: Strips connection-specific framing headers (`Transfer-Encoding`, `Connection`, `Keep-Alive`) per RFC 9110 §7.6.1 to prevent socket desynchronization.
3. **Deterministic Cache Keys**: Computes `SHA-256(METHOD + ":" + URL)` with alphabetical query parameter sorting so `/items?a=1&b=2` and `/items?b=2&a=1` produce identical cache keys.
4. **VCR Service Virtualization**: Records HTTP sessions into isolated JSON cassettes on disk, enabling 100% offline test execution with zero external network traffic.

---

## Installation & Prerequisites

Requires [Bun](https://bun.sh) (v1.4+):

```bash
# Clone the repository
git clone https://github.com/sanjeevirajanramajayam/boombox.git
cd boombox

# Link CLI locally
bun link
```

---

## Quick Start

### 1. Run as a Caching Proxy

```bash
# Start proxy forwarding to an origin API
bun bin/boombox.js --port 3000 --origin http://dummyjson.com
```

In another terminal:
```bash
# First request: Cache MISS (fetches from origin)
curl -i http://localhost:3000/products
# Response header: X-Cache: MISS

# Second request: Cache HIT (served from disk in <1ms)
curl -i http://localhost:3000/products
# Response header: X-Cache: HIT
```

### 2. Run in VCR Record Mode

Record live third-party API interactions into a named tape cassette:

```bash
bun bin/boombox.js --port 3000 --origin https://api.stripe.com --cassette stripe-tests --mode record
```

### 3. Run in VCR 100% Offline Replay Mode

Replay recorded responses without network connectivity (no `--origin` required):

```bash
bun bin/boombox.js --port 3000 --cassette stripe-tests --mode replay
```

- Recorded routes return immediate stored responses with `X-Cache: REPLAY`.
- Unrecorded routes fail fast with `502 Bad Gateway` and diagnostic JSON.

### 4. Clear Cache

Purge all stored cache files:

```bash
bun bin/boombox.js --clear-cache
```

---

## CLI Options

| Flag | Parameter | Description |
| :--- | :--- | :--- |
| `--port` | `<number>` | Port for the proxy server to listen on (default: `3000`) |
| `--origin` | `<url>` | Target upstream host URL (e.g. `http://dummyjson.com`) |
| `--cassette` | `<name>` | Named VCR tape to record to or replay from |
| `--mode` | `auto\|record\|replay` | VCR execution mode (default: `auto`) |
| `--clear-cache` | — | Purge all cached response fixtures from disk |
| `--help, -h` | — | Display the CLI help manual |

---

## Running the Test Suite

Boombox uses Bun's built-in test runner against real TCP loopback sockets:

```bash
bun test
```

All tests execute end-to-end against live and simulated network conditions in $<200\text{ ms}$.

---

## Contributing

1. Fork the repository and create your feature branch: `git checkout -b feat/my-feature`.
2. Ensure every non-trivial block includes first-principles commentary (`[WHY]`, `[HOW]`, `[INVARIANTS/WHEN]`).
3. Run `bun test` to ensure all invariant checks pass.
4. Submit a Pull Request using the [PR Template](.github/pull_request_template.md).

---

## License

[MIT](LICENSE) © [Sanjeevirajan Ramajayam](https://github.com/sanjeevirajanramajayam)
