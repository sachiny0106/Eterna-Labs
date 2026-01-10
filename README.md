# Meme Coin Aggregator

Real-time meme coin data aggregation service that fetches, merges, and serves token data from multiple DEX sources.

## Live Demo

**URL**: `https://your-app.onrender.com` _(update after deployment)_

**Video Demo**: [YouTube Link] _(add your video link)_

## Features

- Aggregates data from DexScreener, Jupiter, and GeckoTerminal APIs
- WebSocket support for real-time price updates
- Caching with Redis (or in-memory fallback)
- Rate limiting with exponential backoff
- Cursor-based pagination
- Time period filtering (1h, 24h, 7d)

## Quick Start

```bash
# install deps
npm install

# run in dev mode
npm run dev

# run tests
npm test

# build for production
npm run build
npm start
```

Server runs at http://localhost:3000

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| GET /api/tokens | List tokens with filters |
| GET /api/tokens/search?q=pepe | Search by name/ticker |
| GET /api/tokens/:address | Get single token |
| POST /api/tokens/batch | Get multiple tokens |
| GET /api/tokens/trending/list | Top tokens by volume |
| GET /api/tokens/gainers/list | Top gainers |
| GET /api/tokens/losers/list | Top losers |
| GET /api/health | Health check |
| GET /api/health/stats | Detailed stats |

### Query Parameters

| Param | Values | Description |
|-------|--------|-------------|
| time_period | 1h, 24h, 7d | Metrics time window |
| sort_by | volume, price_change, market_cap, liquidity | Sort field |
| sort_dir | asc, desc | Sort direction |
| limit | 1-100 | Page size |
| cursor | base64 string | Pagination cursor |
| search | string | Filter by name/ticker |

### Example Request

```bash
curl "http://localhost:3000/api/tokens?time_period=24h&sort_by=volume&sort_dir=desc&limit=20"
```

### Example Response

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "token_address": "...",
        "token_name": "PEPE",
        "token_ticker": "PEPE",
        "price_usd": 0.00001234,
        "price_24hr_change": 15.5,
        "volume_24hr": 1500000,
        "market_cap_usd": 5000000,
        "liquidity_usd": 200000
      }
    ],
    "pagination": {
      "limit": 20,
      "next_cursor": "MjA=",
      "total_count": 196,
      "has_more": true
    }
  }
}
```

## WebSocket

Connect to `ws://localhost:3000` with Socket.io client.

### Events

| Event | Description |
|-------|-------------|
| price_update | Price changed > 1% |
| volume_spike | Volume increased > 50% |
| new_token | New token discovered |
| batch_update | Periodic batch of tokens |

### Example

```javascript
const socket = io('http://localhost:3000');

socket.on('price_update', (msg) => {
  console.log('Price update:', msg.data);
});

socket.on('batch_update', (msg) => {
  console.log('Batch:', msg.data.tokens.length, 'tokens');
});
```

## Design Decisions

### Why these APIs?

- **DexScreener**: Most comprehensive Solana DEX data, good rate limits (300/min)
- **Jupiter**: Official Solana aggregator, good for trending tokens
- **GeckoTerminal**: Backup source + new pool discovery

### Why token bucket rate limiting?

Simple but effective. Refills over time so we can burst when needed but stay within limits. Exponential backoff on failures prevents hammering APIs when they're struggling.

### Why cursor pagination?

Offset pagination breaks when data changes between requests. With real-time token data, using cursors (base64 encoded index) keeps pagination consistent even when new tokens get added.

### Why in-memory + Redis cache?

Redis for production (multiple instances share cache), memory for local dev (simpler). 30s TTL balances freshness vs API load. Individual token caching for fast lookups.

### Why Socket.io?

Auto-reconnection, fallback to polling, room support for subscriptions. Could use native ws but Socket.io handles edge cases.

### Data Flow

```
1. Startup: Fetch from all 3 APIs, merge by token address
2. Every 10s: Push batch update to WebSocket clients
3. Every 60s: Full refresh from APIs
4. On access: Check cache, return cached or trigger fetch
```

## Project Structure

```
src/
├── api/           # express routes
├── config/        # env config with zod validation
├── services/      # business logic (aggregator, cache, dex clients)
├── websocket/     # socket.io server
├── scheduler/     # cron jobs
├── types/         # typescript interfaces
└── utils/         # logging, rate limiter
```

## Environment Variables

```env
PORT=3000
NODE_ENV=development
REDIS_URL=redis://localhost:6379
USE_MEMORY_CACHE=true
CACHE_TTL=30
PRICE_UPDATE_INTERVAL=10
FULL_REFRESH_INTERVAL=60
```

## Testing

```bash
# run all tests
npm test

# with coverage
npm test -- --coverage
```

Tests cover:
- Cache operations (set, get, delete, TTL)
- Rate limiter (token bucket, backoff)
- API routes (all endpoints)
- DEX client transformations

## Deployment

### Render (recommended)

1. Push to GitHub
2. Connect repo to Render
3. Set build command: `npm install && npm run build`
4. Set start command: `npm start`
5. Add env vars (USE_MEMORY_CACHE=true)

### Docker

```bash
docker build -t meme-coin-aggregator .
docker run -p 3000:3000 meme-coin-aggregator
```

## License

MIT
