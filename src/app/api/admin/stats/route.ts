/**
 * Admin Stats API
 *
 * Security features:
 * - Rate limiting (admin tier)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION
 * - Role-based access control
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { validateQuery, adminAuthQuerySchema, ValidationError } from '@/lib/validation';
import { verifyWalletSignature } from '@/lib/auth';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'admin:stats', RATE_LIMITS.admin);
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
    if (!isAdmin(params.wallet)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [totalProposals, totalUsers, proposals, totalMessages, pendingProposals, bannedUsers, totalLogs] =
      await Promise.all([
        prisma.proposal.count(),
        prisma.user.count(),
        prisma.proposal.findMany({ select: { fundedAmount: true } }),
        prisma.message.count(),
        prisma.proposal.count({ where: { status: 'funding' } }),
        prisma.user.count({ where: { isBanned: true } }),
        prisma.activityLog.count(),
      ]);

    const totalFunded = proposals.reduce((sum, p) => sum + p.fundedAmount, 0);

    const response = NextResponse.json({
      totalProposals,
      totalUsers,
      totalFunded,
      totalMessages,
      pendingProposals,
      bannedUsers,
      totalLogs,
    });

    return addRateLimitHeaders(response, request, 'admin:stats', RATE_LIMITS.admin);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Error fetching admin stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
