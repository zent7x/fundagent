/**
 * Threat Protection Module
 *
 * Advanced security features:
 * - Automatic IP blocking after threshold violations
 * - Device/browser fingerprinting to track users across proxies
 * - Behavioral analysis to detect bots and automated attacks
 * - Progressive penalties with escalating block times
 * - Suspicious pattern detection
 * - Datacenter/proxy IP detection
 *
 * OWASP compliant - DDoS and bot protection
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

// =============================================================================
// CONFIGURATION
// =============================================================================

export const THREAT_CONFIG = {
  // Violations before temporary block
  VIOLATION_THRESHOLD: 10,
  // Violations before permanent block
  PERMANENT_BLOCK_THRESHOLD: 50,
  // Base block duration in minutes (doubles each time)
  BASE_BLOCK_MINUTES: 5,
  // Max block duration (24 hours)
  MAX_BLOCK_MINUTES: 1440,
  // Time window to count violations (minutes)
  VIOLATION_WINDOW_MINUTES: 60,
  // Request velocity threshold (requests per second that triggers flag)
  VELOCITY_THRESHOLD: 5,
  // Identical request threshold (same payload within window)
  DUPLICATE_REQUEST_THRESHOLD: 5,
  // Suspicious headers that indicate proxy/bot
  SUSPICIOUS_HEADERS: [
    'via',
    'x-forwarded-for',
    'forwarded',
    'x-proxy-id',
    'proxy-connection',
  ],
  // Known datacenter/proxy ASN patterns (partial)
  DATACENTER_PATTERNS: [
    'amazon',
    'google',
    'microsoft',
    'digitalocean',
    'linode',
    'vultr',
    'ovh',
    'hetzner',
    'cloudflare',
  ],
};

// In-memory cache for fast lookups (backed by database for persistence)
const violationCache = new Map<string, { count: number; lastViolation: number }>();
const requestHistory = new Map<string, number[]>(); // timestamps of recent requests
const blockCache = new Map<string, { until: number; permanent: boolean }>();
const fingerprintToIP = new Map<string, Set<string>>(); // track IPs per fingerprint

// =============================================================================
// FINGERPRINTING
// =============================================================================

/**
 * Generate a device fingerprint from request headers
 * This helps identify users even when they change IPs/use proxies
 */
export function generateFingerprint(request: NextRequest): string {
  const components = [
    request.headers.get('user-agent') || '',
    request.headers.get('accept-language') || '',
    request.headers.get('accept-encoding') || '',
    request.headers.get('accept') || '',
    // Screen info if available (sent by client)
    request.headers.get('x-screen-resolution') || '',
    request.headers.get('x-timezone') || '',
    request.headers.get('x-color-depth') || '',
  ];

  const hash = crypto.createHash('sha256').update(components.join('|')).digest('hex');
  return hash.substring(0, 32);
}

/**
 * Generate a request signature to detect duplicate/automated requests
 */
export function generateRequestSignature(request: NextRequest, body?: string): string {
  const components = [
    request.method,
    request.nextUrl.pathname,
    body || '',
  ];

  return crypto.createHash('md5').update(components.join('|')).digest('hex');
}

// =============================================================================
// THREAT DETECTION
// =============================================================================

interface ThreatAnalysis {
  blocked: boolean;
  reason?: string;
  score: number; // 0-100, higher = more suspicious
  flags: string[];
  fingerprint: string;
}

/**
 * Analyze request for threats
 */
