
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export function filterHeaders(headers) {
  const filtered = {};
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);
  for (const [key, value] of entries) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function isBinaryContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.startsWith('image/') ||
         ct.startsWith('audio/') ||
         ct.startsWith('video/') ||
         ct.includes('octet-stream') ||
         ct.includes('pdf') ||
         ct.includes('zip') ||
         ct.includes('gzip');
}

export class OriginTransport {
  constructor({ origin = null, redirect = 'follow', timeoutMs = 30000 } = {}) {
    this.origin = origin ? origin.replace(/\/+$/, '') : null;
    this.redirect = redirect;
    this.timeoutMs = timeoutMs;
  }

  async forward({ method, path, headers = {}, bodyText = null }) {
    if (!this.origin) {
      throw new Error('Cannot forward: OriginTransport has no upstream origin configured.');
    }

    const startTime = performance.now();
    const forwardHeaders = new Headers();
    const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);

    for (const [key, value] of entries) {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'host') {
        forwardHeaders.set(key, value);
      }
    }

    forwardHeaders.set('host', new URL(this.origin).host);

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: forwardHeaders,
      redirect: this.redirect
    };

    if (bodyText) {
      fetchOptions.body = bodyText;
    }

    try {
      const originResponse = await fetch(`${this.origin}${path}`, fetchOptions);
      const originStatus = originResponse.status;

      const outHeaders = {};
      for (const [k, v] of originResponse.headers.entries()) {
        const lower = k.toLowerCase();
        if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'content-encoding') {
          outHeaders[k] = v;
        }
      }

      const originArrayBuffer = await originResponse.arrayBuffer();
      const originBuffer = Buffer.from(originArrayBuffer);
      const contentType = outHeaders['content-type'] || outHeaders['Content-Type'] || '';
      const isBinary = isBinaryContentType(contentType);
      const serializedBody = isBinary ? originBuffer.toString('base64') : originBuffer.toString('utf8');
      const durationMs = performance.now() - startTime;

      return {
        statusCode: originStatus,
        headers: outHeaders,
        buffer: originBuffer,
        isBase64: isBinary,
        serializedBody,
        durationMs
      };
    } catch (err) {
      const durationMs = performance.now() - startTime;
      const error = new Error(`502 Bad Gateway: Failed connecting to origin ${this.origin} - ${err.message}`);
      error.statusCode = 502;
      error.durationMs = durationMs;
      throw error;
    }
  }
}
