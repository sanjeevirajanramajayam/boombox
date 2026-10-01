# GitHub Copilot & Reviewer Guidelines for Boombox

When reviewing code, generating suggestions, or inspecting Pull Requests in this repository, strictly adhere to these architectural rules and invariants:

## 1. Domain Standards & RFC Compliance
- **RFC 9111 (HTTP Caching)**: Safe, idempotent methods (`GET`, `HEAD`) must be cached by default. Mutating verbs (`POST`, `PUT`, `DELETE`, `PATCH`) must bypass the cache and reach upstream origins directly.
- **RFC 9110 §7.6.1 (Hop-by-Hop Headers)**: Connection-specific headers (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`) must NEVER be forwarded or returned in cached responses to prevent protocol framing errors and HTTP desynchronization.
- **Telemetry Signals**: Responses must include standard `X-Cache` telemetry (`HIT`, `MISS`, `BYPASS`, `RECORD`, `REPLAY`).

## 2. Service Virtualization (VCR Mode)
- **Zero-Network Invariant**: When running in `--mode replay`, outbound network calls are strictly prohibited.
- **Fail Fast**: Unrecorded routes in replay mode must immediately return `502 Bad Gateway` with diagnostic JSON payload, never hang or attempt fallback fetching.

## 3. First-Principles Code Annotations
Every non-trivial logical block and function must include structured first-principles comment blocks:
- `// [WHY]`: The physical constraint or RFC requirement forcing the design.
- `// [HOW]`: The state transition or execution mechanism.
- `// [INVARIANTS/WHEN]`: Boundary conditions and safety guarantees that must hold true.

## 4. Runtime & Seams
- **Runtime**: Bun (v1.4+) with native Web Standards (`Bun.serve`, `fetch`, `Request`, `Response`, `Headers`).
- **Tests**: Assert observable HTTP behaviors across loopback TCP sockets. Avoid mocking internal functions.
