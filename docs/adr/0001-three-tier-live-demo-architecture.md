# ADR 0001: Three-Tier Split-Terminal Architecture for Live Failure & Resilience Demos

## Status
Accepted

## Context
When demonstrating a caching proxy, VCR engine, and chaos simulator to external stakeholders, engineers, or on video recordings, mock-only abstractions in a browser console do not convincingly prove that:
1. An independent backend server was physically terminated.
2. The caching proxy genuinely intercepted network packets on loopback sockets.
3. The frontend application survived a real upstream outage without throwing unhandled promise rejections.

We need a runnable, production-like demonstration architecture where the physical separation of processes is visually undeniable on camera.

## Decision
We establish a canonical 3-tier split-process architecture for demonstrations:

```
[Terminal 1: Origin Backend]       [Terminal 2: Boombox Proxy]       [Terminal 3: React Storefront]
    http://localhost:4000   <----      http://localhost:3000   <----      http://localhost:5173
```

1. **Origin Backend (`http://localhost:4000`)**: A lightweight native Bun HTTP server providing `/api/products` (cached catalogue), `/api/checkout/pay` (Stripe payment simulation), and `/api/health`.
2. **Boombox Intermediary (`http://localhost:3000`)**: The active proxy instance configured via CLI flags (`--origin http://localhost:4000`). It is restarted on camera to demonstrate chaos injection (`--latency`, `--override`, `--flake`) and service virtualization.
3. **React Storefront (`http://localhost:5173`)**: A modern Vite + React 19 web application pointing to `http://localhost:3000`. It visually surfaces:
   - Animated shimmer skeletons during synthetic latency delays.
   - Header inspection badges (`X-Cache: HIT`, `MISS`, `BYPASS`).
   - Red error banners upon 503 payment gateway overrides.
   - Zero-downtime operation when Terminal 1 is killed with `Ctrl+C`.

## Consequences
- **Positive**: Visually incontrovertible proof of system resilience; recruiters and viewers see the physical backend terminate in Terminal 1 while Terminal 3 continues rendering data from Terminal 2.
- **Positive**: Strict isolation of concerns; frontend codebase contains zero mock logic, behaving exactly like an enterprise application in production.
- **Negative**: Requires 3 open terminal windows instead of a single merged script, but this is an intentional trade-off to enable killing the backend independently on video.