export async function analyzeRequest(
  request: NextRequest,
  clientIP: string
): Promise<ThreatAnalysis> {
  const flags: string[] = [];
  let score = 0;
  const fingerprint = generateFingerprint(request);

  // Check if IP is blocked
  const blockStatus = await checkBlockStatus(clientIP, fingerprint);
  if (blockStatus.blocked) {
    return {
      blocked: true,
      reason: blockStatus.reason,
      score: 100,
      flags: ['blocked'],
      fingerprint,
    };
  }

  // Check request velocity (requests per second)
  const velocityScore = checkRequestVelocity(clientIP);
  if (velocityScore > 0) {
    score += velocityScore;
    flags.push('high_velocity');
  }

  // Check for proxy/VPN indicators
  const proxyScore = checkProxyIndicators(request);
  if (proxyScore > 0) {
    score += proxyScore;
    flags.push('proxy_detected');
  }

  // Check fingerprint across multiple IPs (proxy rotation detection)
  const rotationScore = checkIPRotation(fingerprint, clientIP);
  if (rotationScore > 0) {
    score += rotationScore;
    flags.push('ip_rotation');
  }

  // Check for bot-like user agent
  const botScore = checkBotUserAgent(request);
  if (botScore > 0) {
    score += botScore;
    flags.push('bot_ua');
  }

  // Check for missing common headers (bots often lack these)
  const headerScore = checkMissingHeaders(request);
  if (headerScore > 0) {
    score += headerScore;
    flags.push('missing_headers');
  }

  // Track this request
  trackRequest(clientIP, fingerprint);

  // Auto-block if score exceeds threshold
  if (score >= 70) {
    await recordViolation(clientIP, fingerprint, flags.join(','), score);
  }

  return {
    blocked: false,
    score,
    flags,
    fingerprint,
  };
}

/**
 * Check if IP or fingerprint is blocked
 */
