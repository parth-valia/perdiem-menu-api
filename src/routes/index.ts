import { Router } from 'express';
import { listLocations } from '../controllers/locations.controller';
import { getCatalog } from '../controllers/catalog.controller';

const router = Router();

router.get('/locations', listLocations);
router.get('/catalog/:locationId', getCatalog);

// Health check — used by load balancers and uptime monitors
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
