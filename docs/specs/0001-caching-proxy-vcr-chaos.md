# Specification: Boombox — Caching Proxy with VCR Record/Replay and Chaos Resilience

## Problem Statement

Developers building applications and automated test suites face three recurring challenges when interacting with third-party HTTP services and APIs:

1. **Unpredictable Latency and Repetitive Traffic**: Repeatedly fetching identical, static, or slow resources wastes origin server bandwidth and bloats API bills without providing any performance gains.
2. **Brittle, Slow, and Network-Dependent Test Suites (The Third-Party API Trap)**: Integration and end-to-end tests that hit real external APIs (e.g., Stripe, external microservices, AI providers) are slow, fail whenever external networks fluctuate, burn rate limits, and make working offline or on airplanes impossible.
3. **Untested Failure and Degradation Modes**: Engineers frequently fail to test how their frontend or backend services behave under degraded network conditions—such as 1,500ms latency spikes, intermittent 500 errors, or 429 rate limits—because simulating these conditions against production APIs is difficult and risky.

## Solution

**Boombox**: A high-performance CLI Caching Proxy that provides a unified, zero-dependency solution across three interconnected operational modes:

1. **Core Caching Proxy**: An intermediary HTTP server that forwards incoming requests to a configurable origin host, caches response payloads and headers, returns immediate responses on cache hits, signals origin origin vs. cache status via standard `X-Cache` telemetry headers (`HIT` or `MISS`), and supports instantaneous cache invalidation.
2. **VCR Mode (Service Virtualization & Cassettes)**: A record-and-replay engine allowing developers to record entire API traffic sessions into isolated, named "cassettes" on disk. Test suites can run in replay-only mode with zero external network connectivity, ensuring sub-5ms test runs and 100% deterministic test fixtures.
3. **Chaos & Resilience Engine**: Built-in network fault injection enabling developers to configure artificial delays, latency jitter, randomized error rates, and deterministic route overrides directly via CLI flags without modifying application source code.

## User Stories

1. As a CLI user, I want to start the caching proxy by providing `--port <number>` and `--origin <url>`, so that the proxy runs locally and points to my chosen backend server.
2. As a client developer, I want all HTTP requests sent to the proxy to be forwarded to the corresponding paths and query strings on the origin server, so that the proxy behaves transparently.
3. As a client developer, I want the proxy to return an `X-Cache: MISS` header on the first request to a resource, so that I know the response was freshly retrieved from the origin server.
4. As a client developer, I want the proxy to store the response body, status code, and headers upon a cache miss, so that subsequent matching requests can be served locally.
5. As a client developer, I want identical subsequent requests to return an `X-Cache: HIT` header with the saved response body, so that latency is eliminated and the origin is not contacted.
6. As a developer, I want only safe, idempotent requests (`GET` and `HEAD`) cached by default, so that mutating actions (`POST`, `PUT`, `DELETE`) always reach the origin and do not return stale cached state.
7. As a CLI user, I want to run `caching-proxy --clear-cache`, so that all stored responses are purged immediately when I need a fresh start.
8. As a developer running automated tests, I want to pass `--cassette <name>` when starting the proxy, so that my recordings and cached responses are compartmentalized into a named tape folder rather than a generic global cache.
9. As a developer writing test suites, I want to run the proxy in `--mode record`, so that all requests are forwarded to the live origin and their responses update the named cassette on disk.
10. As a developer working offline or in CI/CD, I want to run the proxy in `--mode replay`, so that requests are matched against the named cassette without making any outbound network calls.
11. As a developer in replay mode, I want unrecorded requests to return an explicit `502 Bad Gateway` with an informative error payload, so that missing test fixtures fail fast and visibly rather than silently hanging or fetching live data.
12. As a developer, I want an `--mode auto` option (defaulting in normal operation), so that existing cassette entries are replayed while unrecorded routes are fetched from the origin and recorded.
13. As a frontend engineer, I want to pass `--latency <milliseconds>` to the proxy, so that every response is delayed by a predictable synthetic duration to test client-side loading spinners and skeleton screens.
14. As a resilience tester, I want to pass `--jitter <min-max>` (e.g. `100-500`), so that responses experience realistic random latency variance reflecting unpredictable mobile or cross-region connections.
15. As a QA engineer, I want to pass `--flake <percentage>` (e.g. `20`), so that the proxy randomly responds with `500 Internal Server Error` on a given percentage of requests to verify error boundaries and retry logic.
16. As a developer testing API rate limits, I want to pass `--override <path:status>` (e.g. `/checkout:429`), so that specific target routes reliably return simulated status codes without requiring backend modifications.
17. As a systems engineer, I want the proxy to remove hop-by-hop headers (such as `transfer-encoding`) and recalculate accurate `content-length` headers when serving cached responses, so that HTTP clients do not experience protocol framing errors.
18. As a terminal user, I want formatted, colorized CLI logs displaying the HTTP method, request path, status code, latency in milliseconds, and `[HIT]`/`[MISS]` or `[REPLAY]`/`[RECORD]` tag, so that I can observe proxy traffic in real time.
19. As a user providing invalid command-line inputs (such as non-numeric ports or malformed URLs), I want clear error messages and a usage help guide displayed before immediate exit, so that configuration mistakes are easily corrected.
20. As a user, I want to pass `--help` or `-h`, so that I can see documentation for all available flags and options at any time.

## Implementation Decisions