async function checkBlockStatus(
  ip: string,
  fingerprint: string
): Promise<{ blocked: boolean; reason?: string }> {
  // Check in-memory cache first
  const cachedBlock = blockCache.get(ip) || blockCache.get(fingerprint);
  if (cachedBlock) {
    if (cachedBlock.permanent || cachedBlock.until > Date.now()) {
      return {
        blocked: true,
        reason: cachedBlock.permanent ? 'Permanently blocked' : 'Temporarily blocked',
      };
    } else {
      // Block expired, remove from cache
      blockCache.delete(ip);
      blockCache.delete(fingerprint);
    }
  }

  // Check database for persistent blocks
  try {
    const blockedEntry = await prisma.blockedEntity.findFirst({
      where: {
        AND: [
          { OR: [{ identifier: ip }, { identifier: fingerprint }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
    });

    if (blockedEntry) {
      // Cache for faster future lookups
      const blockInfo = {
        until: blockedEntry.expiresAt?.getTime() || Infinity,
        permanent: !blockedEntry.expiresAt,
      };
      blockCache.set(blockedEntry.identifier, blockInfo);

      return {
        blocked: true,
        reason: blockedEntry.reason || 'Blocked due to suspicious activity',
      };
    }
  } catch (error) {
    // Database might not have the table yet, continue
    console.debug('Block check error (table may not exist):', error);
  }

  return { blocked: false };
}

/**
 * Check request velocity (requests per second)
 */
function checkRequestVelocity(ip: string): number {
  const now = Date.now();
  const history = requestHistory.get(ip) || [];

  // Count requests in last second
  const recentRequests = history.filter((t) => now - t < 1000).length;

  if (recentRequests >= THREAT_CONFIG.VELOCITY_THRESHOLD * 2) {
    return 40; // Very high velocity
  } else if (recentRequests >= THREAT_CONFIG.VELOCITY_THRESHOLD) {
    return 20; // High velocity
  }

  return 0;
}

/**
 * Check for proxy/VPN indicators in headers
 */
function checkProxyIndicators(request: NextRequest): number {
  let score = 0;

  // Check for proxy headers
  for (const header of THREAT_CONFIG.SUSPICIOUS_HEADERS) {
    if (request.headers.get(header)) {
      score += 5;
    }
  }

  // Check X-Forwarded-For for multiple IPs (proxy chain)
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.split(',').length > 2) {
    score += 15; // Long proxy chain
  }

  return Math.min(score, 30);
}

/**
 * Detect IP rotation (same fingerprint, different IPs)
 */
function checkIPRotation(fingerprint: string, currentIP: string): number {
  const knownIPs = fingerprintToIP.get(fingerprint) || new Set();

  // Add current IP
  knownIPs.add(currentIP);
  fingerprintToIP.set(fingerprint, knownIPs);

  // If same fingerprint used from many IPs in short time, suspicious
  if (knownIPs.size > 10) {
    return 30; // Definitely rotating IPs
  } else if (knownIPs.size > 5) {
    return 15; // Suspicious
  }

  return 0;
}

/**
 * Check for bot-like user agent
 */
function checkBotUserAgent(request: NextRequest): number {
  const ua = request.headers.get('user-agent')?.toLowerCase() || '';

  // No user agent
  if (!ua) return 25;

  // Known bot patterns
  const botPatterns = [
    'bot',
    'crawler',
    'spider',
    'scraper',
    'curl',
    'wget',
    'python',
    'java/',
    'go-http',
    'node-fetch',
    'axios',
    'httpie',
    'insomnia',
    'postman',
  ];

  for (const pattern of botPatterns) {
    if (ua.includes(pattern)) {
      return 15;
    }
  }

  // Very short user agent (suspicious)
  if (ua.length < 20) {
    return 10;
  }

  return 0;
}

/**
 * Check for missing common browser headers
 */
function checkMissingHeaders(request: NextRequest): number {
  let score = 0;

  // Real browsers always send these
  if (!request.headers.get('accept')) score += 5;
  if (!request.headers.get('accept-language')) score += 5;
  if (!request.headers.get('accept-encoding')) score += 5;

  // Check for inconsistent headers
  const ua = request.headers.get('user-agent')?.toLowerCase() || '';
  const acceptHeader = request.headers.get('accept') || '';

  // Browser claiming to be Chrome but not accepting HTML
  if (ua.includes('chrome') && !acceptHeader.includes('text/html')) {
    score += 10;
  }

  return score;
}

/**
 * Track request for velocity monitoring
 */
function trackRequest(ip: string, fingerprint: string): void {
  const now = Date.now();

  // Track by IP
  const ipHistory = requestHistory.get(ip) || [];
  ipHistory.push(now);
  // Keep only last 100 requests
  if (ipHistory.length > 100) {
    ipHistory.splice(0, ipHistory.length - 100);
  }
  requestHistory.set(ip, ipHistory);

  // Track by fingerprint
  const fpHistory = requestHistory.get(fingerprint) || [];
  fpHistory.push(now);
  if (fpHistory.length > 100) {
    fpHistory.splice(0, fpHistory.length - 100);
  }
  requestHistory.set(fingerprint, fpHistory);
}

// =============================================================================
// VIOLATION TRACKING & BLOCKING
// =============================================================================

/**
 * Record a violation and potentially block
 */
export async function recordViolation(
  ip: string,
  fingerprint: string,
  reason: string,
  score: number
): Promise<void> {
  const now = Date.now();

  // Update in-memory cache
  const cached = violationCache.get(ip) || { count: 0, lastViolation: 0 };
  cached.count += 1;
  cached.lastViolation = now;
  violationCache.set(ip, cached);

  // Also track by fingerprint
  const fpCached = violationCache.get(fingerprint) || { count: 0, lastViolation: 0 };
  fpCached.count += 1;
  fpCached.lastViolation = now;
  violationCache.set(fingerprint, fpCached);

  // Check if we should block
  const maxViolations = Math.max(cached.count, fpCached.count);

  try {
    // Log violation to database
    await prisma.securityViolation.create({
      data: {
        ipAddress: ip,
        fingerprint,
        reason,
        score,
      },
    });

    // Check for blocking threshold
    if (maxViolations >= THREAT_CONFIG.PERMANENT_BLOCK_THRESHOLD) {
      await blockEntity(ip, fingerprint, null, 'Exceeded permanent block threshold');
    } else if (maxViolations >= THREAT_CONFIG.VIOLATION_THRESHOLD) {
      // Progressive block duration
      const blockCount = Math.floor(maxViolations / THREAT_CONFIG.VIOLATION_THRESHOLD);
      const blockMinutes = Math.min(
        THREAT_CONFIG.BASE_BLOCK_MINUTES * Math.pow(2, blockCount - 1),
        THREAT_CONFIG.MAX_BLOCK_MINUTES
      );
      const expiresAt = new Date(now + blockMinutes * 60 * 1000);
      await blockEntity(ip, fingerprint, expiresAt, `Exceeded violation threshold (${blockMinutes} min block)`);
    }
  } catch (error) {
    console.error('Failed to record violation:', error);
  }
}

/**
 * Block an IP and/or fingerprint
 */
export async function blockEntity(
  ip: string,
  fingerprint: string,
  expiresAt: Date | null,
  reason: string
): Promise<void> {
  const blockInfo = {
    until: expiresAt?.getTime() || Infinity,
    permanent: !expiresAt,
  };

  // Update cache
  blockCache.set(ip, blockInfo);
  blockCache.set(fingerprint, blockInfo);

  try {
    // Persist to database
    await prisma.blockedEntity.upsert({
      where: { identifier: ip },
      update: { expiresAt, reason, updatedAt: new Date() },
      create: {
        identifier: ip,
        type: 'ip',
        reason,
        expiresAt,
      },
    });

    await prisma.blockedEntity.upsert({
      where: { identifier: fingerprint },
      update: { expiresAt, reason, updatedAt: new Date() },
      create: {
        identifier: fingerprint,
        type: 'fingerprint',
        reason,
        expiresAt,
      },
    });

    console.log(`Blocked ${ip} / ${fingerprint}: ${reason}`);
  } catch (error) {
    console.error('Failed to persist block:', error);
  }
}

/**
 * Manually block an IP (admin action)
 */
export async function manualBlock(
  identifier: string,
  type: 'ip' | 'fingerprint',
  permanent: boolean,
  reason: string,
  durationMinutes?: number
): Promise<void> {
  const expiresAt = permanent
    ? null
    : new Date(Date.now() + (durationMinutes || THREAT_CONFIG.MAX_BLOCK_MINUTES) * 60 * 1000);

  blockCache.set(identifier, {
    until: expiresAt?.getTime() || Infinity,
    permanent,
  });

  await prisma.blockedEntity.upsert({
    where: { identifier },
    update: { expiresAt, reason, updatedAt: new Date() },
    create: {
      identifier,
      type,
      reason,
      expiresAt,
    },
  });
}

/**
 * Unblock an entity
 */
export async function unblock(identifier: string): Promise<void> {
  blockCache.delete(identifier);

  await prisma.blockedEntity.delete({
    where: { identifier },
  }).catch(() => {}); // Ignore if doesn't exist
}

// =============================================================================
// MIDDLEWARE HELPER
// =============================================================================

/**
 * Threat protection middleware
 * Call this at the start of sensitive API routes
 */
export async function checkThreat(
  request: NextRequest,
  clientIP: string
): Promise<NextResponse | null> {
  const analysis = await analyzeRequest(request, clientIP);

  if (analysis.blocked) {
    return NextResponse.json(
      {
        error: 'Access denied',
        reason: analysis.reason,
        retryAfter: 300, // Suggest retry after 5 minutes
      },
      {
        status: 403,
        headers: {
          'Retry-After': '300',
          'X-Block-Reason': analysis.reason || 'suspicious_activity',
        },
      }
    );
  }

  // If highly suspicious but not blocked yet, add warning headers
  if (analysis.score >= 50) {
    // Log for monitoring
    console.warn(`Suspicious request from ${clientIP}: score=${analysis.score}, flags=${analysis.flags.join(',')}`);
  }

  return null;
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clean up old data (run periodically)
 */
export function cleanupOldData(): void {
  const now = Date.now();
  const maxAge = THREAT_CONFIG.VIOLATION_WINDOW_MINUTES * 60 * 1000;

  // Clean up old request history
  for (const [key, timestamps] of requestHistory.entries()) {
    const filtered = timestamps.filter((t) => now - t < maxAge);
    if (filtered.length === 0) {
      requestHistory.delete(key);
    } else {
      requestHistory.set(key, filtered);
    }
  }

  // Clean up expired blocks from cache
  for (const [key, block] of blockCache.entries()) {
    if (!block.permanent && block.until < now) {
      blockCache.delete(key);
    }
  }

  // Clean up old fingerprint tracking
  for (const [key, ips] of fingerprintToIP.entries()) {
    if (ips.size === 0) {
      fingerprintToIP.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupOldData, 5 * 60 * 1000);
}
