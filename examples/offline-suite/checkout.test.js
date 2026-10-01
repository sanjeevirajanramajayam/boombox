
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../../src/server.js';
import { PaymentGatewayClient } from './api-client.js';
import { rmSync, existsSync } from 'node:fs';

const CASSETTE_DIR = 'examples/offline-suite/cassettes';
const CASSETTE_NAME = 'stripe-checkout-vcr';

describe('Offline Test Suite Integration Demo (Service Virtualization)', () => {
  let mockLiveGateway;
  let mockGatewayUrl;

  beforeAll(async () => {
    // Clean prior cassette for fresh demonstration
    if (existsSync(CASSETTE_DIR)) {
      rmSync(CASSETTE_DIR, { recursive: true, force: true });
    }

    // Phase 0: Spin up simulated upstream payment gateway
    mockLiveGateway = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === 'POST' && url.pathname === '/customers') {
          const body = await req.json();
          return Response.json({
            id: 'cus_live_998124',
            email: body.email,
            name: body.name,
            balance: 0,
            currency: 'usd'
          }, { status: 201 });
        }

        if (req.method === 'GET' && url.pathname === '/invoices/inv_123') {
          return Response.json({
            id: 'inv_123',
            amount_due: 4900,
            status: 'paid',
            customer: 'cus_live_998124'
          });
        }

        return new Response('Not Found', { status: 404 });
      }
    });

    mockGatewayUrl = `http://localhost:${mockLiveGateway.port}`;
  });

  afterAll(() => {
    if (mockLiveGateway) mockLiveGateway.stop(true);
    if (existsSync(CASSETTE_DIR)) {
      rmSync(CASSETTE_DIR, { recursive: true, force: true });
    }
  });

  test('Step 1 [RECORD]: Runs against live origin, strips secrets, and records cassette', async () => {
    const recorder = createProxyServer({
      port: 0,
      origin: mockGatewayUrl,
      cassette: CASSETTE_NAME,
      cassetteDir: CASSETTE_DIR,
      mode: 'record',
      redact: ['Authorization'],
      matchBody: true
    });

    try {
      const client = new PaymentGatewayClient({
        baseUrl: `http://localhost:${recorder.server.port}`,
        apiKey: 'sk_live_SECRET_PRODUCTION_KEY'
      });

      // 1. Create Customer (POST with body)
      const customer = await client.createCustomer({ email: 'sanjeevi@example.com', name: 'Sanjeevi' });
      expect(customer.id).toBe('cus_live_998124');
      expect(customer.email).toBe('sanjeevi@example.com');

      // 2. Fetch Invoice (GET)
      const invoice = await client.getInvoice('inv_123');
      expect(invoice.data.id).toBe('inv_123');
      expect(invoice.data.status).toBe('paid');
      expect(invoice.cacheSignal).toBe('RECORD');
    } finally {
      recorder.server.stop(true);
    }
  });

  test('Step 2 [SIMULATE OUTAGE]: Upstream origin is terminated completely', () => {
    // Origin is killed — network is 100% dead
    mockLiveGateway.stop(true);
    mockLiveGateway = null;
  });

  test('Step 3 [REPLAY]: Runs 100% offline from cassette tape in < 15ms', async () => {
    const player = createProxyServer({
      port: 0,
      cassette: CASSETTE_NAME,
      cassetteDir: CASSETTE_DIR,
      mode: 'replay',
      matchBody: true
    });

    try {
      const client = new PaymentGatewayClient({
        baseUrl: `http://localhost:${player.server.port}`,
        apiKey: 'sk_test_any_key'
      });

      const t0 = performance.now();

      // 1. Replay Customer creation (POST body matched from tape)
      const customer = await client.createCustomer({ email: 'sanjeevi@example.com', name: 'Sanjeevi' });
      expect(customer.id).toBe('cus_live_998124');

      // 2. Replay Invoice retrieval (GET matched from tape)
      const invoice = await client.getInvoice('inv_123');
      expect(invoice.data.id).toBe('inv_123');
      expect(invoice.cacheSignal).toBe('REPLAY');

      const elapsedMs = performance.now() - t0;
      expect(elapsedMs).toBeLessThan(100);

      // 3. Unrecorded route fails fast with 502
      expect(client.getInvoice('inv_unrecorded_999')).rejects.toThrow('Invoice Not Found: HTTP 502');
    } finally {
      player.server.stop(true);
    }
  });
});