### 1. Unified Pipeline Architecture
- The system will be composed of three modular pipeline stages:
  - **Chaos Simulation Middleware Stage**: Evaluates incoming requests against active chaos rules (`--latency`, `--jitter`, `--flake`, `--override`). If an override or flake is triggered, it terminates the request immediately with the configured simulated response. If delay is configured, it pauses the execution pipeline before downstream handling.
  - **Cache / Cassette Lookup Stage**: Computes a deterministic cache key from the request method and normalized URI. Checks the active storage partition (either the global cache directory or the designated cassette directory). If a match is found, serves the cached response with `X-Cache: HIT`. In `replay` mode, if no match is found, immediately returns an offline miss response without invoking the upstream gateway.
  - **Origin Forwarding & Recording Stage**: Forwards cache misses to the configured origin URL, preserving request headers (with host rewrite). Streams the response back to the client with `X-Cache: MISS` while simultaneously collecting the payload to serialize into the active cassette/cache storage.

### 2. Cassette Storage Schema
- Cassette entries are stored in a predictable JSON structure containing:
  - `method`: HTTP method in uppercase.
  - `url`: Full relative URL path including query parameters.
  - `statusCode`: Upstream HTTP status code.
  - `headers`: Filtered response headers dictionary.
  - `body`: Base64-encoded response payload (guaranteeing safe persistence of both UTF-8 text and binary images/documents).
  - `recordedAt`: ISO-8601 timestamp.

### 3. Cache Key Normalization
- The cache key equation will be `SHA-256(METHOD + ":" + NORMALIZED_PATH_AND_QUERY)`.
- Query parameters will be sorted alphabetically prior to hashing so that `/search?a=1&b=2` and `/search?b=2&a=1` produce identical cache keys.

### 4. Hop-by-Hop Header Sanitization
- Hop-by-hop headers (`transfer-encoding`, `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`) will be stripped when serving cached responses to prevent HTTP connection desynchronization.

## Testing Decisions

### 1. What Makes a Good Test
- Tests must exclusively verify **observable external HTTP behavior**: sending real HTTP requests over TCP loopback sockets and asserting on the received HTTP status codes, headers, body contents, and round-trip elapsed times.
- Tests must **never** inspect private internal functions, mock Node core modules, or make assumptions about in-memory data structures.

### 2. Modules and Seams Tested
- All tests will run against the highest available seam: **HTTP Server Loopback (`fetch` against proxy port, proxy forwarding to a local mock HTTP server)**.
- Scenarios tested at this seam:
  - **Core Caching**: Sequential requests asserting `MISS` followed by `HIT`, verifying cache persistence, and asserting cache invalidation via `--clear-cache`.
  - **VCR Mode**: Recording interactions into a designated cassette, terminating the upstream mock server completely, and asserting that replay mode serves responses successfully in 100% offline isolation.
  - **Chaos Simulation**: Measuring request round-trip time under synthetic latency, asserting error rate under flake simulation, and asserting route override status codes.

### 3. Prior Art in the Codebase
- Builds upon the existing test harness pattern in the repository (`test.js`), which already demonstrates spinning up ephemeral Node HTTP servers for mock origins and proxy instances with cleanup hooks.

## Out of Scope

1. **Distributed / Multi-Node Caching**: Syncing cache entries across distributed clusters (e.g. Redis cluster or memcached) is out of scope. Storage is local filesystem-backed.
2. **Dynamic Request Body Mutation**: Rewriting or transforming the content of response bodies on the fly via user-defined JavaScript plugins is deferred to future milestones.
3. **HTTP/2 and HTTP/3 Protocol Negotiation**: The proxy will operate using standard HTTP/1.1 semantics.
4. **SSL/TLS Termination**: Termination of inbound HTTPS connections with custom certificates is out of scope; the proxy serves plain HTTP locally while supporting both HTTP and HTTPS origins.

## Further Notes

- The specification provides complete backward compatibility with all original roadmap requirements (`boombox --port <number> --origin <url>` and `boombox --clear-cache`).
- All advanced capabilities (VCR cassette modes and chaos simulations) are completely opt-in via optional flags, ensuring zero performance overhead during basic proxy usage.

---

## Implemented Extensions & Production Architecture (v1.0+)

### 1. Multi-Origin Emulation & Dynamic Routing
- Supports transparent full-URL paths (`/https://api.stripe.com/v1/charges`), dynamic per-request origin headers (`X-Boombox-Origin`), and runtime admin control plane updates (`POST /_boombox/origin`).
- Partitioned storage keys prevent cross-origin cache collisions by binding full target URIs into the primary cache key.

### 2. Cloudflare Workers Global Edge Deployment
- Edge-native isolate runtime (`src/worker.js`) running globally on Cloudflare Workers across 330+ Anycast PoPs (`https://boombox.sanjeevirajanramajayam.workers.dev`).
- Uses Web Standard `Request`, `Response`, and `caches.default` edge cache integration.

### 3. Advanced RFC 9111 & RFC 5861 Protocols
- **Freshness Evaluation**: Strict computation of freshness lifetimes via `Cache-Control: max-age`.
- **Stale-While-Revalidate (SWR)**: RFC 5861 asynchronous background revalidation delivering stale content immediately with `X-Cache: STALE`.
- **Conditional 304 Validation**: Revalidation using `If-None-Match` (`ETag`) and `If-Modified-Since` without re-downloading response bodies.
- **Vary Header Content Negotiation**: RFC 9111 §4.1 multi-variant caching partitioned by client request headers.

### 4. Enterprise Hardening & Media Support
- **Binary Media Preservation**: MIME sniffing and Base64 roundtrip serialization for images, audio, video, and documents.
- **OWASP Secret Redaction**: Automatic masking of sensitive headers (`Authorization`, `Set-Cookie`, `Cookie`) in cassettes.
- **Sequential Playback**: Stateful cursor-based polling endpoint simulation sticking to terminal states.
- **LRU Eviction**: Bounded disk quota with automatic eviction down to an 80% watermark.
