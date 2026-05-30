// Simple in-memory TTL cache.
// We intentionally avoid Redis/Memcached — the assignment scope doesn't warrant
// distributed caching and in-process cache is zero-latency.
// Trade-off: cache is lost on restart and not shared across multiple instances.
// For a real deployment, swap this for Redis with the same interface.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlSeconds: number = 300) {
    this.defaultTtlMs = defaultTtlSeconds * 1000;

    // Sweep expired entries every minute to prevent memory growth.
    // Using unref() so this timer doesn't keep the process alive during tests.
    const sweep = setInterval(() => this.sweep(), 60_000);
    if (sweep.unref) sweep.unref();
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlSeconds?: number): void {
    const ttlMs = ttlSeconds !== undefined ? ttlSeconds * 1000 : this.defaultTtlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePattern(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

const ttlSeconds = parseInt(process.env.CACHE_TTL_SECONDS ?? '300', 10);
export const cache = new MemoryCache(ttlSeconds);
