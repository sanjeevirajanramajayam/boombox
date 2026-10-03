
// Normalizes URL by lexicographically sorting query parameters to prevent false misses
export function normalizeUrl(rawUrl) {
  const parsed = new URL(rawUrl, 'http://localhost');                       // Parse URL with dummy origin for relative paths
  parsed.searchParams.sort();                                               // Sort query parameters alphabetically (a=1&b=2)
  return parsed.pathname + (parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : ''); // Reconstruct normalized string
}

// Normalizes JSON request bodies by sorting object keys to guarantee deterministic hashing
export function normalizeBody(body) {
  if (!body) return '';                                                     // Return empty string for nullish payloads
  if (typeof body === 'string') {                                           // Handle stringified payloads
    try {
      const obj = JSON.parse(body);                                         // Attempt JSON parse to handle unordered JSON keys
      return JSON.stringify(obj, Object.keys(obj).sort());                  // Reserialize with deterministically sorted keys
    } catch {
      return body.trim();                                                   // Fallback to trimmed raw string if not valid JSON
    }
  }
  return String(body);                                                      // Convert non-string payloads to string
}
