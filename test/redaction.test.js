
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_CASSETTES_DIR = '.test-redact-cassettes';

describe('Issue #1: Secret & Credential Redaction in Cassettes', () => {
  let mockOriginServer;
  let originUrl;

  beforeAll(() => {
    if (existsSync(TEST_CASSETTES_DIR)) {
      rmSync(TEST_CASSETTES_DIR, { recursive: true, force: true });
    }

    mockOriginServer = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(JSON.stringify({ status: 'authenticated' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk_live_secret_1234567890',
            'Set-Cookie': 'session=secret_session_token_abc',
            'X-Custom-Secret': 'super_sensitive_key'
          }
        });
      }
    });

    originUrl = `http://localhost:${mockOriginServer.port}`;
  });

  afterAll(() => {
    if (mockOriginServer) mockOriginServer.stop(true);
    if (existsSync(TEST_CASSETTES_DIR)) {
      rmSync(TEST_CASSETTES_DIR, { recursive: true, force: true });
    }
  });

  test('Redacts default sensitive headers (Authorization, Set-Cookie) and custom specified headers', async () => {
    const proxy = createProxyServer({
      port: 0,
      origin: originUrl,
      cassette: 'auth-tape',
      cassetteDir: TEST_CASSETTES_DIR,
      mode: 'record',
      redact: ['x-custom-secret']
    });

    try {
      const res = await fetch(`http://localhost:${proxy.server.port}/auth/user`);
      expect(res.status).toBe(200);

      // Verify cassette on disk contains [REDACTED]
      const tapePath = join(TEST_CASSETTES_DIR, 'auth-tape.json');
      expect(existsSync(tapePath)).toBe(true);

      const tapeContent = JSON.parse(readFileSync(tapePath, 'utf8'));
      const recorded = tapeContent[0];

      expect(recorded.headers['authorization']).toBe('[REDACTED]');
      expect(recorded.headers['set-cookie']).toBe('[REDACTED]');
      expect(recorded.headers['x-custom-secret']).toBe('[REDACTED]');
      // Non-sensitive header preserved
      expect(recorded.headers['content-type']).toBe('application/json');
    } finally {
      proxy.server.stop(true);
    }
  });
});
