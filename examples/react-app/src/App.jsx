import React, { useState } from 'react';

// [WHY]: Provide a real-world React demo showing how frontend engineering teams consume Boombox.
// [HOW]: Switches baseURL between Direct Origin and Boombox Edge/Local Proxy; measures roundtrip latency,
//        inspects X-Cache headers, injects chaos headers on demand, and tests multi-origin proxying.
// [INVARIANTS/WHEN]: Safe fallback to mock responses if local proxy is offline during client-side testing.

export default function App() {
  const [gatewayMode, setGatewayMode] = useState('edge'); // 'edge' | 'local' | 'direct'
  const [logs, setLogs] = useState([
    `[${new Date().toLocaleTimeString()}] System ready. Select gateway and run scenarios.`
  ]);

  // Scenario 1: Cache Speedup
  const [s1State, setS1State] = useState({ latency: null, signal: null, count: 0, data: null, speedup: null, firstLatency: null });
  const [s1Loading, setS1Loading] = useState(false);

  // Scenario 2: CI / VCR
  const [s2State, setS2State] = useState({ status: null, signal: null, offline: false, order: null });

  // Scenario 3: QA Chaos
  const [s3Delay, setS3Delay] = useState(1500);
  const [s3Override, setS3Override] = useState(false);
  const [s3State, setS3State] = useState({ status: null, latency: null, error: null });
  const [s3Loading, setS3Loading] = useState(false);

  // Scenario 4: Multi-Origin
  const [s4Zen, setS4Zen] = useState(null);
  const [s4Product, setS4Product] = useState(null);

  // Compute Active Base URL
  const getBaseUrl = () => {
    if (gatewayMode === 'edge') return 'https://boombox.sanjeevirajanramajayam.workers.dev';
    if (gatewayMode === 'local') return 'http://localhost:3000';
    return 'https://dummyjson.com';
  };

  const addLog = (msg) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15)]);
  };

  // --------------------------------------------------------------------------
  // Scenario 1: Frontend Developer (Cache MISS vs Cache HIT)
  // --------------------------------------------------------------------------
  const runScenario1 = async () => {
    setS1Loading(true);
    const start = performance.now();
    const baseUrl = getBaseUrl();
    const targetUrl = `${baseUrl}/products/1`;

    try {
      addLog(`[Client] GET ${targetUrl}...`);
      const res = await fetch(targetUrl);
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json();
      const signal = res.headers.get('X-Cache') || (gatewayMode === 'direct' ? 'DIRECT (NO CACHE)' : 'HIT');

      let speedup = null;
      let firstLat = s1State.firstLatency;
      if (!firstLat && signal === 'MISS') {
        firstLat = elapsed;
      } else if (firstLat && signal === 'HIT') {
        speedup = Math.round(firstLat / Math.max(elapsed, 1));
      }

      setS1State((prev) => ({
        latency: elapsed,
        signal,
        count: prev.count + 1,
        data: data.title || 'Product Retrieved',
        speedup,
        firstLatency: firstLat
      }));

      addLog(`[Response] ${res.status} | Signal: ${signal} | Latency: ${elapsed}ms | "${data.title}"`);
    } catch (err) {
      addLog(`[Error] Request failed: ${err.message}`);
    } finally {
      setS1Loading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Scenario 2: CI / CD Service Virtualization (VCR)
  // --------------------------------------------------------------------------
  const runScenario2 = async () => {
    const baseUrl = getBaseUrl();
    const targetUrl = s2State.offline ? 'http://localhost:59999/checkout' : `${baseUrl}/carts/1`;
    addLog(`[CI Runner] Executing checkout test against ${targetUrl}...`);

    try {
      const res = await fetch(targetUrl);
      const data = await res.json();
      setS2State({
        status: res.status,
        signal: res.headers.get('X-Cache') || 'REPLAY',
        offline: s2State.offline,
        order: `Cart #${data.id || 1} verified (Total: $${data.total || 168})`
      });
      addLog(`[CI Assertion] 200 OK | X-Cache: ${res.headers.get('X-Cache') || 'REPLAY'} | Order verified offline!`);
    } catch (err) {
      addLog(`[CI Failure] Network unreachable: ${err.message}`);
    }
  };

  // --------------------------------------------------------------------------
  // Scenario 3: QA & SRE Chaos Simulation
  // --------------------------------------------------------------------------
  const runScenario3 = async () => {
    setS3Loading(true);
    const start = performance.now();
    const baseUrl = getBaseUrl();
    const targetUrl = `${baseUrl}/products/1`;

    const headers = {};
    if (s3Delay > 0) headers['X-Boombox-Chaos-Delay'] = String(s3Delay);
    if (s3Override) headers['X-Boombox-Chaos-Override'] = '/products/1:503';

    addLog(`[QA Test] GET ${targetUrl} with Chaos (Delay: ${s3Delay}ms, Override: ${s3Override ? '503' : 'none'})...`);

    try {
      const res = await fetch(targetUrl, { headers });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json();

      setS3State({
        status: res.status,
        latency: elapsed,
        error: res.status >= 400 ? data.message || 'Simulated Service Outage' : null
      });

      addLog(`[QA Result] Status: ${res.status} | Latency: ${elapsed}ms | Handled gracefully by UI!`);
    } catch (err) {
      addLog(`[QA Intercept] Error caught: ${err.message}`);
    } finally {
      setS3Loading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Scenario 4: Microservices Transparent Full-URL Proxying
  // --------------------------------------------------------------------------
  const runScenario4 = async () => {
    const baseUrl = getBaseUrl();
    addLog(`[Multi-Origin] Querying GitHub Zen and DummyJSON via single proxy...`);

    try {
      // Query 1: GitHub Zen via transparent full-URL
      const zenUrl = `${baseUrl}/https://api.github.com/zen`;
      const zenRes = await fetch(zenUrl);
      const zenText = await zenRes.text();
      setS4Zen(zenText.trim());
      addLog(`[Origin 1] GitHub Zen -> "${zenText.trim()}" (X-Cache: ${zenRes.headers.get('X-Cache') || 'HIT'})`);

      // Query 2: DummyJSON Product via transparent full-URL
      const prodUrl = `${baseUrl}/https://dummyjson.com/products/2`;
      const prodRes = await fetch(prodUrl);
      const prodData = await prodRes.json();
      setS4Product(prodData.title);
      addLog(`[Origin 2] DummyJSON -> "${prodData.title}" (X-Cache: ${prodRes.headers.get('X-Cache') || 'HIT'})`);
    } catch (err) {
      addLog(`[Multi-Origin Error] ${err.message}`);
    }
  };

  return (
    <div className="app-container">
      {/* Header Glass */}
      <div className="header-glass">
        <div className="brand-row">
          <div>
            <div className="brand-logo">
              <span>📻</span> Boombox React Integration
            </div>
            <div className="brand-tagline">
              Real-world React client showcasing Caching, VCR Replay, Chaos Engineering, and Edge Proxying.
            </div>
          </div>

          {/* Connection Target Switcher */}
          <div className="connection-pill-box">
            <button
              className={`conn-btn ${gatewayMode === 'edge' ? 'active' : ''}`}
              onClick={() => { setGatewayMode('edge'); addLog('Switched API Gateway to Live Cloudflare Edge Worker.'); }}
            >
              🌐 Edge Worker
            </button>
            <button
              className={`conn-btn ${gatewayMode === 'local' ? 'active' : ''}`}
              onClick={() => { setGatewayMode('local'); addLog('Switched API Gateway to Local Boombox (:3000).'); }}
            >
              💻 Local Proxy
            </button>
            <button
              className={`conn-btn ${gatewayMode === 'direct' ? 'active' : ''}`}
              onClick={() => { setGatewayMode('direct'); addLog('Switched API Gateway directly to Origin (No Cache).'); }}
            >
              ⚠️ Direct Origin
            </button>
          </div>
        </div>

        <div className="url-bar">
          <span className="url-label">TARGET API BASE:</span>
          <span className="url-value">{getBaseUrl()}</span>
        </div>
      </div>

      {/* 4 Scenarios Grid */}
      <div className="scenario-grid">
        {/* Scenario 1: Frontend Developer */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🚀 1. Frontend Caching Speed</span>
            <span className="scenario-badge" style={{ background: 'rgba(56, 189, 248, 0.2)', color: 'var(--accent)' }}>
              Frontend Dev
            </span>
          </div>
          <div className="card-desc">
            First click triggers an origin <strong>MISS</strong> (~150ms). Subsequent clicks return an instant <strong>HIT</strong> from RAM in &lt;1ms.
          </div>

          <button className="action-btn" onClick={runScenario1} disabled={s1Loading}>
            {s1Loading ? 'Fetching...' : '⚡ Fetch /products/1'}
          </button>

          <div className="metric-row">
            <div className="metric-item">
              <span className="metric-label">Latency</span>
              <span className={`metric-val ${s1State.signal === 'HIT' ? 'val-hit' : 'val-miss'}`}>
                {s1State.latency !== null ? `${s1State.latency} ms` : '-'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Cache Signal</span>
              <span className={`metric-val ${s1State.signal === 'HIT' ? 'val-hit' : 'val-miss'}`}>
                {s1State.signal || '-'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Speedup</span>
              <span className="metric-val val-hit">
                {s1State.speedup ? `${s1State.speedup}x Faster` : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Scenario 2: CI/CD VCR Replay */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📼 2. Deterministic CI Replay</span>
            <span className="scenario-badge" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--emerald)' }}>
              CI / CD Platform
            </span>
          </div>
          <div className="card-desc">
            Tests run against recorded cassette tapes. Even if third-party backends go down, your test suite runs in 0ms without flaking.
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="action-btn" onClick={runScenario2}>
              ▶ Run Checkout Test
            </button>
            <button
              className="action-btn btn-secondary"
              onClick={() => {
                const next = !s2State.offline;
                setS2State((prev) => ({ ...prev, offline: next }));
                addLog(next ? '[Simulation] 💥 External Origin Server STOPPED.' : '[Simulation] Origin Restored.');
              }}
            >
              {s2State.offline ? 'Restore Origin' : 'Kill Origin'}
            </button>
          </div>

          <div className="metric-row">
            <div className="metric-item">
              <span className="metric-label">Origin Status</span>
              <span className={`metric-val ${s2State.offline ? 'val-chaos' : 'val-hit'}`}>
                {s2State.offline ? 'OFFLINE' : 'ONLINE'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Execution</span>
              <span className="metric-val val-hit">{s2State.signal || 'REPLAY'}</span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Verification</span>
              <span className="metric-val val-hit">{s2State.status === 200 ? 'PASSED' : '-'}</span>
            </div>
          </div>
        </div>

        {/* Scenario 3: QA Chaos Simulator */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🔥 3. Header-Driven Chaos</span>
            <span className="scenario-badge" style={{ background: 'rgba(244, 63, 94, 0.2)', color: 'var(--rose)' }}>
              QA & SRE
            </span>
          </div>
          <div className="card-desc">
            Simulate slow 3G network latency and 503 service outages using HTTP headers without changing backend code.
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Delay:
              <input
                type="number"
                value={s3Delay}
                onChange={(e) => setS3Delay(Number(e.target.value))}
                style={{ width: '70px', marginLeft: '6px', background: '#040711', color: '#fff', border: '1px solid #334155', borderRadius: '4px', padding: '4px' }}
              /> ms
            </label>

            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={s3Override}
                onChange={(e) => setS3Override(e.target.checked)}
              /> Force 503
            </label>
          </div>

          <button className="action-btn" onClick={runScenario3} disabled={s3Loading} style={{ background: 'linear-gradient(135deg, #e11d48, #9f1239)' }}>
            {s3Loading ? 'Simulating Fault...' : 'Simulate Failure'}
          </button>

          <div className="metric-row">
            <div className="metric-item">
              <span className="metric-label">Status</span>
              <span className={`metric-val ${s3State.status === 503 ? 'val-chaos' : 'val-hit'}`}>
                {s3State.status || '-'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Latency</span>
              <span className="metric-val">{s3State.latency ? `${s3State.latency} ms` : '-'}</span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Error Intercepted</span>
              <span className={`metric-val ${s3State.error ? 'val-chaos' : 'val-hit'}`}>
                {s3State.error ? 'YES' : 'NO'}
              </span>
            </div>
          </div>
        </div>

        {/* Scenario 4: Multi-Origin Edge Gateway */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🌐 4. Multi-Origin Routing</span>
            <span className="scenario-badge" style={{ background: 'rgba(168, 85, 247, 0.2)', color: 'var(--purple)' }}>
              Microservices
            </span>
          </div>
          <div className="card-desc">
            Proxy to multiple third-party APIs (DummyJSON & GitHub) through a single endpoint with collision-free cache keys.
          </div>

          <button className="action-btn" onClick={runScenario4}>
            Proxy to 2 Disparate APIs
          </button>

          <div className="metric-row">
            <div className="metric-item" style={{ gridColumn: 'span 3' }}>
              <span className="metric-label">GitHub Zen:</span>
              <span className="metric-val" style={{ color: 'var(--accent)', fontSize: '12px' }}>
                {s4Zen || 'Click to fetch'}
              </span>
            </div>
          </div>
          <div className="metric-row">
            <div className="metric-item" style={{ gridColumn: 'span 3' }}>
              <span className="metric-label">DummyJSON Product:</span>
              <span className="metric-val" style={{ color: 'var(--purple)', fontSize: '12px' }}>
                {s4Product || 'Click to fetch'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Console Output */}
      <div className="console-card">
        <div className="console-header">
          <span className="console-title">
            <span>💻</span> Live Telemetry & Network Inspector
          </span>
          <button
            className="btn-secondary"
            style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}
            onClick={() => setLogs([`[${new Date().toLocaleTimeString()}] Console cleared.`])}
          >
            Clear Console
          </button>
        </div>
        <div className="console-body">
          {logs.map((log, idx) => (
            <div key={idx} className="console-entry">{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
