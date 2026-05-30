import type { Request, Response, NextFunction } from 'express';
import { getLocations } from '../services/square/locations.service';
import { successResponse } from '../utils/response';

export async function listLocations(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const locations = await getLocations();
    res.json(successResponse(locations));
  } catch (err) {
    next(err);
  }
}
