import { SquareClient, SquareEnvironment } from 'square';

type CatalogClient = InstanceType<typeof SquareClient>['catalog'];
type LocationsClient = InstanceType<typeof SquareClient>['locations'];
type InventoryClient = InstanceType<typeof SquareClient>['inventory'];

// Validate required env vars at startup — fail fast rather than get confusing
// "unauthorized" errors at request time
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env and fill in your Square sandbox credentials.`,
    );
  }
  return value;
}

function buildSquareClient(): SquareClient {
  const accessToken = getRequiredEnv('SQUARE_ACCESS_TOKEN');
  const env = process.env.SQUARE_ENVIRONMENT ?? 'sandbox';

  // The environment enum enforces sandbox/production isolation at the SDK level.
  // Never use a production token in sandbox and vice versa.
  const environment =
    env === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox;

  return new SquareClient({
    token: accessToken,
    environment,
  });
}

// Singleton — one client instance for the process lifetime
export const squareClient = buildSquareClient();

export const catalogApi: CatalogClient = squareClient.catalog;
export const locationsApi: LocationsClient = squareClient.locations;
export const inventoryApi: InventoryClient = squareClient.inventory;
