
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { OriginTransport } from '../src/transport.js';

describe('Deep Module Seam: OriginTransport', () => {
  let mockServer;
  let originUrl;

  beforeAll(() => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/echo-headers') {
          const received = {};
          for (const [k, v] of req.headers.entries()) {
            received[k] = v;
          }
          return Response.json({
            receivedHost: req.headers.get('host'),
            hasTransferEncoding: req.headers.has('transfer-encoding'),
            all: received
          });
        }

        if (url.pathname === '/binary-image') {
          const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          return new Response(fakePngBuffer, {
            headers: { 'Content-Type': 'image/png' }
          });
        }

        return new Response('OK', { status: 200 });
      }
    });

    originUrl = `http://localhost:${mockServer.port}`;
  });

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  test('Strips hop-by-hop headers and rewrites Host header to origin', async () => {
    const transport = new OriginTransport({ origin: originUrl });
    const res = await transport.forward({
      method: 'GET',
      path: '/echo-headers',
      headers: {
        'Host': 'client-custom-domain.com',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive',
        'X-Client-Header': 'verified'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.buffer.toString('utf8'));
    expect(body.receivedHost).toBe(`localhost:${mockServer.port}`);
    expect(body.hasTransferEncoding).toBe(false);
    expect(body.all['x-client-header']).toBe('verified');
  });

  test('Detects binary MIME type and serializes to Base64', async () => {
    const transport = new OriginTransport({ origin: originUrl });
    const res = await transport.forward({
      method: 'GET',
      path: '/binary-image'
    });

    expect(res.statusCode).toBe(200);
    expect(res.isBase64).toBe(true);
    expect(res.buffer).toBeInstanceOf(Buffer);
    expect(Buffer.from(res.serializedBody, 'base64')).toEqual(res.buffer);
  });

  test('Throws structured 502 Bad Gateway when origin is unreachable', async () => {
    const deadTransport = new OriginTransport({ origin: 'http://localhost:59999' });

    try {
      await deadTransport.forward({ method: 'GET', path: '/test' });
      expect.unreachable('Should have thrown gateway error');
    } catch (err) {
      expect(err.statusCode).toBe(502);
      expect(err.message).toContain('502 Bad Gateway');
      expect(err.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
