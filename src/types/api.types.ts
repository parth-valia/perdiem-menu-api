// Our API contract types — what the mobile client actually receives.
// Kept separate from Square types so we can reshape Square's responses
// without changing the client contract.

export interface ApiLocation {
  id: string;
  name: string;
  address: string;
  timezone: string;
  status: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface ApiMoney {
  amount: number; // Always in cents (smallest currency unit)
  currency: string;
  formatted: string; // Pre-formatted: "$12.99"
}

export interface ApiModifier {
  id: string;
  name: string;
  price?: ApiMoney;
}

export interface ApiModifierList {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  modifiers: ApiModifier[];
}

export interface ApiItemVariation {
  id: string;
  name: string;
  price: ApiMoney;
}

export interface ApiCatalogItem {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  imageUrl?: string;
  variations: ApiItemVariation[];
  modifierLists: ApiModifierList[];
  // Availability state resolved server-side so client logic stays simple
  availableNow: boolean;
  availabilityReason?: string; // "Available weekdays 11am–3pm" for greyed-out items
}

export interface ApiCategory {
  id: string;
  name: string;
  imageUrl?: string;
  availableNow: boolean;
}

export interface ApiCatalogResponse {
  categories: ApiCategory[];
  items: ApiCatalogItem[];
  locationId: string;
  computedAt: string; // ISO timestamp — lets client know when availability was checked
}

export interface ApiInventoryState {
  [variationId: string]: {
    quantity: number;
    inStock: boolean;
  };
}

// Standard envelope for all API responses
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
