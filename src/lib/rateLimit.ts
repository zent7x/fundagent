/**
 * Rate Limiting Module
 *
 * Implements IP + user-based rate limiting with:
 * - Redis store for distributed systems (with in-memory fallback)
 * - Configurable limits per endpoint type
 * - Graceful 429 responses with retry-after headers
 * - Integrated threat protection for DDoS/bot detection
 *
 * OWASP: Protects against brute force, DoS, and API abuse
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkThreat, recordViolation, generateFingerprint } from './threatProtection';
import { getRedisClient } from './redis';

interface RateLimitEntry {
  count: number;
  resetTime: number;
  violations: number; // Track consecutive violations
}

// In-memory fallback store (used when Redis is unavailable)
// SECURITY: Limited size to prevent memory exhaustion attacks
const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_RATE_LIMIT_ENTRIES = 100000; // Maximum entries to prevent DoS

/**
 * SECURITY: Evict oldest entries when map exceeds max size
 * Uses LRU-like eviction based on resetTime
 */
function evictOldestEntries(): void {
  if (rateLimitStore.size <= MAX_RATE_LIMIT_ENTRIES) return;

  const now = Date.now();
  const entriesToRemove: string[] = [];

  // First pass: remove expired entries
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      entriesToRemove.push(key);
    }
  }

  for (const key of entriesToRemove) {
    rateLimitStore.delete(key);
  }

  // If still over limit, remove oldest by resetTime
  if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
    const entries = Array.from(rateLimitStore.entries())
      .sort((a, b) => a[1].resetTime - b[1].resetTime);

    const toRemove = entries.slice(0, rateLimitStore.size - MAX_RATE_LIMIT_ENTRIES + 1000);
    for (const [key] of toRemove) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup old entries every 5 minutes (only for in-memory fallback)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
    // Also check size limit
    evictOldestEntries();
  }, 5 * 60 * 1000);
}

export interface RateLimitConfig {
  // Maximum requests allowed in the window
  maxRequests: number;
  // Time window in seconds
  windowSeconds: number;
  // Identifier type: 'ip', 'user', or 'combined'
  identifier: 'ip' | 'user' | 'combined';
  // Enable threat protection check
  enableThreatProtection?: boolean;
}

// Predefined rate limit configurations
export const RATE_LIMITS = {
  // Public endpoints - more lenient
  public: {
    maxRequests: 100,
    windowSeconds: 60,
    identifier: 'ip' as const,
    enableThreatProtection: true,
  },
  // Authenticated endpoints
  authenticated: {
    maxRequests: 60,
    windowSeconds: 60,
    identifier: 'combined' as const,
    enableThreatProtection: true,
  },
  // Write operations (POST, PUT, DELETE)
  write: {
    maxRequests: 30,
    windowSeconds: 60,
    identifier: 'combined' as const,
    enableThreatProtection: true,
  },
  // Sensitive operations (login, register, etc.)
  sensitive: {
    maxRequests: 10,
    windowSeconds: 60,
    identifier: 'ip' as const,
    enableThreatProtection: true,
  },
  // Admin endpoints
  admin: {
    maxRequests: 50,
    windowSeconds: 60,
    identifier: 'combined' as const,
    enableThreatProtection: true,
  },
  // Logging - very lenient (client sends many logs)
  logging: {
    maxRequests: 200,
    windowSeconds: 60,
    identifier: 'ip' as const,
    enableThreatProtection: false, // Don't block logging
  },
} as const;

/**
 * Trusted proxy configuration
 * Only trust proxy headers from these environments
 */
const TRUSTED_PROXY_CONFIG = {
  // Set to true ONLY if running behind a reverse proxy (Vercel, Cloudflare, nginx, etc.)
  // When false, proxy headers are ignored to prevent spoofing
  trustProxy: process.env.TRUST_PROXY === 'true' || process.env.VERCEL === '1',

  // Trusted proxy identifiers (for additional validation)
  trustedProxies: [
    // Cloudflare
    'cf-connecting-ip',
    // Vercel
    'x-vercel-forwarded-for',
  ],
};

/**
 * Validate IP address format (basic check)
 */
function isValidIP(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;

  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip) || ip === '::1' || ip === '127.0.0.1';
}

/**
 * Get client IP from request headers
 * SECURE: Only trusts proxy headers when running behind a known proxy
 */
