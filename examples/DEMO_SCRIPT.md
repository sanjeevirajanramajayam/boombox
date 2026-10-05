# Boombox Video Demonstration Script (3 Split Terminals)

This cheat sheet guides you through recording a **3-minute high-impact video demonstration** of Boombox with a live React frontend and native Bun backend.

---

## Screen Layout Setup (Side-by-Side)

Arrange your screen into **3 terminal panes** and **1 browser window**:
* **Top-Left Terminal (Terminal 1)**: `Store Backend (:4000)`
* **Bottom-Left Terminal (Terminal 2)**: `Boombox Proxy (:3000)`
* **Bottom-Right Terminal (Terminal 3)**: `React Frontend (:5173)`
* **Right Half of Screen**: Browser on `http://localhost:5173`

---

## Video Walkthrough Steps

### Phase 1: Boot the 3 Services (0:00 - 0:30)

1. **Terminal 1 (Backend Origin)**:
   ```bash
   bun run demo:backend
   ```
   * *Talking Point*: "Here is our origin store backend running on port 4000 with a 120ms database lag on products and a Stripe checkout endpoint."

2. **Terminal 2 (Boombox Proxy)**:
   ```bash
   bun run demo:proxy
   ```
   * *Talking Point*: "Boombox starts on port 3000, acting as a transparent caching proxy pointing to our backend."

3. **Terminal 3 (React Storefront)**:
   ```bash
   bun run demo:frontend
   ```
   * Open `http://localhost:5173` in your browser.

---

### Phase 2: Demonstrate Cache MISS vs. Cache HIT Speedup (0:30 - 1:00)

1. Look at the top navbar in the React app:
   * First load: Latency shows **~120ms - 140ms**, Badge shows `X-Cache: MISS`.
   * *Talking Point*: "On the first page load, Boombox forwards the request to the backend origin, taking 130ms, and stores the response in memory."
2. Click **"🔄 Refresh Catalogue"**:
   * Latency instantly drops to **0.4ms - 1.2ms**, Badge turns green: `X-Cache: HIT`.
   * *Talking Point*: "On refresh, Boombox serves the entire catalogue directly from memory in sub-millisecond time. The backend was completely shielded."

---

### Phase 3: Physically Kill the Backend Origin (Offline Resilience) (1:00 - 1:45)

1. Focus on **Terminal 1 (Store Backend)**:
   * Press **`Ctrl + C`** to kill the backend server.
   * Terminal 1 is now dead!
   * *Talking Point*: "Now, imagine our staging backend or third-party database crashes. Terminal 1 is completely terminated."
2. Switch to the Browser and click **"🔄 Refresh Catalogue"**:
   * The products **still load instantly in < 1ms** with `X-Cache: HIT`!
   * *Talking Point*: "Even with the origin server completely dead, our frontend continues working without disruption thanks to Boombox's RFC 9111 cache."

---

### Phase 4: Chaos Simulation — Synthetic Latency & Loading Skeletons (1:45 - 2:15)

1. Restart the backend in **Terminal 1**:
   ```bash
   bun run demo:backend
   ```
2. Restart Boombox in **Terminal 2** with 2.5s artificial delay:
   * Press `Ctrl + C` in Terminal 2.
   * Run:
     ```bash
     bun bin/boombox.js --port 3000 --origin http://localhost:4000 --latency 2500
     ```
   * *Talking Point*: "Now let's simulate degraded 3G mobile latency using Boombox's built-in Chaos Engine without modifying any backend code."
3. Switch to Browser and click **"🔄 Refresh Catalogue"**:
   * The React UI shows **animated shimmer skeletons** for exactly 2.5 seconds before rendering the products!
   * *Talking Point*: "Our frontend team can visually test loading spinners and skeleton states reliably."

---

### Phase 5: Chaos Simulation — Simulated 503 Payment Gateway Failure (2:15 - 2:45)

1. Stop Boombox in **Terminal 2** (`Ctrl + C`) and restart with a 503 route override on checkout:
   ```bash
   bun bin/boombox.js --port 3000 --origin http://localhost:4000 --override /api/checkout/pay:503
   ```
   * *Talking Point*: "What happens when Stripe has an unexpected outage? We pass `--override /api/checkout/pay:503`."
2. In the Browser:
   * Click **"Add to Cart"** on any product.
   * Click **"Pay with Stripe"**:
   * Boombox intercepts the payment and returns 503.
   * The React cart immediately displays a red error banner:
     `🚨 Payment Gateway Failure! HTTP 503: Simulated chaos route override`
   * *Talking Point*: "Our payment error boundary caught the 503 error immediately, enabling QA to test recovery flows on demand."

---

### Phase 6: Conclusion & Cloudflare Edge Deployment (2:45 - 3:00)

* *Talking Point*: "Everything we demonstrated locally also runs globally on our deployed Cloudflare Workers edge runtime at `https://boombox.sanjeevirajanramajayam.workers.dev` with sub-15ms Anycast termination across 330+ cities worldwide."

---

## Quick Reference Commands

| Terminal | Command |
| :--- | :--- |
| **Terminal 1 (Backend)** | `bun run demo:backend` |
| **Terminal 2 (Normal Proxy)** | `bun run demo:proxy` |
| **Terminal 2 (Chaos Delay)** | `bun bin/boombox.js --port 3000 --origin http://localhost:4000 --latency 2500` |
| **Terminal 2 (Chaos 503)** | `bun bin/boombox.js --port 3000 --origin http://localhost:4000 --override /api/checkout/pay:503` |
| **Terminal 3 (React UI)** | `bun run demo:frontend` |
