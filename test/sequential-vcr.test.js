
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxyServer } from '../src/server.js';
import { rmSync, existsSync } from 'node:fs';

const CASSETTE_DIR = '.test-seq-cassettes';
const CASSETTE_NAME = 'polling-job-tape';

describe('Issue #10: Stateful Sequential Cassette Playback for Polling Endpoints', () => {
  let mockServer;
  let originUrl;
  let pollCount = 0;

  beforeAll(() => {
    if (existsSync(CASSETTE_DIR)) {
      rmSync(CASSETTE_DIR, { recursive: true, force: true });
    }

    mockServer = Bun.serve({
      port: 0,
      async fetch() {
        pollCount++;
        if (pollCount === 1) {
          return Response.json({ status: 'pending', progress: 10 });
        } else if (pollCount === 2) {
          return Response.json({ status: 'processing', progress: 50 });
        } else {
          return Response.json({ status: 'completed', progress: 100 });
        }
      }
    });

    originUrl = `http://localhost:${mockServer.port}`;
  });

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
    if (existsSync(CASSETTE_DIR)) {
      rmSync(CASSETTE_DIR, { recursive: true, force: true });
    }
  });

  test('Records sequence of polling responses and replays state transitions deterministically', async () => {
    // Phase 1: RECORD mode - send 3 sequential requests to /jobs/42
    const recorder = createProxyServer({
      port: 0,
      origin: originUrl,
      cassette: CASSETTE_NAME,
      cassetteDir: CASSETTE_DIR,
      mode: 'record'
    });

    try {
      const recUrl = `http://localhost:${recorder.server.port}`;

      // Call 1 -> pending
      const r1 = await fetch(`${recUrl}/jobs/42`);
      const b1 = await r1.json();
      expect(b1.status).toBe('pending');

      // Call 2 -> processing
      const r2 = await fetch(`${recUrl}/jobs/42`);
      const b2 = await r2.json();
      expect(b2.status).toBe('processing');

      // Call 3 -> completed
      const r3 = await fetch(`${recUrl}/jobs/42`);
      const b3 = await r3.json();
      expect(b3.status).toBe('completed');
    } finally {
      recorder.server.stop(true);
    }

    // Phase 2: Kill upstream mock server completely
    mockServer.stop(true);
    mockServer = null;

    // Phase 3: REPLAY mode - 100% offline playback
    const replayer = createProxyServer({
      port: 0,
      cassette: CASSETTE_NAME,
      cassetteDir: CASSETTE_DIR,
      mode: 'replay'
    });

    try {
      const repUrl = `http://localhost:${replayer.server.port}`;

      // Replay 1 -> must return pending!
      const rep1 = await fetch(`${repUrl}/jobs/42`);
      expect(rep1.status).toBe(200);
      expect(rep1.headers.get('x-cache')).toBe('REPLAY');
      const repBody1 = await rep1.json();
      expect(repBody1.status).toBe('pending');
      expect(repBody1.progress).toBe(10);

      // Replay 2 -> must advance to processing!
      const rep2 = await fetch(`${repUrl}/jobs/42`);
      expect(rep2.status).toBe(200);
      expect(rep2.headers.get('x-cache')).toBe('REPLAY');
      const repBody2 = await rep2.json();
      expect(repBody2.status).toBe('processing');
      expect(repBody2.progress).toBe(50);

      // Replay 3 -> must advance to completed!
      const rep3 = await fetch(`${repUrl}/jobs/42`);
      expect(rep3.status).toBe(200);
      expect(rep3.headers.get('x-cache')).toBe('REPLAY');
      const repBody3 = await rep3.json();
      expect(repBody3.status).toBe('completed');
      expect(repBody3.progress).toBe(100);

      // Replay 4 -> exceeds sequence; repeats terminal completed state!
      const rep4 = await fetch(`${repUrl}/jobs/42`);
      expect(rep4.status).toBe(200);
      const repBody4 = await rep4.json();
      expect(repBody4.status).toBe('completed');
    } finally {
      replayer.server.stop(true);
    }
  });
});