export function getClientIP(request: NextRequest): string {
  // If not behind a trusted proxy, don't trust forwarded headers
  // This prevents attackers from spoofing their IP
  if (!TRUSTED_PROXY_CONFIG.trustProxy) {
    // In development/direct connection, use a hash of request characteristics
    // This prevents trivial IP spoofing while still providing rate limiting
    const userAgent = request.headers.get('user-agent') || '';
    const acceptLang = request.headers.get('accept-language') || '';

    // Create a semi-stable identifier from request characteristics
    // Not perfect, but better than trusting spoofable headers
    const identifier = `direct:${hashString(userAgent + acceptLang)}`;
    return identifier;
  }

  // Running behind a trusted proxy - check trusted headers first

  // Cloudflare (most trustworthy as it's set by Cloudflare infrastructure)
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP && isValidIP(cfIP)) {
    return cfIP;
  }

  // Vercel
  const vercelIP = request.headers.get('x-vercel-forwarded-for');
  if (vercelIP) {
    const ip = vercelIP.split(',')[0].trim();
    if (isValidIP(ip)) {
      return ip;
    }
  }

  // x-real-ip (set by nginx and other proxies)
  const realIP = request.headers.get('x-real-ip');
  if (realIP && isValidIP(realIP)) {
    return realIP;
  }

  // x-forwarded-for (last resort, take first IP)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim();
    if (isValidIP(ip)) {
      return ip;
    }
  }

  // Fallback to request fingerprint
  const userAgent = request.headers.get('user-agent') || '';
  return `fallback:${hashString(userAgent)}`;
}

/**
 * Simple string hash for fingerprinting (not cryptographic)
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get user identifier from request (wallet address)
 */
export function getUserIdentifier(request: NextRequest): string | null {
  // Check query params
  const url = new URL(request.url);
  const wallet = url.searchParams.get('wallet') || url.searchParams.get('walletAddress');
  if (wallet) {
    return wallet;
  }

  // For POST requests, we can't easily read the body here
  // The wallet will be validated in the route handler
  return null;
}

/**
 * Generate rate limit key based on configuration
 */
function getRateLimitKey(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig
): string {
  const ip = getClientIP(request);
  const user = getUserIdentifier(request);

  switch (config.identifier) {
    case 'ip':
      return `ratelimit:${endpoint}:ip:${ip}`;
    case 'user':
      return user ? `ratelimit:${endpoint}:user:${user}` : `ratelimit:${endpoint}:ip:${ip}`;
    case 'combined':
      return user
        ? `ratelimit:${endpoint}:combined:${ip}:${user}`
        : `ratelimit:${endpoint}:ip:${ip}`;
    default:
      return `ratelimit:${endpoint}:ip:${ip}`;
  }
}

/**
 * Check rate limit using Redis (distributed)
 * Falls back to in-memory if Redis unavailable
 */
async function checkRateLimitRedis(
  key: string,
  config: RateLimitConfig
): Promise<{ count: number; resetTime: number; violations: number } | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;

    // Use Redis MULTI for atomic operations
    const multi = redis.multi();
    const redisKey = `rl:${key}`;
    const violationsKey = `rl:v:${key}`;

    // Increment counter
    multi.incr(redisKey);
    // Set TTL if key is new
    multi.pttl(redisKey);
    // Get violations count
    multi.get(violationsKey);

    const results = await multi.exec();
    if (!results) return null;

    const count = results[0][1] as number;
    const ttl = results[1][1] as number;
    const violations = parseInt(results[2][1] as string || '0', 10);

    // Set expiry if this is a new key (TTL will be -1 or -2)
    if (ttl < 0) {
      await redis.pexpire(redisKey, windowMs);
    }

    const resetTime = now + (ttl > 0 ? ttl : windowMs);

    return { count, resetTime, violations };
  } catch (error) {
    console.error('[RateLimit] Redis error:', error);
    return null;
  }
}

/**
 * Increment violations counter in Redis
 */
async function incrementViolationsRedis(key: string, windowMs: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const violationsKey = `rl:v:${key}`;
    await redis.incr(violationsKey);
    await redis.pexpire(violationsKey, windowMs * 10); // Keep violations longer
  } catch (error) {
    console.error('[RateLimit] Redis violations error:', error);
  }
}

/**
 * Check and update rate limit with threat protection
 * Returns null if allowed, or a 429/403 response if rate limited/blocked
 */
export async function checkRateLimitWithThreat(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig = RATE_LIMITS.public
): Promise<NextResponse | null> {
  const clientIP = getClientIP(request);

  // Check threat protection first (if enabled)
  if (config.enableThreatProtection !== false) {
    const threatResponse = await checkThreat(request, clientIP);
    if (threatResponse) {
      return threatResponse;
    }
  }

  // Then check rate limit
  return checkRateLimit(request, endpoint, config, clientIP);
}

/**
 * Check and update rate limit (synchronous version)
 * Uses in-memory store only - for async Redis support, use checkRateLimitAsync()
 * Returns null if allowed, or a 429 response if rate limited
 *
 * NOTE: For production with multiple instances, prefer checkRateLimitAsync() with Redis
 */
