# Boombox 📻

A lightweight CLI caching proxy, VCR record/replay engine, and network chaos simulator. Forwards requests to an origin server, caches responses, and attaches `X-Cache: HIT` or `X-Cache: MISS` headers.

## Installation

```bash
npm install
npm link
```

## Usage

### 1. Start Proxy Server

```bash
boombox --port <number> --origin <url>
```

Example:

```bash
boombox --port 3000 --origin http://dummyjson.com
```

### 2. Test Cached Endpoints

- First request (cache miss):
  ```bash
  curl -i http://localhost:3000/products
  # Header: X-Cache: MISS
  ```

- Second request (cache hit):
  ```bash
  curl -i http://localhost:3000/products
  # Header: X-Cache: HIT
  ```

### 3. Clear Cache

```bash
boombox --clear-cache
```

## Running Tests

```bash
npm test
```
