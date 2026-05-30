# perdiem-menu-api

Node.js + Express + TypeScript backend for the Per Diem menu browser take-home. Proxies Square's Catalog and Locations APIs so the mobile client never touches a Square access token.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Fill in your Square sandbox access token

# 3. Run dev server (hot-reload)
npm run dev
```

Server starts on `http://localhost:3001`.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/locations` | All active Square locations (ACTIVE status only) |
| GET | `/api/v1/catalog/:locationId` | Menu items filtered to a location, with time/day availability and inventory counts bundled in one response |

> **Inventory** is resolved as part of `/catalog/:locationId` (not a separate endpoint). The catalog call enriches each variation with `inStock` and `quantity` from Square's Inventory API. If the inventory call fails, it degrades gracefully — the menu still loads and items default to in-stock.

---

## Square sandbox setup

1. Create a free account at [developer.squareup.com](https://developer.squareup.com)
2. Create a new application → grab the **Sandbox Access Token**
3. Set `SQUARE_ACCESS_TOKEN` in your `.env`
4. Seed catalog data using the included script (recommended):

```bash
node seed-sandbox.js
```

This creates **2 locations** (Default Test Account + Downtown Kitchen), **4 categories** (Burgers and Drinks are always available; Lunch Sides are Mon–Fri 11am–3pm only; Happy Hour Desserts are daily 4–7pm), **12 items** with real images and modifiers, and **2 items exclusive to Downtown Kitchen** (`presentAtLocationIds`). All features — location filtering, time/day availability, and location-specific items — are exercised.

Alternatively, seed manually via the Square Sandbox dashboard:
   - **2 locations** (Sandbox provides test locations automatically)
   - **3–4 categories**, at least one with `availabilityPeriodIds` set for limited hours
   - **6–10 items**, at least one with `presentAtLocationIds` limited to one location

---

## Architecture decisions

### In-memory cache, not a database

Square is the source of truth. We don't own the data — we read and display it. A 5-minute TTL cache handles Square's rate limits without the complexity (and sync headache) of a persistent store. TTL is configurable via `CACHE_TTL_SECONDS`.

### Availability computed server-side

Square's `CatalogAvailabilityPeriod` objects contain `dayOfWeek`, `startLocalTime`, and `endLocalTime` in the **location's local timezone**. We evaluate these on the backend using the `Intl.DateTimeFormat` API with the location's IANA timezone string. This keeps timezone logic in one testable place and sends a simple `availableNow: boolean` + human-readable `availabilityReason` to the client.

Trade-off: responses are time-sensitive (can't be cached forever), so we key the cache by `locationId` and set a short TTL. A production system might use a shorter TTL (60s) or push invalidations via Square webhooks.

### Square pagination resolved server-side

Square's Catalog API paginates with cursors. We resolve all pages in a single service call before responding. For sandbox/SMB catalogs (< 500 items) this is fine. For large catalogs we'd expose a cursor-based endpoint — documented in "What I'd build next."

### Location ID validation as SSRF guard

The `/catalog/:locationId` endpoint validates the provided ID against the known locations list before forwarding to Square. This prevents an attacker from probing arbitrary Square merchant IDs using our access token.

---

## What I'd build next (given another week)

1. **Square webhook integration** — invalidate cache on `catalog.updated` events so availability changes reflect instantly
2. **Cursor-based catalog pagination** — expose `?cursor=` param for large menus
3. **Redis cache** — share cache across multiple API instances in a horizontally scaled deployment
4. **Request ID tracing** — attach a correlation ID to every request for distributed tracing
5. **Unit tests for availability service** — the time/day logic is the most complex piece and deserves property-based tests across timezones