export function checkRateLimit(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig = RATE_LIMITS.public,
  precomputedIP?: string
): NextResponse | null {
  const clientIP = precomputedIP || getClientIP(request);
  const key = getRateLimitKey(request, endpoint, config);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // SECURITY: Check and enforce size limit before adding new entries
  evictOldestEntries();

  // In-memory rate limiting (synchronous, reliable)
  let entry = rateLimitStore.get(key);

  // Initialize or reset if window expired
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + windowMs,
      violations: 0,
    };
  }

  entry.count++;
  rateLimitStore.set(key, entry);

  // Calculate remaining requests and reset time
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

  // If over limit, return 429 and record violation
  if (entry.count > config.maxRequests) {
    entry.violations++;
    rateLimitStore.set(key, entry);

    // Record violation for threat protection (async, don't block)
    if (config.enableThreatProtection !== false) {
      const fingerprint = generateFingerprint(request);
      recordViolation(
        clientIP,
        fingerprint,
        `Rate limit exceeded on ${endpoint}`,
        Math.min(entry.violations * 10, 100) // Score based on repeated violations
      ).catch(console.error);
    }

    return NextResponse.json(
      {
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${resetSeconds} seconds.`,
        retryAfter: resetSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(resetSeconds),
          'X-RateLimit-Limit': String(config.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(entry.resetTime),
        },
      }
    );
  }

  return null;
}

/**
 * Async version of checkRateLimit that properly uses Redis
 * Recommended for new code
 */
export async function checkRateLimitAsync(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig = RATE_LIMITS.public,
  precomputedIP?: string
): Promise<NextResponse | null> {
  const clientIP = precomputedIP || getClientIP(request);
  const key = getRateLimitKey(request, endpoint, config);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Try Redis first
  const redisResult = await checkRateLimitRedis(key, config);

  if (redisResult) {
    // Redis is available - use it
    const resetSeconds = Math.ceil((redisResult.resetTime - now) / 1000);

    if (redisResult.count > config.maxRequests) {
      // Record violation
      await incrementViolationsRedis(key, windowMs);

      if (config.enableThreatProtection !== false) {
        const fingerprint = generateFingerprint(request);
        await recordViolation(
          clientIP,
          fingerprint,
          `Rate limit exceeded on ${endpoint}`,
          Math.min((redisResult.violations + 1) * 10, 100)
        );
      }

      return NextResponse.json(
        {
          error: 'Too many requests',
          message: `Rate limit exceeded. Please try again in ${resetSeconds} seconds.`,
          retryAfter: resetSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(resetSeconds),
            'X-RateLimit-Limit': String(config.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(redisResult.resetTime),
          },
        }
      );
    }

    return null;
  }

  // Fall back to in-memory (sync version)
  return checkRateLimit(request, endpoint, config, clientIP);
}

/**
 * Middleware helper to add rate limit headers to successful responses
 */
export function addRateLimitHeaders(
  response: NextResponse,
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig = RATE_LIMITS.public
): NextResponse {
  const key = getRateLimitKey(request, endpoint, config);
  const entry = rateLimitStore.get(key);

  if (entry) {
    const remaining = Math.max(0, config.maxRequests - entry.count);
    response.headers.set('X-RateLimit-Limit', String(config.maxRequests));
    response.headers.set('X-RateLimit-Remaining', String(remaining));
    response.headers.set('X-RateLimit-Reset', String(entry.resetTime));
  }

  return response;
}

/**
 * Async version that checks Redis for rate limit info
 */
export async function addRateLimitHeadersAsync(
  response: NextResponse,
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig = RATE_LIMITS.public
): Promise<NextResponse> {
  const key = getRateLimitKey(request, endpoint, config);

  // Try to get info from Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      const redisKey = `rl:${key}`;
      const [count, ttl] = await Promise.all([
        redis.get(redisKey),
        redis.pttl(redisKey),
      ]);

      if (count !== null) {
        const remaining = Math.max(0, config.maxRequests - parseInt(count, 10));
        const resetTime = Date.now() + (ttl > 0 ? ttl : 0);
        response.headers.set('X-RateLimit-Limit', String(config.maxRequests));
        response.headers.set('X-RateLimit-Remaining', String(remaining));
        response.headers.set('X-RateLimit-Reset', String(resetTime));
        return response;
      }
    } catch (error) {
      console.error('[RateLimit] Redis headers error:', error);
    }
  }

  // Fall back to in-memory
  return addRateLimitHeaders(response, request, endpoint, config);
}

/**
 * Check if Redis-based rate limiting is active
 */
export function isRedisRateLimitingActive(): boolean {
  return getRedisClient() !== null;
}
