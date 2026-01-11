# Meme Coin Aggregator

Backend service that pulls meme coin data from multiple DEX APIs and serves it via REST + WebSocket.

**Live:** https://meme-coin-aggregator-ru0a.onrender.com

**Demo Video:** https://youtu.be/5TErqLI6fFY

## Quick Start

```bash
npm install
npm run dev
```

Server runs at http://localhost:3000

## API

### Get tokens
```
GET /api/tokens
GET /api/tokens?time_period=24h&sort_by=volume&limit=20
GET /api/tokens/:address
GET /api/tokens/search?q=pepe
```

### Other endpoints
```
GET /api/tokens/trending
GET /api/tokens/gainers
GET /api/tokens/losers
POST /api/tokens/batch   (body: { addresses: [...] })
GET /api/health
GET /api/health/stats
```

### Query params
- `time_period` - 1h, 24h, 7d
- `sort_by` - volume, price_change, market_cap, liquidity  
- `sort_dir` - asc, desc
- `limit` - max 100
- `cursor` - for pagination

## WebSocket

```javascript
const socket = io('http://localhost:3000');

socket.on('price_update', data => console.log(data));
socket.on('volume_spike', data => console.log(data));
socket.on('batch_update', data => console.log(data));
```

## Data Sources

- DexScreener - main source, good rate limits
- Jupiter - Solana aggregator  
- GeckoTerminal - backup source

## How it works

1. On startup, fetches from all 3 APIs in parallel
2. Merges tokens by address (same token can be on multiple DEXs)
3. Caches for 30 seconds
4. Every 10s pushes updates to websocket clients
5. Every 60s does a full refresh

## Project Structure

```
src/
  api/        - express routes
  services/   - aggregator, cache, dex clients
  websocket/  - socket.io server
  scheduler/  - periodic refresh jobs
  utils/      - logger, rate limiter
  config/     - env validation
  types/      - typescript types
```

## Environment

```
PORT=3000
NODE_ENV=development
USE_MEMORY_CACHE=true
CACHE_TTL=30
```

## Tests

```bash
npm test
```

52 tests covering cache, rate limiter, API endpoints, websocket.

## Deploy

Using Render:
1. Connect GitHub repo
2. Build: `npm install && npm run build`
3. Start: `npm start`

Or Docker:
```bash
docker-compose up
```

## Tech Stack

- Node.js + TypeScript
- Express + Socket.io
- Redis (optional, memory cache by default)
- Zod for config validation

## Design notes

**Why cursor pagination?** - offset pagination breaks when new tokens get added between requests

**Why token bucket rate limiting?** - allows bursts but respects limits over time, with exponential backoff on errors

**Why multiple APIs?** - redundancy, if one is down others fill the gap

---

MIT License
