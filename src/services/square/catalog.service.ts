import { catalogApi } from '../../config/square';
import { cache } from '../../cache/memoryCache';
import { evaluateAvailability } from '../availability.service';
import { formatMoney } from '../../utils/money';
import type {
  SquareCatalogItem,
  SquareCatalogCategory,
  SquareCatalogAvailabilityPeriodObject,
  SquareCatalogModifierList,
  SquareCatalogImage,
} from '../../types/square.types';
import type {
  ApiCatalogResponse,
  ApiCatalogItem,
  ApiCategory,
  ApiModifierList,
  ApiItemVariation,
} from '../../types/api.types';

// All Square catalog objects share an `id` and `type` field.
// We use a base interface for the type discriminator in partitionCatalog.
interface CatalogObjectBase {
  id: string;
  type: string;
}

type CatalogObjectType = CatalogObjectBase &
  (
    | SquareCatalogItem
    | SquareCatalogCategory
    | SquareCatalogAvailabilityPeriodObject
    | SquareCatalogModifierList
    | SquareCatalogImage
  );

interface RawCatalog {
  items: SquareCatalogItem[];
  categories: SquareCatalogCategory[];
  periods: SquareCatalogAvailabilityPeriodObject[];
  modifierLists: SquareCatalogModifierList[];
  images: SquareCatalogImage[];
}

// Square SDK v44: catalog.list() returns a Page<CatalogObject> with async pagination.
// We collect all pages here so the client gets the full catalog in one API response.
// For sandbox/SMB catalogs this is fine. For large catalogs (1000+ items) we'd expose
// cursor-based pagination to the client — documented in README.
async function fetchAllCatalogObjects(): Promise<CatalogObjectType[]> {
  const objects: CatalogObjectType[] = [];

  let page = await catalogApi.list({
    // Fetch all types we need in one pass to minimize round trips
    types: 'ITEM,CATEGORY,AVAILABILITY_PERIOD,MODIFIER_LIST,IMAGE',
  });

  while (true) {
    objects.push(...(page.data as CatalogObjectType[]));
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }

  return objects;
}

function partitionCatalog(objects: CatalogObjectType[]): RawCatalog {
  const raw: RawCatalog = {
    items: [],
    categories: [],
    periods: [],
    modifierLists: [],
    images: [],
  };

  for (const obj of objects) {
    switch (obj.type) {
      case 'ITEM':
        raw.items.push(obj as SquareCatalogItem);
        break;
      case 'CATEGORY':
        raw.categories.push(obj as SquareCatalogCategory);
        break;
      case 'AVAILABILITY_PERIOD':
        raw.periods.push(obj as SquareCatalogAvailabilityPeriodObject);
        break;
      case 'MODIFIER_LIST':
        raw.modifierLists.push(obj as SquareCatalogModifierList);
        break;
      case 'IMAGE':
        raw.images.push(obj as SquareCatalogImage);
        break;
    }
  }

  return raw;
}

function isItemAvailableAtLocation(item: SquareCatalogItem, locationId: string): boolean {
  // Square's three-field availability model:
  // 1. presentAtAllLocations=true  → available everywhere unless explicitly absent
  // 2. presentAtLocationIds        → whitelist (only these locations)
  // 3. absentAtLocationIds         → blacklist (never these, even if in whitelist)
  if (item.absentAtLocationIds?.includes(locationId)) return false;
  if (item.presentAtAllLocations) return true;
  return item.presentAtLocationIds?.includes(locationId) ?? false;
}

function buildModifierList(
  modifierListId: string,
  modifierLists: SquareCatalogModifierList[],
): ApiModifierList | null {
  const ml = modifierLists.find(m => m.id === modifierListId);
  if (!ml?.modifierListData) return null;

  return {
    id: ml.id,
    name: ml.modifierListData.name ?? 'Extras',
    selectionType: ml.modifierListData.selectionType === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE',
    modifiers: (ml.modifierListData.modifiers ?? []).map(mod => ({
      id: mod.id,
      name: mod.modifierData?.name ?? '',
      price: mod.modifierData?.priceMoney ? formatMoney(mod.modifierData.priceMoney) : undefined,
    })),
  };
}

function resolveImageUrl(
  imageIds: string[] | undefined,
  images: SquareCatalogImage[],
): string | undefined {
  if (!imageIds?.length) return undefined;
  const img = images.find(i => i.id === imageIds[0]);
  return img?.imageData?.url ?? img?.url;
}

export async function getCatalogForLocation(
  locationId: string,
  timezone: string,
): Promise<ApiCatalogResponse> {
  const cacheKey = `catalog:${locationId}`;
  const cached = cache.get<ApiCatalogResponse>(cacheKey);
  if (cached) return cached;

  const allObjects = await fetchAllCatalogObjects();
  const raw = partitionCatalog(allObjects);

  // Build category map with availability info
  const categoryMap = new Map<string, ApiCategory>();
  for (const cat of raw.categories) {
    const periodIds = cat.categoryData?.availabilityPeriodIds ?? [];
    const { availableNow } = evaluateAvailability(periodIds, raw.periods, timezone);
    categoryMap.set(cat.id, {
      id: cat.id,
      name: cat.categoryData?.name ?? 'Uncategorized',
      imageUrl: resolveImageUrl(cat.categoryData?.imageIds, raw.images),
      availableNow,
    });
  }

  const items: ApiCatalogItem[] = [];

  for (const item of raw.items) {
    if (!isItemAvailableAtLocation(item, locationId)) continue;

    const data = item.itemData;
    if (!data) continue;

    // Resolve availability periods: prefer item-level periods, fall back to
    // the item's primary category periods. This is the standard Square pattern
    // — merchants set periods on the category and all items in it inherit them.
    // Without the fallback, items with no own periods always evaluate as available
    // even when their category has a restricted window.
    const itemPeriodIds = data.availabilityPeriodIds ?? [];
    const primaryCatId = data.categories?.[0]?.id ?? data.categoryId ?? '';
    const catPeriodIds = primaryCatId
      ? (raw.categories.find(c => c.id === primaryCatId)?.categoryData?.availabilityPeriodIds ?? [])
      : [];
    const periodIds = itemPeriodIds.length > 0 ? itemPeriodIds : catPeriodIds;
    const { availableNow, reason } = evaluateAvailability(periodIds, raw.periods, timezone);

    const variations: ApiItemVariation[] = (data.variations ?? []).map(v => ({
      id: v.id,
      name: v.itemVariationData?.name ?? 'Regular',
      price: formatMoney(v.itemVariationData?.priceMoney ?? { amount: 0, currency: 'USD' }),
    }));

    const modifierLists: ApiModifierList[] = (data.modifierListInfo ?? [])
      .filter(m => m.enabled !== false && m.modifierListId)
      .map(m => buildModifierList(m.modifierListId!, raw.modifierLists))
      .filter((ml): ml is ApiModifierList => ml !== null);

    items.push({
      id: item.id,
      name: data.name ?? 'Unnamed Item',
      description: data.description ?? '',
      categoryId: data.categories?.[0]?.id ?? data.categoryId ?? '',
      imageUrl: resolveImageUrl(data.imageIds, raw.images),
      variations,
      modifierLists,
      availableNow,
      availabilityReason: availableNow ? undefined : reason,
    });
  }

  const result: ApiCatalogResponse = {
    categories: Array.from(categoryMap.values()),
    items,
    locationId,
    computedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result);
  return result;
}
