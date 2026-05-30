import type { Request, Response, NextFunction } from 'express';
import { getCatalogForLocation } from '../services/square/catalog.service';
import { getLocations } from '../services/square/locations.service';
import { getInventoryForLocation } from '../services/square/inventory.service';
import { AppError } from '../middleware/errorHandler';
import { successResponse } from '../utils/response';
import type { ApiCatalogResponse, ApiInventoryState } from '../types/api.types';

export async function getCatalog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { locationId } = req.params;

    if (!locationId || typeof locationId !== 'string') {
      throw new AppError(400, 'INVALID_PARAMS', 'locationId is required');
    }

    // Validate the locationId exists — prevents SSRF-style probing of
    // arbitrary Square location IDs not belonging to this merchant
    const locations = await getLocations();
    const location = locations.find(l => l.id === locationId);
    if (!location) {
      throw new AppError(404, 'LOCATION_NOT_FOUND', `Location ${locationId} not found`);
    }

    const catalog = await getCatalogForLocation(locationId, location.timezone);

    // Enrich with inventory data — non-blocking, best effort
    const variationIds = catalog.items.flatMap(i => i.variations.map(v => v.id));
    const inventory = await getInventoryForLocation(locationId, variationIds).catch(
      (): ApiInventoryState => ({}),
    );

    const enrichedItems = catalog.items.map(item => ({
      ...item,
      variations: item.variations.map(v => ({
        ...v,
        inStock: inventory[v.id]?.inStock ?? true, // assume in stock if inventory unknown
        quantity: inventory[v.id]?.quantity,
      })),
    }));

    const data: ApiCatalogResponse & { inventory: ApiInventoryState } = {
      ...catalog,
      items: enrichedItems,
      inventory,
    };

    res.json(successResponse(data));
  } catch (err) {
    next(err);
  }
}
