/**
 * Global Middleware - DDoS Protection & Rate Limiting
 *
 * This middleware runs on EVERY request before hitting the route handlers.
 * It provides:
 * - Global rate limiting (applies to all routes)
 * - IP-based blocking
 * - Request velocity monitoring
 * - Automatic blocking of abusive IPs
 *
 * OWASP compliant - DDoS protection at the edge
 */

import { NextRequest, NextResponse } from 'next/server';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Global rate limit (requests per window)
  GLOBAL_RATE_LIMIT: 100,
  GLOBAL_WINDOW_SECONDS: 60,

  // API-specific limits (stricter)
  API_RATE_LIMIT: 60,
  API_WINDOW_SECONDS: 60,

  // Burst protection (requests per second before flagging)
  BURST_THRESHOLD: 10,

  // Block thresholds
  VIOLATIONS_BEFORE_BLOCK: 5,
  BLOCK_DURATION_SECONDS: 300, // 5 minutes initial block

  // Paths to skip (static assets, etc.)
  SKIP_PATHS: ['/_next', '/favicon.ico', '/robots.txt', '/sitemap.xml'],
};

// =============================================================================
// IN-MEMORY STORES (Edge-compatible, no external dependencies)
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
  lastRequest: number;
  burstCount: number;
  violations: number;
}

interface BlockEntry {
  until: number;
  reason: string;
}

// Use globalThis for edge runtime compatibility
const getStore = () => {
  if (!(globalThis as any).__rateLimitStore) {
    (globalThis as any).__rateLimitStore = new Map<string, RateLimitEntry>();
  }
  return (globalThis as any).__rateLimitStore as Map<string, RateLimitEntry>;
};

const getBlockStore = () => {
  if (!(globalThis as any).__blockStore) {
    (globalThis as any).__blockStore = new Map<string, BlockEntry>();
  }
  return (globalThis as any).__blockStore as Map<string, BlockEntry>;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Trusted proxy configuration
 * Only trust proxy headers when running behind a known proxy
 */
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.VERCEL === '1';

/**
 * Validate IP address format
 */
function isValidIP(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip) || ip === '::1' || ip === '127.0.0.1';
}

/**
 * Simple hash for fingerprinting
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * SECURE: Get client IP - only trusts proxy headers when behind a known proxy
 */
function getClientIP(request: NextRequest): string {
  // If not behind a trusted proxy, don't trust forwarded headers
  if (!TRUST_PROXY) {
    const userAgent = request.headers.get('user-agent') || '';
    const acceptLang = request.headers.get('accept-language') || '';
    return `direct:${hashString(userAgent + acceptLang)}`;
  }

  // Cloudflare (most trustworthy)
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP && isValidIP(cfIP)) return cfIP;

  // Vercel
  const vercelIP = request.headers.get('x-vercel-forwarded-for');
  if (vercelIP) {
    const ip = vercelIP.split(',')[0].trim();
    if (isValidIP(ip)) return ip;
  }

  // x-real-ip
  const realIP = request.headers.get('x-real-ip');
  if (realIP && isValidIP(realIP)) return realIP;

  // x-forwarded-for (last resort)
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const ip = xff.split(',')[0].trim();
    if (isValidIP(ip)) return ip;
  }

  // Fallback
  const userAgent = request.headers.get('user-agent') || '';
  return `fallback:${hashString(userAgent)}`;
}

function shouldSkipPath(pathname: string): boolean {
  return CONFIG.SKIP_PATHS.some((skip) => pathname.startsWith(skip));
}

function isAPIRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

// =============================================================================
// RATE LIMITING & BLOCKING LOGIC
// =============================================================================

