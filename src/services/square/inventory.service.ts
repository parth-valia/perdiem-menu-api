import { inventoryApi } from '../../config/square';
import { cache } from '../../cache/memoryCache';
import type { ApiInventoryState } from '../../types/api.types';
import type { SquareInventoryCount } from '../../types/square.types';

// Inventory counts are more volatile than catalog data — cache for 2 minutes
// so frequent menu views don't hammer the API but counts stay reasonably fresh.
const INVENTORY_CACHE_TTL = 120;

export async function getInventoryForLocation(
  locationId: string,
  variationIds: string[],
): Promise<ApiInventoryState> {
  if (!variationIds.length) return {};

  const cacheKey = `inventory:${locationId}`;
  const cached = cache.get<ApiInventoryState>(cacheKey);
  if (cached) return cached;

  // Square SDK v44: batchGetCounts() returns a Page<InventoryCount> — collect all pages
  // Inventory errors are non-fatal — caller wraps in .catch() so menu still loads
  const page = await inventoryApi.batchGetCounts({
    catalogObjectIds: variationIds,
    locationIds: [locationId],
  });

  const allCounts: SquareInventoryCount[] = [];
  let currentPage = page;
  while (true) {
    allCounts.push(...(currentPage.data as SquareInventoryCount[]));
    if (!currentPage.hasNextPage()) break;
    currentPage = await currentPage.getNextPage();
  }

  const counts = allCounts;
  const state: ApiInventoryState = {};

  for (const count of counts) {
    if (!count.catalogObjectId) continue;
    // Only NONE and IN_STOCK states are meaningful for display.
    // WASTE, UNBOXING etc. are internal — don't surface to guests.
    if (count.state !== 'IN_STOCK' && count.state !== 'NONE') continue;

    const quantity = parseFloat(count.quantity ?? '0');
    state[count.catalogObjectId] = {
      quantity,
      inStock: count.state === 'IN_STOCK' && quantity > 0,
    };
  }

  cache.set(cacheKey, state, INVENTORY_CACHE_TTL);
  return state;
}
