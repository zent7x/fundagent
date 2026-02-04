/**
 * Redis Client Configuration
 *
 * Provides a Redis client for distributed rate limiting and caching.
 * Gracefully degrades to null if Redis is unavailable.
 *
 * Environment Variables:
 * - REDIS_URL: Redis connection URL (e.g., redis://localhost:6379)
 * - REDIS_TLS: Set to 'true' for TLS connections (e.g., Upstash, AWS ElastiCache)
 */

import Redis from 'ioredis';

let redisClient: Redis | null = null;
let connectionAttempted = false;

/**
 * Get Redis client instance
 * Returns null if Redis is not configured or connection fails
 */
export function getRedisClient(): Redis | null {
  if (connectionAttempted) {
    return redisClient;
  }

  connectionAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('[Redis] No REDIS_URL configured, using in-memory fallback');
    return null;
  }

  try {
    const options: any = {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    };

    // Enable TLS for cloud Redis providers
    if (process.env.REDIS_TLS === 'true') {
      options.tls = {};
    }

    redisClient = new Redis(redisUrl, options);

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
      // Don't crash on connection errors - degrade gracefully
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    // Test connection
    redisClient.ping().catch((err) => {
      console.error('[Redis] Ping failed:', err.message);
      redisClient = null;
    });

    return redisClient;
  } catch (error) {
    console.error('[Redis] Failed to initialize:', error);
    return null;
  }
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    connectionAttempted = false;
  }
}
