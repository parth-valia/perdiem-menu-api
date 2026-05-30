# perdiem-menu-api

Node.js + Express + TypeScript backend for the Per Diem menu browser take-home.

Proxies Square's Catalog, Locations, and Inventory APIs so the React Native client never touches a Square access token. Resolves time/day availability server-side using the location's IANA timezone and bundles a simple `availableNow: boolean` plus a human-readable reason into every catalog response.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Set SQUARE_ACCESS_TOKEN to your sandbox token (never use a production token here)

# 3. Seed Square sandbox with locations, categories, items, and availability periods
node seed-sandbox.js

# 4. Start dev server (hot-reload via ts-node-dev)
npm run dev
```

Server starts on **`http://localhost:3001`**.

```bash
# Smoke test
curl http://localhost:3001/api/v1/health
# {"status":"ok","timestamp":"..."}
```

---

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/v1/health` | Load-balancer health check |
| GET | `/api/v1/locations` | All ACTIVE Square locations with address and IANA timezone |
| GET | `/api/v1/catalog/:locationId` | Location-filtered items with availability and inventory bundled |

**Inventory** is part of `/catalog/:locationId`, not a separate endpoint. Each variation is enriched with `inStock` and `quantity` from Square's Inventory API. If the inventory call fails the menu still loads — variations default to `inStock: true` so a guest is never blocked by an upstream failure.

### Response shape — `/api/v1/catalog/:locationId`

```json
{
  "success": true,
  "data": {
    "locationId": "L123",
    "computedAt": "2025-05-30T14:32:00.000Z",
    "categories": [
      { "id": "C1", "name": "Burgers", "availableNow": true }
    ],
    "items": [
      {
        "id": "I1",
        "name": "BBQ Smokehouse Burger",
        "description": "...",
        "categoryId": "C1",
        "imageUrl": "https://...",
        "availableNow": false,
        "availabilityReason": "Available Mon-Fri 11am-3pm",
        "variations": [
          {
            "id": "V1",
            "name": "Regular",
            "price": { "amount": 1299, "currency": "USD", "formatted": "$12.99" },
            "inStock": true,
            "quantity": 12
          }
        ],
        "modifierLists": [
          {
            "id": "M1",
            "name": "Add-ons",
            "selectionType": "MULTIPLE",
            "modifiers": []
          }
        ]
      }
    ],
    "inventory": { "V1": { "quantity": 12, "inStock": true } }
  }
}
```

---

## Square sandbox setup

1. Create a free account at [developer.squareup.com](https://developer.squareup.com)
2. Create a new application, open the **Sandbox** tab, and copy the **Sandbox Access Token**
3. Set `SQUARE_ACCESS_TOKEN=<token>` in your `.env` file
4. Run the included seed script:

```bash
node seed-sandbox.js
```

The script creates the following sandbox data:

| What | Detail |
| ---- | ------ |
| 2 locations | Default Test Account and Downtown Kitchen |
| 6 categories | Burgers (always) · Drinks (always) · Lunch Sides (Mon–Fri 11am–3pm) · Happy Hour Desserts (daily 4–7pm) · Breakfast (Mon–Fri 7–11am) · Weekend Brunch (Sat–Sun 9am–3pm) |
| 16 items | Real Unsplash photos; items with modifier lists; 2 items exclusive to Downtown Kitchen via `presentAtLocationIds` |

**Availability is easy to see during testing:** Breakfast items are greyed out outside 7–11am; Weekend Brunch items are always greyed on weekdays — so the unavailability UI is visible without waiting for a specific time window.

This data exercises every evaluated feature: location filtering, time/day availability, location-specific items, modifiers, and inventory.

---

## Architecture decisions

### 1. All three Square location-availability fields

Square's three-field model is checked in priority order:

```typescript
// src/services/square/catalog.service.ts
function isItemAvailableAtLocation(item, locationId) {
  if (item.absentAtLocationIds?.includes(locationId)) return false; // blacklist wins
  if (item.presentAtAllLocations) return true;                       // default: everywhere
  return item.presentAtLocationIds?.includes(locationId) ?? false;  // whitelist otherwise
}
```

Items are filtered server-side before the response is built. The client never receives items it cannot order at the selected location.

### 2. Time/day availability — server-side, timezone-aware

Square's `CatalogAvailabilityPeriod` objects store `dayOfWeek`, `startLocalTime`, and `endLocalTime` in the **location's local timezone**. Computing availability on the backend means:

- Zero timezone library weight on the mobile client
- One testable place for all the logic
- The client receives a simple `availableNow: boolean` and a human-readable `availabilityReason` string (e.g. "Available Mon–Fri 11am–3pm")

```typescript
// src/services/availability.service.ts
function getCurrentLocalMoment(timezone: string): LocalMoment {
  // Intl.DateTimeFormat is a built-in — no moment.js, no date-fns, zero bundle cost
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, ... });
}
```

**Trade-off:** Availability is time-sensitive so responses cannot be cached indefinitely. Cache TTL is 5 minutes. A production system would push real-time invalidation via Square webhooks on `catalog.updated` events.

### 3. Location ID validation as SSRF guard

An unauthenticated caller could pass any string as `:locationId` and use the API to probe arbitrary Square merchants with our token. We prevent this by validating the ID against the merchant's own locations before forwarding to Square:

```typescript
// src/controllers/catalog.controller.ts
const location = locations.find(l => l.id === locationId);
if (!location) throw new AppError(404, 'LOCATION_NOT_FOUND', ...);
```

If the ID is not in our own locations list the request is rejected before any Square API call is made.

### 4. In-memory TTL cache — no database required

Square is the source of truth; we don't own the data. A simple in-memory cache handles Square's rate limits without adding Redis as a dependency. Different TTLs are applied based on data volatility:

| Data | TTL | Reason |
| ---- | --- | ------ |
| Locations | 5 min | Changes rarely |
| Catalog + availability | 5 min | Time-sensitive; short window is acceptable |
| Inventory | 2 min | More volatile — stock levels change faster |

The cache key includes `locationId` so each location's catalog is cached independently.

### 5. Square SDK pagination resolved server-side

Square's Catalog API is cursor-paginated. All pages are resolved in a `while` loop before the response is returned, so the client always receives a complete catalog in a single API call:

```typescript
while (true) {
  objects.push(...page.data);
  if (!page.hasNextPage()) break;
  page = await page.getNextPage();
}
```

**Trade-off:** Correct for sandbox and SMB catalogs (< ~500 items). For large catalogs we would expose a `?cursor=` parameter and let the client paginate. Documented in "What I'd build next."

### 6. Error handling strategy

Every error passes through one central middleware:

- Known `AppError` → correct HTTP status + stable error code + message
- Square 429 → `429 RATE_LIMITED` with a friendly message
- Unexpected → `500 INTERNAL_ERROR`; full stack trace logged server-side only, never sent to the client

---

## Security checklist

| Control | Where |
| ------- | ----- |
| Square token never leaves the server | `src/config/square.ts` — loaded from env var only |
| `.env` excluded from version control | `.gitignore` line 3 |
| Location ID validated before Square call | `src/controllers/catalog.controller.ts` lines 19–23 |
| CORS restricted to known origins | `src/app.ts` lines 17–34 via `ALLOWED_ORIGINS` env var |
| Rate limiting — 100 req/min per IP | `src/app.ts` lines 37–48 |
| Stack traces never sent to clients | `src/middleware/errorHandler.ts` lines 33–55 |
| Security headers via Helmet | `src/app.ts` line 12 |

---

## What I'd build next (given another week)

1. **Square webhook integration** — invalidate cache on `catalog.updated` events so availability changes are instant rather than TTL-lagged
2. **Cursor-based catalog pagination** — expose `?cursor=` for merchants with large catalogs
3. **Redis cache** — replace in-memory cache so multiple API instances share state in a horizontally scaled deployment
4. **Request ID tracing** — attach a correlation ID to every log line for distributed tracing
5. **Property-based tests for the availability service** — the timezone and day-of-week logic is the riskiest piece and deserves fuzz testing across DST transitions, midnight windows, and multi-day spans
