# Context & Domain Model: Boombox

This document defines the ubiquitous language, architectural invariants, and domain concepts of **Boombox**. All codebase changes, issue descriptions, and tests must adhere to these definitions.

---

## 1. System Purpose & Scope

**Boombox** is an RFC 9111-compliant HTTP caching proxy, VCR record/replay service virtualization engine, chaos simulator, and edge-native proxy deployed on Cloudflare Workers. It enables zero-dependency offline integration testing, origin shielding, and resilience testing.

---

## 2. Ubiquitous Language & Glossary

| Term | Strict Definition | Synonyms Avoided |
| :--- | :--- | :--- |
| **Representation** | Stored HTTP response envelope consisting of `statusCode`, sanitized `headers`, serialized `body`, binary flag (`isBase64`), and validation metadata (`etag`, `lastModified`, `cachedAt`, `maxAge`). | *cached item*, *cache record*, *cache entry* |
| **Freshness Lifetime** | The duration (in seconds) during which a representation is considered fresh without contacting origin, governed by `Cache-Control: max-age`. | *TTL*, *expiry date*, *lifetime* |
| **Stale-While-Revalidate (SWR)** | RFC 5861 directive allowing a client to receive an expired representation (`X-Cache: STALE`) while the proxy revalidates asynchronously in the background. | *background fetch*, *lazy update* |
| **Conditional Revalidation** | Validation of a stored representation using `If-None-Match` (`ETag`) or `If-Modified-Since`. On HTTP 304, the stored representation's timestamp is touched without transferring payload bytes. | *304 check*, *re-get* |
| **Variant Negotiation** | RFC 9111 §4.1 mechanism where the origin specifies a `Vary` header (e.g. `Accept`), causing the proxy to partition stored representations by the client's request headers. | *multi-cache*, *header branching* |
| **Cassette** | A named, filesystem-persisted JSON tape containing recorded HTTP interactions. | *mock fixture*, *stub file*, *snapshot* |
| **Interaction** | A single request/response pair inside a Cassette, keyed by method, canonical path, and optional body hash. | *recording*, *exchange*, *stub* |
| **Sequential Playback** | Deterministic playback of polling endpoints via an indexed cursor that steps through multiple recorded representations and sticks to the terminal state. | *stateful mocking*, *step replay* |
| **Transparent Full-URL** | Proxying mode where the target URL is embedded directly into the request path (e.g. `/https://api.stripe.com/v1/charges`), allowing multi-origin routing through a single endpoint. | *dynamic origin*, *wildcard proxy* |
| **Chaos Injection** | Deterministic or probabilistic fault simulation (synthetic delay, jitter range, 500 flakes, or route overrides) executed before cache lookup or origin forwarding. | *mock error*, *delay simulator* |
| **Hop-by-Hop Headers** | Connection-specific framing headers (`Transfer-Encoding`, `Connection`, `Keep-Alive`, `Proxy-Authenticate`, etc.) defined in RFC 9110 §7.6.1 that must be stripped by intermediaries. | *protocol headers*, *socket headers* |

---

## 3. Deep Architectural Seams

The Boombox pipeline is partitioned into distinct modular seams:

```
[Inbound Request]
       |
       v
1. Target Extraction Seam (`src/pipeline.js`)
   - Resolves target origin from transparent full-URLs, `X-Boombox-Origin` headers, or default origin.
       |
       v
2. Chaos Simulation Seam (`src/chaos.js`)
   - Evaluates overrides, probabilistic flakes, and synthetic latency.
       |
       v
3. Storage & Cache Seam (`src/storage.js`, `src/cache.js`, `src/match.js`)
   - Polymorphic adapters: `DiskCacheAdapter`, `InMemoryStorageAdapter`, `CassetteTapeAdapter`.
   - Normalization: `src/normalize.js` (canonical query parameter sorting and JSON key ordering).
       |
       v (On Cache MISS)
4. Origin Transport Seam (`src/transport.js`)
   - Executes outbound HTTP fetch, rewrites `Host`, strips hop-by-hop headers, sniffs binary MIME types.
```

---

## 4. Invariants

1. **RFC 9110 Hop-by-Hop Invariant**: Hop-by-hop headers must never be forwarded upstream to origin or downstream to client.
2. **Safe Method Cacheability Invariant**: Only idempotent safe methods (`GET`, `HEAD`) and body-matched `POST` queries may be cached; mutating verbs (`PUT`, `DELETE`, `PATCH`) must bypass cache (`X-Cache: BYPASS`).
3. **Cross-Origin Partitioning Invariant**: Transparent full-URL proxying must partition storage keys by full URI (`${origin}${path}`) to ensure zero cache collision across disparate domains.
4. **Offline Replay Isolation Invariant**: In `--mode replay`, unrecorded interactions must fail fast with HTTP 502 Bad Gateway and zero outbound network transmission.
5. **Edge Runtime Compatibility Invariant**: Edge worker bundles (`src/worker.js`) must not import `node:fs` or rely on Node.js-only globals without explicit polyfill.