function checkRateLimit(ip: string, isAPI: boolean): { allowed: boolean; reason?: string; retryAfter?: number } {
  const store = getStore();
  const blockStore = getBlockStore();
  const now = Date.now();

  // Check if IP is blocked
  const block = blockStore.get(ip);
  if (block && block.until > now) {
    const retryAfter = Math.ceil((block.until - now) / 1000);
    return { allowed: false, reason: block.reason, retryAfter };
  } else if (block) {
    // Block expired, remove it
    blockStore.delete(ip);
  }

  // Get or create rate limit entry
  const limit = isAPI ? CONFIG.API_RATE_LIMIT : CONFIG.GLOBAL_RATE_LIMIT;
  const windowMs = (isAPI ? CONFIG.API_WINDOW_SECONDS : CONFIG.GLOBAL_WINDOW_SECONDS) * 1000;

  let entry = store.get(ip);

  // Reset if window expired
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + windowMs,
      lastRequest: now,
      burstCount: 0,
      violations: entry?.violations || 0, // Preserve violation count
    };
  }

  // Check for burst (requests within 1 second)
  if (now - entry.lastRequest < 1000) {
    entry.burstCount++;
    if (entry.burstCount > CONFIG.BURST_THRESHOLD) {
      entry.violations++;

      // Block if too many violations
      if (entry.violations >= CONFIG.VIOLATIONS_BEFORE_BLOCK) {
        const blockDuration = CONFIG.BLOCK_DURATION_SECONDS * Math.pow(2, entry.violations - CONFIG.VIOLATIONS_BEFORE_BLOCK);
        const maxBlock = 24 * 60 * 60; // Max 24 hours
        const actualBlock = Math.min(blockDuration, maxBlock);

        blockStore.set(ip, {
          until: now + actualBlock * 1000,
          reason: `Blocked for ${actualBlock}s due to burst attack (${entry.violations} violations)`,
        });

        store.set(ip, entry);
        return { allowed: false, reason: 'Too many requests in burst', retryAfter: actualBlock };
      }
    }
  } else {
    // Reset burst counter after 1 second gap
    entry.burstCount = 0;
  }

  entry.lastRequest = now;
  entry.count++;
  store.set(ip, entry);

  // Check rate limit
  if (entry.count > limit) {
    entry.violations++;
    store.set(ip, entry);

    // Block if too many violations
    if (entry.violations >= CONFIG.VIOLATIONS_BEFORE_BLOCK) {
      const blockDuration = CONFIG.BLOCK_DURATION_SECONDS * Math.pow(2, entry.violations - CONFIG.VIOLATIONS_BEFORE_BLOCK);
      const maxBlock = 24 * 60 * 60;
      const actualBlock = Math.min(blockDuration, maxBlock);

      blockStore.set(ip, {
        until: now + actualBlock * 1000,
        reason: `Blocked for ${actualBlock}s due to rate limit abuse (${entry.violations} violations)`,
      });

      return { allowed: false, reason: 'Rate limit exceeded, IP blocked', retryAfter: actualBlock };
    }

    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    return { allowed: false, reason: 'Rate limit exceeded', retryAfter };
  }

  return { allowed: true };
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip static assets
  if (shouldSkipPath(pathname)) {
    return NextResponse.next();
  }

  // DEVELOPMENT MODE: Skip rate limiting entirely
  if (process.env.NODE_ENV === 'development') {
    const response = NextResponse.next();
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    return response;
  }

  const ip = getClientIP(request);
  const isAPI = isAPIRoute(pathname);

  // Check rate limit
  const result = checkRateLimit(ip, isAPI);

  if (!result.allowed) {
    // Log blocked request
    console.warn(`[BLOCKED] IP: ${ip}, Path: ${pathname}, Reason: ${result.reason}`);

    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: result.reason,
        retryAfter: result.retryAfter,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfter || 60),
          'X-RateLimit-Limit': String(isAPI ? CONFIG.API_RATE_LIMIT : CONFIG.GLOBAL_RATE_LIMIT),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  // Add security headers to response
  const response = NextResponse.next();

  // ==========================================================================
  // SECURITY HEADERS (OWASP Recommended)
  // ==========================================================================

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // XSS Protection (legacy but still useful)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (disable unnecessary features)
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Next.js
      "style-src 'self' 'unsafe-inline'", // Required for styled components
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.solana.com https://*.helius-rpc.com wss://*.solana.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  // HSTS (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Add rate limit info headers
  const store = getStore();
  const entry = store.get(ip);
  if (entry) {
    const limit = isAPI ? CONFIG.API_RATE_LIMIT : CONFIG.GLOBAL_RATE_LIMIT;
    const remaining = Math.max(0, limit - entry.count);
    response.headers.set('X-RateLimit-Limit', String(limit));
    response.headers.set('X-RateLimit-Remaining', String(remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));
  }

  return response;
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
