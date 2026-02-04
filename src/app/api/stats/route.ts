/**
 * Public Stats API
 *
 * Security features:
 * - Rate limiting (public tier)
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';

export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'stats:get', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const [proposalCount, totalFunded, completedCount] = await Promise.all([
      prisma.proposal.count(),
      prisma.proposal.aggregate({
        _sum: { fundedAmount: true },
      }),
      prisma.proposal.count({
        where: { status: 'completed' },
      }),
    ]);

    const response = NextResponse.json({
      proposals: proposalCount,
      totalFunded: totalFunded._sum.fundedAmount || 0,
      shipped: completedCount,
    });

    return addRateLimitHeaders(response, request, 'stats:get', RATE_LIMITS.public);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
