// Strict types wrapping Square SDK shapes.
// We re-declare only what we use so we're not coupled to SDK internals —
// if Square renames a field we catch it at the boundary, not deep in business logic.

export interface SquareMoney {
  amount: bigint | number;
  currency: string;
}

export interface SquareLocation {
  id: string;
  name: string;
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    locality?: string;
    administrativeDistrictLevel1?: string;
    postalCode?: string;
    country?: string;
  };
  timezone?: string;
  status?: string;
  coordinates?: {
    latitude?: number;
    longitude?: number;
  };
}

export interface SquareCatalogImage {
  id: string;
  type: string;
  url?: string;
  caption?: string;
  imageData?: {
    url?: string;
    caption?: string;
  };
}

export interface SquareCatalogItemVariation {
  id: string;
  itemVariationData?: {
    itemId?: string;
    name?: string;
    pricingType?: string;
    priceMoney?: SquareMoney;
    ordinal?: number;
    availableForBooking?: boolean;
    sellable?: boolean;
    stockable?: boolean;
  };
}

export interface SquareCatalogModifierList {
  id: string;
  modifierListData?: {
    name?: string;
    selectionType?: string;
    modifiers?: SquareCatalogModifier[];
  };
}

export interface SquareCatalogModifier {
  id: string;
  modifierData?: {
    name?: string;
    priceMoney?: SquareMoney;
    ordinal?: number;
  };
}

export interface SquareCatalogItem {
  id: string;
  type: string;
  presentAtAllLocations?: boolean;
  presentAtLocationIds?: string[];
  absentAtLocationIds?: string[];
  itemData?: {
    name?: string;
    description?: string;
    categoryId?: string;                          // deprecated — use categories[]
    categories?: Array<{ id: string; ordinal?: number }>;
    imageIds?: string[];
    variations?: SquareCatalogItemVariation[];
    modifierListInfo?: Array<{
      modifierListId?: string;
      enabled?: boolean;
    }>;
    availabilityPeriodIds?: string[];
    skipModifierScreen?: boolean;
  };
}

export interface SquareCatalogCategory {
  id: string;
  type: string;
  categoryData?: {
    name?: string;
    imageIds?: string[];
    availabilityPeriodIds?: string[];
  };
}

export interface SquareCatalogAvailabilityPeriodObject {
  id: string;
  type: string;
  availabilityPeriodData?: {
    eventType?: string;
    startLocalTime?: string;
    endLocalTime?: string;
    dayOfWeek?: string;
  };
}

export interface SquareInventoryCount {
  catalogObjectId?: string;
  locationId?: string;
  quantity?: string;
  state?: string;
}
