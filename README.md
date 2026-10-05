# Boombox 📻

[![CI](https://github.com/sanjeevirajanramajayam/boombox/actions/workflows/ci.yml/badge.svg)](https://github.com/sanjeevirajanramajayam/boombox/actions)
[![Bun](https://img.shields.io/badge/Bun-v1.4+-black?logo=bun)](https://bun.sh)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-Edge-F38020?logo=cloudflare)](https://boombox.sanjeevirajanramajayam.workers.dev)
[![RFC 9111](https://img.shields.io/badge/Standard-RFC%209111-blue)](https://www.rfc-editor.org/rfc/rfc9111.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **High-performance CLI caching proxy, VCR record/replay service virtualization engine, network chaos simulator, and edge-native Cloudflare Worker built with Bun.**

---

## Live Global Edge Deployment

Boombox is deployed live on Cloudflare Workers across 330+ global Anycast edge PoPs:
* **Edge Worker URL**: [`https://boombox.sanjeevirajanramajayam.workers.dev`](https://boombox.sanjeevirajanramajayam.workers.dev)
* **Bundle Footprint**: 24.86 KiB (7.01 KiB gzipped), 1ms startup time, V8 Isolates.
* **Live Smoke Test**:
  ```bash
  curl -i https://boombox.sanjeevirajanramajayam.workers.dev/products/1
  ```

---

## Architecture & Deep Module Seams

```
+-----------------------------------------------------------------------------------------+
|                                    BOOMBOX PIPELINE                                     |
|                                                                                         |
|  [Client Request]                                                                       |
|         |                                                                               |
|         v                                                                               |
|  (1. Target Extraction) -------> Dynamic Headers (X-Boombox-Origin), Admin API,        |
|         |                        or Transparent Full-URLs (/https://domain/path)        |
|         v                                                                               |
|  (2. Chaos Engine) ------------> Synthetic Latency, Jitter Variance, Flakes, Overrides  |
|         |                                                                               |
|         v                                                                               |
|  (3. Storage Lookup) ----------> DiskCacheAdapter | InMemoryAdapter | CassetteAdapter   |
|         |                                 |                                             |
|         |-- [Fresh HIT] ------------------+-----> Return Cached Representation (X-Cache: HIT)
|         |-- [RFC 5861 SWR] ---------------+-----> Return STALE + Background Revalidate   |
|         |-- [Conditional 304] ------------+-----> Touch cachedAt + Return Cached Payload |
|         |-- [Offline Cassette Replay] ----+-----> Return Recorded Response (or 502 Miss)|
|         |                                                                               |
|         v [MISS]                                                                        |
|  (4. Origin Transport) ---------> Hop-by-Hop Sanitization, Host Rewriting, Timeout     |
|         |                                                                               |
|         v                                                                               |
|  [Upstream Origin] -------------> Persist to Storage -> Return Response to Client      |
+-----------------------------------------------------------------------------------------+
```

1. **RFC 9111 HTTP Caching Compliance**: Strict freshness lifetime calculation via `Cache-Control: max-age`. Safe idempotent verbs (`GET`, `HEAD`) are cached while mutating methods (`POST`, `PUT`, `DELETE`) bypass cache by default.
2. **RFC 5861 `stale-while-revalidate` (SWR)**: Delivers stale cached content instantly with `X-Cache: STALE` while triggering non-blocking background revalidation via `ctx.waitUntil()` on edge isolates.
3. **Conditional 304 Revalidation**: Sends `If-None-Match` (`ETag`) and `If-Modified-Since` upstream. On HTTP 304, updates `cachedAt` timestamps without refetching payload bytes.
4. **RFC 9111 §4.1 `Vary` Multi-Variant Content Negotiation**: Partitions cached representations by incoming client headers (`Accept`, `Accept-Encoding`, etc.) to prevent incorrect media delivery.
5. **Multi-Origin Emulation & Dynamic Routing**: Proxies multiple APIs through a single instance using transparent full-URLs (`/https://api.stripe.com/v1/charges`), dynamic headers (`X-Boombox-Origin`), or runtime control plane updates (`POST /_boombox/origin`). Full target URLs partition storage keys to guarantee zero cross-origin cache collision.
6. **Binary Media Preservation**: Sniffs MIME types (`image/*`, `audio/*`, `video/*`, `pdf`, `zip`, `octet-stream`) and serializes to Base64, preserving raw byte fidelity.
7. **OWASP Secret & Credential Redaction**: Automatically sanitizes sensitive credentials (`Authorization`, `Cookie`, `Set-Cookie`) in cassettes.
8. **Sequential Playback for Polling Endpoints**: State machine cursor deterministically replays state transitions (e.g. `PENDING` -> `PROCESSING` -> `COMPLETED`) and sticks to terminal states.
9. **Bounded Disk Quota & LRU Eviction**: Automatically tracks disk usage and purges least recently accessed entries down to an 80% watermark when `--max-size` is exceeded.
10. **Hop-by-Hop Sanitization**: Strips RFC 9110 §7.6.1 hop-by-hop framing headers (`Transfer-Encoding`, `Connection`, `Keep-Alive`) to prevent socket desynchronization.

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

### 2. Multi-Origin Transparent Proxying

Proxy any external API without restarting or reconfiguring the proxy:

```bash
# 1. Full-URL Transparent Proxying
curl -i http://localhost:3000/https://api.github.com/zen
curl -i http://localhost:3000/https://dummyjson.com/products/1

# 2. Dynamic Origin Header Override
curl -i -H "X-Boombox-Origin: https://api.stripe.com" http://localhost:3000/v1/charges

# 3. Dynamic Admin Control Plane Reconfiguration
curl -X POST http://localhost:3000/_boombox/origin \
  -H "Content-Type: application/json" \
  -d '{"origin": "https://api.github.com"}'
```

### 3. Run in VCR Record Mode

Record live third-party API interactions into a named tape cassette:

```bash
bun bin/boombox.js --port 3000 --origin https://api.stripe.com --cassette stripe-tests --mode record
```

### 4. Run in VCR 100% Offline Replay Mode

Replay recorded responses without network connectivity (no `--origin` required):

```bash
bun bin/boombox.js --port 3000 --cassette stripe-tests --mode replay
```

- Recorded routes return immediate stored responses with `X-Cache: REPLAY`.
- Unrecorded routes fail fast with `502 Bad Gateway` and diagnostic JSON.

### 5. Inject Chaos & Faults

Simulate slow networks, erratic mobile latency, rate limits, and outages without modifying application code:

```bash
# Add 1.5s artificial latency and 20% flake error rate
bun bin/boombox.js --port 3000 --origin http://dummyjson.com --latency 1500 --flake 20

# Simulate erratic 4G mobile jitter between 100ms and 500ms
bun bin/boombox.js --port 3000 --origin http://dummyjson.com --jitter 100-500

# Force deterministic rate limit (429) on checkout
bun bin/boombox.js --port 3000 --origin http://dummyjson.com --override /checkout:429
```

### 6. Interactive Terminal Telemetry Dashboard

Launch the real-time ANSI terminal dashboard displaying requests, hit ratios, and latency:

```bash
bun bin/boombox.js --port 3000 --origin http://dummyjson.com --dashboard
```

### 7. Clear Cache

Purge all stored cache files:

```bash
bun bin/boombox.js --clear-cache
```

---

## CLI Options Reference

| Flag | Parameter | Description |
| :--- | :--- | :--- |
| `--port` | `<number>` | Port for the proxy server to listen on (default: `3000`) |
| `--origin` | `<url>` | Target upstream host URL (e.g. `http://dummyjson.com`) |
| `--cassette` | `<name>` | Named VCR tape to record to or replay from |
| `--mode` | `auto\|record\|replay` | VCR execution mode (default: `auto`) |
| `--redact` | `<header>` | Mask sensitive header with `[REDACTED]` in cassettes |
| `--match-body` | — | Enable request body hashing for GraphQL and JSON-RPC |
| `--max-size` | `<bytes>` | Disk storage quota; triggers LRU eviction to 80% watermark |
| `--latency` | `<ms>` | Synthetic delay in milliseconds |
| `--jitter` | `<min-max>` | Randomized latency variance range in milliseconds |
| `--flake` | `<percent>` | Probability (0-100%) of injecting HTTP 500 errors |
| `--override` | `<path:status>` | Force target path to return HTTP status code (e.g. `/cart:429`) |
| `--dashboard, --ui` | — | Launch real-time interactive terminal telemetry dashboard |
| `--clear-cache` | — | Purge all cached response fixtures from disk |
| `--help, -h` | — | Display the CLI help manual |

---

## Verification & Test Suite

Boombox enforces strict empirical verification using Bun's native test runner against real TCP loopback sockets:

```bash
bun test
```

```
39 pass
0 fail
221 expect() calls
Ran 39 tests across 18 files. (~3.0s)
```

| Test Suite | File | Focus |
| :--- | :--- | :--- |
| **Multi-Origin** | [`test/multi-origin.test.js`](test/multi-origin.test.js) | Transparent full-URLs, collision-free key partitioning, runtime origin updates |
| **Cloudflare Edge** | [`test/worker.test.js`](test/worker.test.js) | V8 isolate worker dispatching, Cache API simulation, edge chaos |
| **SWR Background** | [`test/swr.test.js`](test/swr.test.js) | RFC 5861 `stale-while-revalidate` background revalidation |
| **TTL & 304 Validation** | [`test/ttl.test.js`](test/ttl.test.js) | `max-age` expiration, conditional `ETag` and `Last-Modified` 304 updates |
| **Vary Content Negotiation** | [`test/vary.test.js`](test/vary.test.js) | RFC 9111 §4.1 multi-variant storage by request headers |
| **LRU Quota Eviction** | [`test/lru.test.js`](test/lru.test.js) | Bounded disk storage quota and LRU eviction down to 80% watermark |
| **Binary Media** | [`test/binary.test.js`](test/binary.test.js) | Binary MIME sniffing and Base64 roundtrip byte preservation |
| **Secret Redaction** | [`test/redaction.test.js`](test/redaction.test.js) | OWASP header sanitization in recorded cassettes |
| **Sequential Playback** | [`test/sequential-vcr.test.js`](test/sequential-vcr.test.js) | Polling endpoint state transitions and terminal state stickiness |
| **Deep Pipeline** | [`test/pipeline.test.js`](test/pipeline.test.js) | Core orchestration across chaos, storage, and transport seams |

---

## Contributing

1. Fork the repository and create your feature branch: `git checkout -b feat/my-feature`.
2. Ensure every non-trivial block includes first-principles commentary (`[WHY]`, `[HOW]`, `[INVARIANTS/WHEN]`).
3. Run `bun test` to ensure all 39 invariant checks pass.
4. Maintain [`AUDIT_LOG.md`](AUDIT_LOG.md) for architectural modifications.
5. Submit a Pull Request using the [PR Template](.github/pull_request_template.md).

---

## License

[MIT](LICENSE) © [Sanjeevi Rajan Ramajayam](https://github.com/sanjeevirajanramajayam)
