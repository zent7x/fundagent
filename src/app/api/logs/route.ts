/**
 * Activity Logs API
 *
 * Security features:
 * - Rate limiting (lenient for logging, admin for retrieval)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION for GET
 * - IP geolocation (no external API keys exposed)
 * - Sanitized inputs
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders, getClientIP } from '@/lib/rateLimit';
import {
  validateBody,
  validateQuery,
  activityLogSchema,
  logsAuthQuerySchema,
  ValidationError,
  sanitizeString,
} from '@/lib/validation';
import { verifyWalletSignature } from '@/lib/auth';
import { z } from 'zod';

// Helper to parse user agent
function parseUserAgent(ua: string | null) {
  if (!ua) return {};
  // SECURITY: Truncate to prevent DoS from malformed user agents
  const truncatedUA = ua.substring(0, 500);

  const result: {
    browser?: string;
    browserVersion?: string;
    os?: string;
    osVersion?: string;
    deviceType?: string;
  } = {};

  // Browser detection (using truncated UA)
  if (truncatedUA.includes('Chrome') && !truncatedUA.includes('Edg')) {
    result.browser = 'Chrome';
    const match = truncatedUA.match(/Chrome\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  } else if (truncatedUA.includes('Firefox')) {
    result.browser = 'Firefox';
    const match = truncatedUA.match(/Firefox\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  } else if (truncatedUA.includes('Safari') && !truncatedUA.includes('Chrome')) {
    result.browser = 'Safari';
    const match = truncatedUA.match(/Version\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  } else if (truncatedUA.includes('Edg')) {
    result.browser = 'Edge';
    const match = truncatedUA.match(/Edg\/(\d+\.\d+)/);
    if (match) result.browserVersion = match[1];
  }

  // OS detection (using truncated UA)
  if (truncatedUA.includes('Windows NT 10')) {
    result.os = 'Windows';
    result.osVersion = '10/11';
  } else if (truncatedUA.includes('Windows')) {
    result.os = 'Windows';
  } else if (truncatedUA.includes('Mac OS X')) {
    result.os = 'macOS';
    const match = truncatedUA.match(/Mac OS X (\d+[._]\d+)/);
    if (match) result.osVersion = match[1].replace('_', '.');
  } else if (truncatedUA.includes('Linux')) {
    result.os = 'Linux';
  } else if (truncatedUA.includes('Android')) {
    result.os = 'Android';
    const match = truncatedUA.match(/Android (\d+\.\d+)/);
    if (match) result.osVersion = match[1];
  } else if (truncatedUA.includes('iPhone') || truncatedUA.includes('iPad')) {
    result.os = 'iOS';
    const match = truncatedUA.match(/OS (\d+_\d+)/);
    if (match) result.osVersion = match[1].replace('_', '.');
  }

  // Device type (using truncated UA)
  if (truncatedUA.includes('Mobile') || truncatedUA.includes('Android') || truncatedUA.includes('iPhone')) {
    result.deviceType = 'mobile';
  } else if (truncatedUA.includes('iPad') || truncatedUA.includes('Tablet')) {
    result.deviceType = 'tablet';
  } else {
    result.deviceType = 'desktop';
  }

  return result;
}

// Helper to get IP geolocation (using free ip-api.com - no API key needed)
async function getGeoLocation(ip: string) {
  // Skip for local/private IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === 'unknown') {
    return {
      country: 'Local',
      countryCode: 'LO',
      region: 'Local Network',
      city: 'Localhost',
    };
  }

  try {
    // Using ip-api.com (free, no API key needed, 45 req/min limit)
    // Note: This is a free service, consider using a paid service in production
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    const data = await response.json();

    if (data.status === 'success') {
      return {
        country: data.country,
        countryCode: data.countryCode,
        region: data.regionName,
        city: data.city,
        zipCode: data.zip,
        latitude: data.lat,
        longitude: data.lon,
        timezone: data.timezone,
        isp: data.isp,
      };
    }
  } catch (error) {
    // Silent fail - geolocation is optional
    console.debug('Geo lookup failed:', error);
  }

  return {};
}

// POST - Log an activity
export async function POST(request: NextRequest) {
  // Rate limit check - lenient for logging
  const rateLimitResponse = checkRateLimit(request, 'logs:create', RATE_LIMITS.logging);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Validate request body
    const data = await validateBody(request, activityLogSchema);
    const {
      walletAddress,
      sessionId,
      action,
      actionDetails,
      page,
      element,
      screenWidth,
      screenHeight,
    } = data;

    // Get IP address from headers
    const ipAddress = getClientIP(request);

    // Get user agent
    const userAgent = request.headers.get('user-agent');
    const parsedUA = parseUserAgent(userAgent);

    // Get geolocation (async, but don't block response)
    const geoData = await getGeoLocation(ipAddress);

    // Create log entry
    const log = await prisma.activityLog.create({
      data: {
        walletAddress: walletAddress || null,
        sessionId: sessionId || `anon-${Date.now()}`,
        action: sanitizeString(action),
        actionDetails: actionDetails ? JSON.stringify(actionDetails) : null,
        page: page ? sanitizeString(page) : null,
        element: element ? sanitizeString(element) : null,
        userAgent,
        browser: parsedUA.browser,
        browserVersion: parsedUA.browserVersion,
        os: parsedUA.os,
        osVersion: parsedUA.osVersion,
        deviceType: parsedUA.deviceType,
        screenWidth: screenWidth || null,
        screenHeight: screenHeight || null,
        ipAddress,
        country: geoData.country,
        countryCode: geoData.countryCode,
        region: geoData.region,
        city: geoData.city,
        zipCode: geoData.zipCode,
        latitude: geoData.latitude,
        longitude: geoData.longitude,
        timezone: geoData.timezone,
        isp: geoData.isp,
      },
    });

    return NextResponse.json({ success: true, id: log.id });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error logging activity:', error);
    return NextResponse.json({ error: 'Failed to log activity' }, { status: 500 });
  }
}

// GET - Retrieve logs (admin only)
export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'logs:get', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const params = validateQuery(searchParams, logsAuthQuerySchema);

    // CRITICAL: Verify wallet signature - proves ownership of the wallet
    const signatureResult = verifyWalletSignature(
      params.wallet,
      params.signature,
      params.message,
      params.timestamp,
      params.nonce
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    // Authorization check (now we know they actually own this wallet)
    if (!isAdmin(params.wallet)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchWallet, action, page = 1, limit = 50 } = params;
    const wallet = params.wallet;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (searchWallet) {
      // SECURITY: Use exact match instead of contains to prevent enumeration
      where.walletAddress = searchWallet;
    }

    if (action && action !== 'all') {
      where.action = action;
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.activityLog.count({ where }),
    ]);

    // Get unique actions for filter - SECURITY: Limit to prevent DoS
    const actions = await prisma.activityLog.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 50, // SECURITY: Limit groupBy results
    });

    const response = NextResponse.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      actions: actions.map((a) => ({ action: a.action, count: a._count.action })),
    });

    return addRateLimitHeaders(response, request, 'logs:get', RATE_LIMITS.admin);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
