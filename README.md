# Meme Coin Aggregator

A backend service I built to aggregate real-time meme coin data from multiple DEX sources. Think of it like what axiom.trade does - fetching token data, merging duplicates, and pushing live updates to connected clients.

## Live Demo

**Live URL:** https://meme-coin-aggregator-ru0a.onrender.com

**Demo Video:** [YouTube Link] _(coming soon)_

**GitHub:** https://github.com/sachiny0106/Eterna-Labs

## What it does

- Pulls token data from 3 different APIs (DexScreener, Jupiter, GeckoTerminal)
- Merges duplicate tokens intelligently (same token can appear on multiple DEXs)
- Pushes real-time updates via WebSocket
- Caches everything to avoid hammering the APIs
- Handles rate limits properly with backoff

## Getting Started

```bash
npm install
npm run dev      # starts dev server with hot reload
npm test         # runs the test suite
```

That's it. Server starts at http://localhost:3000

For production:
```bash
npm run build
npm start
```

## API Reference

### Token Endpoints

| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/tokens` | Get paginated list of tokens |
| GET | `/api/tokens/search?q=pepe` | Search tokens by name |
| GET | `/api/tokens/:address` | Get specific token by address |
| POST | `/api/tokens/batch` | Get multiple tokens at once |
| GET | `/api/tokens/trending/list` | Top tokens by volume |
| GET | `/api/tokens/gainers/list` | Biggest gainers |
| GET | `/api/tokens/losers/list` | Biggest losers |

### Query Parameters

You can filter and sort the results:

```
GET /api/tokens?time_period=24h&sort_by=volume&sort_dir=desc&limit=20
```

- `time_period`: 1h, 24h, or 7d
- `sort_by`: volume, price_change, market_cap, liquidity
- `sort_dir`: asc or desc
- `limit`: how many results (max 100)
- `cursor`: for pagination (base64 encoded)

### Health Check

```
GET /api/health        # basic health status
GET /api/health/stats  # detailed stats with cache info
```

## WebSocket

Connect using Socket.io and you'll get real-time updates:

```javascript
const socket = io('https://meme-coin-aggregator-ru0a.onrender.com');

socket.on('price_update', (data) => {
  // fires when a token price changes more than 1%
});

socket.on('volume_spike', (data) => {
  // fires when volume jumps more than 50%
});

socket.on('batch_update', (data) => {
  // periodic update with all tokens (every 10s)
});
```

---

## Design Decisions

I want to explain why I made certain choices, because there's usually a reason behind each one.

### Why these 3 APIs?

I needed multiple sources to get comprehensive data:

- **DexScreener** - This is the main one. Has the best Solana DEX coverage and generous rate limits (300 req/min). Most of the token data comes from here.
- **Jupiter** - Official Solana aggregator. Good for discovering trending tokens that might not show up elsewhere.
- **GeckoTerminal** - Backup source. Also good for finding newly created pools.

The idea is if one API is down or missing data, the others fill in the gaps.

### Why token bucket for rate limiting?

I considered a few approaches:
1. Simple counter that resets every minute - too rigid, can't handle bursts
2. Sliding window - more complex, overkill for this
3. Token bucket - just right

Token bucket lets you burst when needed (like initial data load) but still respects the limits over time. When we hit rate limits, exponential backoff kicks in so we're not hammering a struggling API.

### Why cursor pagination instead of offset?

This was an important one. With offset pagination (`?page=2`), if tokens get added between requests, you might see duplicates or miss items. That's bad for real-time data.

Cursor pagination uses a marker (base64 encoded index) that stays consistent. Even if new tokens appear, your position in the list doesn't shift.

### Why both Redis and memory cache?

Depends on the deployment:
- **Memory cache** for local dev or single instance - simple, no external deps
- **Redis** for production with multiple instances - they all share the same cache

The 30 second TTL is a balance between freshness (meme coins move fast) and not killing the APIs with requests.

### Why Socket.io instead of raw WebSockets?

Could have used the native `ws` library, but Socket.io handles a lot of edge cases:
- Auto-reconnection when connection drops
- Falls back to polling if WebSocket fails
- Room support for subscriptions
- Better cross-browser compatibility

For a production app, these things matter.

### How the data flows

Here's what happens when the server starts:

```
1. Startup
   → Fetch from all 3 APIs in parallel
   → Merge tokens by address (prefer non-zero values)
   → Cache everything

2. Every 10 seconds
   → Push batch update to all WebSocket clients
   
3. Every 60 seconds  
   → Full refresh from all APIs
   → Detect price changes (>1%) and volume spikes (>50%)
   → Broadcast events to relevant clients

4. On API request
   → Check cache first
   → If miss, fetch from APIs
   → Apply filters/sorting
   → Return paginated response
```

---

## Project Structure

```
src/
├── api/           # REST routes (tokens, health)
├── config/        # env validation with zod
├── services/      # the meat - aggregator, cache, DEX clients
├── websocket/     # socket.io server
├── scheduler/     # cron jobs for periodic refresh
├── types/         # typescript types
└── utils/         # logger, rate limiter

tests/
├── unit/          # cache, rate limiter, DEX client tests
└── integration/   # API and WebSocket tests
```

## Environment Variables

```env
PORT=3000
NODE_ENV=development
USE_MEMORY_CACHE=true
CACHE_TTL=30
REDIS_URL=redis://localhost:6379   # only if USE_MEMORY_CACHE=false
```

## Running Tests

```bash
npm test                    # run all 52 tests
npm test -- --coverage      # with coverage report
npm test -- --watch         # watch mode for development
```

The tests cover:
- Cache operations (TTL, hit/miss, cleanup)
- Rate limiter (token bucket, exponential backoff)  
- All API endpoints (happy path + error cases)
- WebSocket events
- DEX client data transformations

## Deployment

I deployed on Render (free tier). Here's how:

1. Push to GitHub
2. Create new Web Service on Render
3. Connect your repo
4. Build command: `npm install && npm run build`
5. Start command: `npm start`
6. Add env vars: `NODE_ENV=production`, `USE_MEMORY_CACHE=true`

Note: Free tier spins down after 15 min of no traffic. First request after idle takes ~30 seconds.

### Docker option

```bash
docker-compose up    # starts app + redis
```

---

## What I'd improve with more time

- Add Redis cache in production (currently using memory to stay on free tier)
- Add historical price tracking
- WebSocket subscriptions to specific tokens only
- Better error recovery when all APIs fail
- Rate limit per client IP
- Swagger/OpenAPI docs

## License

MIT - do whatever you want with it
