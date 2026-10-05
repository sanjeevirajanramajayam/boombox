
const PORT = 4000;

const PRODUCTS = [
  {
    id: 'prod_keyboard_01',
    name: 'CyberBlade Pro Mechanical Keyboard',
    description: 'Hot-swappable tactile switches with per-key RGB backlighting and CNC aluminum chassis.',
    price: 189.99,
    category: 'Hardware',
    stock: 14,
    image: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80'
  },
  {
    id: 'prod_headset_02',
    name: 'AcousticWave Wireless Studio Monitors',
    description: 'Planar magnetic drivers with 40-hour battery life and ultra-low latency wireless dongle.',
    price: 299.00,
    category: 'Audio',
    stock: 8,
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'
  },
  {
    id: 'prod_monitor_03',
    name: 'UltraVision 4K 144Hz Gaming Display',
    description: '32-inch IPS panel with 99% DCI-P3 color accuracy and hardware calibration support.',
    price: 649.50,
    category: 'Displays',
    stock: 5,
    image: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=600&q=80'
  },
  {
    id: 'prod_watch_04',
    name: 'Chronos Smart Titanium Edition',
    description: 'Sapphire glass with heart-rate sensor, GPS tracking, and titanium link band.',
    price: 349.00,
    category: 'Wearables',
    stock: 19,
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80'
  }
];

let requestCounter = 0;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    requestCounter++;
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // CORS Headers for direct testing
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Boombox-Chaos-Delay, X-Boombox-Chaos-Override, Authorization'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health Check Endpoint
    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'healthy',
        service: 'E-Commerce Store Backend Origin',
        port: PORT,
        uptimeSeconds: Math.round(process.uptime()),
        requestsHandled: requestCounter
      }, { headers: corsHeaders });
    }

    // 1. GET /api/products: Returns product list with RFC 9111 Cache-Control
    if (url.pathname === '/api/products' && method === 'GET') {
      // Simulate typical 120ms database / business logic latency
      await new Promise(resolve => setTimeout(resolve, 120));

      return Response.json({
        success: true,
        source: 'LIVE_DATABASE_ORIGIN',
        products: PRODUCTS,
        generatedAt: new Date().toISOString()
      }, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
          'ETag': '"products-v1-hash-99a"',
          'X-Origin-Server': 'StoreBackend-Port-4000'
        }
      });
    }

    // 2. POST /api/checkout/pay: Simulates Stripe Payment Intent creation & confirmation
    if (url.pathname === '/api/checkout/pay' && method === 'POST') {
      let body = {};
      try {
        body = await req.json();
      } catch {}

      // Simulate 180ms Stripe Gateway processing latency
      await new Promise(resolve => setTimeout(resolve, 180));

      const paymentIntentId = `pi_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;

      return Response.json({
        success: true,
        paymentIntent: {
          id: paymentIntentId,
          amount: body.amount || 18999,
          currency: 'usd',
          status: 'succeeded',
          clientSecret: `${paymentIntentId}_secret_test`,
          paymentMethod: 'pm_card_visa',
          customerEmail: body.email || 'customer@example.com'
        },
        receiptUrl: `https://dashboard.stripe.com/test/payments/${paymentIntentId}`,
        processedAt: new Date().toISOString()
      }, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store', // Mutating payment transactions must never be cached per RFC 9111
          'X-Origin-Server': 'StoreBackend-Port-4000'
        }
      });
    }

    // 404 Route Not Found
    return Response.json({
      error: 'ROUTE_NOT_FOUND',
      path: url.pathname,
      message: `Endpoint ${url.pathname} does not exist on origin backend.`
    }, { status: 404, headers: corsHeaders });
  }
});

console.log(`\x1b[32m[BACKEND ORIGIN]\x1b[0m Store API listening on \x1b[1mhttp://localhost:${PORT}\x1b[0m`);
console.log(`  -> Health check:  http://localhost:${PORT}/api/health`);
console.log(`  -> Product list:  http://localhost:${PORT}/api/products (120ms baseline lag, max-age=60)`);
console.log(`  -> Stripe pay:    http://localhost:${PORT}/api/checkout/pay (POST)`);
console.log(`\x1b[33mPress Ctrl+C at any time during your video to physically kill this backend.\x1b[0m\n`);
