/**
 * Admin Security API
 *
 * Manage blocked IPs, fingerprints, and view security violations
 *
 * Security features:
 * - Rate limiting (admin tier)
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION
 * - Head admin only access
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isHeadAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { manualBlock, unblock } from '@/lib/threatProtection';
import {
  validateBody,
  validateQuery,
  adminAuthQuerySchema,
  ValidationError,
  safeString,
  authSchema,
} from '@/lib/validation';
import { verifyWalletSignature, verifyWalletSignatureAsync } from '@/lib/auth';
import { z } from 'zod';

// Schema for block action - requires auth for write operations
const blockActionSchema = z
  .object({
    auth: authSchema,
    action: z.enum(['block', 'unblock']),
    identifier: z.string().min(1).max(100),
    type: z.enum(['ip', 'fingerprint']),
    permanent: z.boolean().optional().default(false),
    durationMinutes: z.number().int().min(1).max(43200).optional(), // Max 30 days
    reason: safeString(0, 500).optional(),
  })
  .strict();

// GET - List blocked entities and recent violations
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'admin:security:get', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const params = validateQuery(searchParams, adminAuthQuerySchema);

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
    if (!isHeadAdmin(params.wallet)) {
      return NextResponse.json({ error: 'Head Admin access required' }, { status: 403 });
    }

    const view = searchParams.get('view') || 'blocked';

    if (view === 'blocked') {
      // Get all blocked entities
      const blocked = await prisma.blockedEntity.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const response = NextResponse.json({
        blocked,
        total: blocked.length,
      });
      return addRateLimitHeaders(response, request, 'admin:security:get', RATE_LIMITS.admin);
    }

    if (view === 'violations') {
      // Get recent violations
      const violations = await prisma.securityViolation.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      // Group by IP for summary
      const ipCounts = violations.reduce(
        (acc, v) => {
          acc[v.ipAddress] = (acc[v.ipAddress] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const topOffenders = Object.entries(ipCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ip, count]) => ({ ip, count }));

      const response = NextResponse.json({
        violations,
        total: violations.length,
        topOffenders,
      });
      return addRateLimitHeaders(response, request, 'admin:security:get', RATE_LIMITS.admin);
    }

    if (view === 'stats') {
      // Get security stats
      const [totalBlocked, permanentBlocks, activeBlocks, recentViolations, last24hViolations] =
        await Promise.all([
          prisma.blockedEntity.count(),
          prisma.blockedEntity.count({ where: { expiresAt: null } }),
          prisma.blockedEntity.count({
            where: {
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          }),
          prisma.securityViolation.count(),
          prisma.securityViolation.count({
            where: { createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          }),
        ]);

      const response = NextResponse.json({
        totalBlocked,
        permanentBlocks,
        activeBlocks,
        recentViolations,
        last24hViolations,
      });
      return addRateLimitHeaders(response, request, 'admin:security:get', RATE_LIMITS.admin);
    }

    return NextResponse.json({ error: 'Invalid view parameter' }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Admin security error:', error);
    return NextResponse.json({ error: 'Failed to fetch security data' }, { status: 500 });
  }
}

// POST - Block or unblock an entity (uses async nonce verification)
export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'admin:security:action', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const data = await validateBody(request, blockActionSchema);
    const { auth, action, identifier, type, permanent, durationMinutes, reason } = data;

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      `security_${action}`
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    if (!isHeadAdmin(auth.walletAddress)) {
      return NextResponse.json({ error: 'Head Admin access required' }, { status: 403 });
    }

    if (action === 'block') {
      await manualBlock(
        identifier,
        type,
        permanent ?? false,
        reason || `Manually blocked by admin`,
        durationMinutes
      );

      const response = NextResponse.json({
        success: true,
        message: `${type} ${identifier} has been ${permanent ? 'permanently' : 'temporarily'} blocked`,
      });
      return addRateLimitHeaders(response, request, 'admin:security:action', RATE_LIMITS.admin);
    }

    if (action === 'unblock') {
      await unblock(identifier);

      const response = NextResponse.json({
        success: true,
        message: `${type} ${identifier} has been unblocked`,
      });
      return addRateLimitHeaders(response, request, 'admin:security:action', RATE_LIMITS.admin);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Admin security action error:', error);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}

// DELETE - Clear old violations (cleanup) - uses async nonce verification
export async function DELETE(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'admin:security:cleanup', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const params = validateQuery(searchParams, adminAuthQuerySchema);

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      params.wallet,
      params.signature,
      params.message,
      params.timestamp,
      params.nonce,
      'security_cleanup'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    // Authorization check (now we know they actually own this wallet)
    if (!isHeadAdmin(params.wallet)) {
      return NextResponse.json({ error: 'Head Admin access required' }, { status: 403 });
    }

    const olderThan = searchParams.get('olderThan') || '7'; // days
    const days = parseInt(olderThan, 10);

    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: 'Invalid olderThan parameter (1-365 days)' }, { status: 400 });
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Delete old violations
    const { count: violationsDeleted } = await prisma.securityViolation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    // Delete expired blocks
    const { count: blocksDeleted } = await prisma.blockedEntity.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    const response = NextResponse.json({
      success: true,
      violationsDeleted,
      blocksDeleted,
    });
    return addRateLimitHeaders(response, request, 'admin:security:cleanup', RATE_LIMITS.admin);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
