import React, { useState, useEffect } from 'react';

// [WHY]: Real-world React 19 storefront demonstrating how modern web applications integrate with Boombox.
// [HOW]: Queries Boombox proxy (:3000) which forwards to Store Backend (:4000). Visualizes shimmer loading
//        skeletons during chaos delay, displays live X-Cache HIT/MISS badges, and handles simulated 503 payment failures.
// [INVARIANTS/WHEN]: Survives physical backend termination (:4000) by continuing to render cached products from proxy (:3000).

const PROXY_BASE_URL = 'http://localhost:3000';

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState(null); // null | 'processing' | 'succeeded' | 'failed'
  const [paymentError, setPaymentError] = useState(null);
  const [telemetry, setTelemetry] = useState({
    latencyMs: null,
    cacheSignal: null,
    source: null,
    statusCode: null
  });
  const [networkLogs, setNetworkLogs] = useState([]);

  const addLog = (msg) => {
    setNetworkLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 10)]);
  };

  // 1. Fetch Product Catalogue from Boombox Proxy
  const fetchProducts = async () => {
    setLoading(true);
    setPaymentStatus(null);
    const start = performance.now();
    addLog(`[Client -> Boombox] GET ${PROXY_BASE_URL}/api/products`);

    try {
      const res = await fetch(`${PROXY_BASE_URL}/api/products`);
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json();

      const signal = res.headers.get('X-Cache') || 'DIRECT';
      const statusCode = res.status;

      setTelemetry({
        latencyMs: elapsed,
        cacheSignal: signal,
        source: data.source || (signal === 'HIT' ? 'BOOMBOX_RAM_CACHE' : 'UNKNOWN'),
        statusCode
      });

      if (data.products) {
        setProducts(data.products);
        addLog(`[Response] ${statusCode} OK | X-Cache: ${signal} | Latency: ${elapsed}ms | Loaded ${data.products.length} items`);
      } else if (data.error) {
        addLog(`[Error Response] ${statusCode} | ${data.message || data.error}`);
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      setTelemetry({ latencyMs: elapsed, cacheSignal: 'ERROR', source: 'OFFLINE', statusCode: 502 });
      addLog(`[Network Error] Failed connecting to proxy: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load products on initial render
  useEffect(() => {
    fetchProducts();
  }, []);

  // 2. Add to Cart Handler
  const addToCart = (product) => {
    setCart((prev) => [...prev, product]);
    addLog(`[Cart] Added "${product.name}" ($${product.price})`);
  };

  // 3. Simulate Stripe Checkout Payment
  const handleStripeCheckout = async () => {
    setPaymentStatus('processing');
    setPaymentError(null);
    const start = performance.now();
    const amount = cart.length > 0 ? Math.round(cart.reduce((acc, p) => acc + p.price, 0) * 100) : 18999;

    addLog(`[Client -> Boombox] POST ${PROXY_BASE_URL}/api/checkout/pay (Amount: $${(amount / 100).toFixed(2)})`);

    try {
      const res = await fetch(`${PROXY_BASE_URL}/api/checkout/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, email: 'alex.developer@techcorp.io' })
      });

      const elapsed = Math.round(performance.now() - start);
      const data = await res.json();
      const signal = res.headers.get('X-Cache') || 'BYPASS';

      if (res.status === 200 && data.success) {
        setPaymentStatus('succeeded');
        addLog(`[Stripe Success] PaymentIntent ${data.paymentIntent.id} verified in ${elapsed}ms! (X-Cache: ${signal})`);
      } else {
        setPaymentStatus('failed');
        const errMsg = data.message || `HTTP ${res.status}: Payment Gateway Failure`;
        setPaymentError(errMsg);
        addLog(`[Stripe Error] ${res.status} | ${errMsg}`);
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      setPaymentStatus('failed');
      setPaymentError(`Network Dropped (${elapsed}ms): ${err.message}`);
      addLog(`[Network Drop] Checkout aborted: ${err.message}`);
    }
  };

  const cartTotal = cart.reduce((acc, item) => acc + item.price, 0);

  return (
    <div className="store-wrapper">
      {/* Top Navbar */}
      <header className="store-navbar">
        <div className="nav-container">
          <div className="brand">
            <span className="brand-icon">⚡</span>
            <span className="brand-name">ApexTech Store</span>
            <span className="live-demo-badge">LIVE DEMO</span>
          </div>

          {/* Live Telemetry Pill */}
          <div className="telemetry-pill">
            <div className="telemetry-item">
              <span className="label">PROXY GATEWAY:</span>
              <span className="value">localhost:3000</span>
            </div>
            <div className="divider"></div>
            <div className="telemetry-item">
              <span className="label">LATENCY:</span>
              <span className={`value ${telemetry.latencyMs !== null && telemetry.latencyMs < 5 ? 'text-green' : 'text-amber'}`}>
                {telemetry.latencyMs !== null ? `${telemetry.latencyMs} ms` : '-'}
              </span>
            </div>
            <div className="divider"></div>
            <div className="telemetry-item">
              <span className="label">X-CACHE:</span>
              <span className={`badge ${telemetry.cacheSignal === 'HIT' ? 'badge-hit' : (telemetry.cacheSignal === 'MISS' ? 'badge-miss' : 'badge-bypass')}`}>
                {telemetry.cacheSignal || 'DISCONNECTED'}
              </span>
            </div>
          </div>

          <button className="refresh-btn" onClick={fetchProducts} disabled={loading}>
            {loading ? 'Refreshing...' : '🔄 Refresh Catalogue'}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="store-content">
        {/* Banner Explainer for Video */}
        <section className="video-banner">
          <div className="banner-text">
            <h2>Three-Tier Architecture Demonstration</h2>
            <p>
              This React storefront connects to <strong>Boombox Proxy (:3000)</strong> which forwards to the <strong>Store Backend (:4000)</strong>.
              Kill Terminal 1 (Backend) to prove offline resilience, or restart Boombox with <code>--latency 2500</code> or <code>--override /api/checkout/pay:503</code> to watch live chaos handling!
            </p>
          </div>
        </section>

        {/* Product Catalogue & Cart Layout */}
        <div className="store-layout">
          {/* Products Grid */}
          <section className="products-section">
            <div className="section-header">
              <h3>Featured Gear ({products.length} items)</h3>
              <span className="source-tag">Source: {telemetry.source || 'Pending'}</span>
            </div>

            {loading ? (
              <div className="products-grid">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="product-skeleton">
                    <div className="skeleton-img shimmer"></div>
                    <div className="skeleton-title shimmer"></div>
                    <div className="skeleton-price shimmer"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="products-grid">
                {products.map((p) => (
                  <div key={p.id} className="product-card">
                    <img src={p.image} alt={p.name} className="product-image" />
                    <div className="product-info">
                      <span className="product-category">{p.category}</span>
                      <h4 className="product-name">{p.name}</h4>
                      <p className="product-desc">{p.description}</p>
                      <div className="product-footer">
                        <span className="product-price">${p.price.toFixed(2)}</span>
                        <button className="add-cart-btn" onClick={() => addToCart(p)}>
                          Add to Cart
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Cart & Stripe Payment Drawer */}
          <aside className="cart-sidebar">
            <div className="cart-box">
              <h3>Stripe Checkout Cart</h3>
              {cart.length === 0 ? (
                <p className="empty-cart">Your cart is empty. Click "Add to Cart" on any item above.</p>
              ) : (
                <div className="cart-list">
                  {cart.map((item, idx) => (
                    <div key={idx} className="cart-item">
                      <span className="item-name">{item.name}</span>
                      <span className="item-price">${item.price.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="cart-total-row">
                    <span>Total Due:</span>
                    <span className="total-amount">${cartTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Payment Status Banners */}
              {paymentStatus === 'succeeded' && (
                <div className="alert-box alert-success">
                  <span className="alert-icon">✅</span>
                  <div>
                    <strong>Stripe Payment Succeeded!</strong>
                    <div className="alert-sub">Order processed through Boombox Proxy.</div>
                  </div>
                </div>
              )}

              {paymentStatus === 'failed' && (
                <div className="alert-box alert-danger">
                  <span className="alert-icon">🚨</span>
                  <div>
                    <strong>Payment Gateway Failure!</strong>
                    <div className="alert-sub">{paymentError}</div>
                  </div>
                </div>
              )}

              <button
                className={`checkout-btn ${paymentStatus === 'processing' ? 'btn-loading' : ''}`}
                onClick={handleStripeCheckout}
                disabled={paymentStatus === 'processing'}
              >
                {paymentStatus === 'processing' ? 'Communicating with Stripe...' : `Pay with Stripe ($${(cartTotal || 189.99).toFixed(2)})`}
              </button>

              <button className="clear-cart-btn" onClick={() => { setCart([]); setPaymentStatus(null); }}>
                Clear Cart
              </button>
            </div>

            {/* Live Terminal Telemetry Stream */}
            <div className="mini-console">
              <div className="console-title">Live Proxy Telemetry Stream</div>
              <div className="console-lines">
                {networkLogs.length === 0 ? (
                  <div className="console-placeholder">Waiting for requests...</div>
                ) : (
                  networkLogs.map((log, i) => <div key={i} className="console-row">{log}</div>)
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
