import { locationsApi } from '../../config/square';
import { cache } from '../../cache/memoryCache';
import type { ApiLocation } from '../../types/api.types';
import type { SquareLocation } from '../../types/square.types';

const CACHE_KEY = 'locations:all';

function formatAddress(location: SquareLocation): string {
  const a = location.address;
  if (!a) return '';
  return [a.addressLine1, a.locality, a.administrativeDistrictLevel1, a.postalCode]
    .filter(Boolean)
    .join(', ');
}

function toApiLocation(loc: SquareLocation): ApiLocation {
  return {
    id: loc.id,
    name: loc.name,
    address: formatAddress(loc),
    // Square returns timezone as an IANA string (e.g. "America/New_York").
    // We need this on the client to display local hours and on the server
    // to evaluate availability windows. Default to UTC if missing.
    timezone: loc.timezone ?? 'UTC',
    status: loc.status ?? 'ACTIVE',
    coordinates:
      loc.coordinates?.latitude !== undefined && loc.coordinates?.longitude !== undefined
        ? {
            latitude: loc.coordinates.latitude,
            longitude: loc.coordinates.longitude,
          }
        : undefined,
  };
}

export async function getLocations(): Promise<ApiLocation[]> {
  const cached = cache.get<ApiLocation[]>(CACHE_KEY);
  if (cached) return cached;

  // Square SDK v44: HttpResponsePromise extends Promise<T>, so await resolves to T directly
  const response = await locationsApi.list();

  if (response.errors?.length) {
    const firstError = response.errors[0];
    throw new Error(`Square Locations API error: ${String(firstError.detail ?? firstError.code)}`);
  }

  const locations = (response.locations ?? []) as SquareLocation[];

  // Only surface ACTIVE locations — archived or inactive locations shouldn't
  // appear in the guest-facing location switcher
  const active = locations
    .filter(l => l.status === 'ACTIVE' || l.status === undefined)
    .map(toApiLocation);

  cache.set(CACHE_KEY, active);
  return active;
}
