
export function createStorageMatch({
  statusCode,
  headers,
  body,
  isBase64 = false,
  cachedAt = new Date().toISOString(),
  etag = null,
  lastModified = null,
  signal = 'HIT',
  isOfflineMiss = false,
  errorMessage = null,
  maxAge = null,
  staleWhileRevalidate = null
}) {
  return {
    statusCode,
    headers,
    body,
    isBase64: Boolean(isBase64),
    cachedAt,
    etag,
    lastModified,
    signal,
    isOfflineMiss: Boolean(isOfflineMiss),
    errorMessage,
    maxAge,
    staleWhileRevalidate
  };
}
