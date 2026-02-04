/**
 * Single Proposal API
 *
 * Security features:
 * - Rate limiting (public tier)
 * - Schema-based input validation
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { validateQuery, proposalIdSchema, ValidationError } from '@/lib/validation';

// GET single proposal
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'proposals:get:single', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;

    // Validate the ID
    const validated = proposalIdSchema.parse({ id });

    const proposal = await prisma.proposal.findUnique({
      where: { id: validated.id },
      include: {
        milestones: {
          orderBy: { order: 'asc' },
        },
        fundings: {
          include: {
            backer: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        updates: {
          orderBy: { createdAt: 'desc' },
        },
        creator: true,
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const response = NextResponse.json(proposal);
    return addRateLimitHeaders(response, request, 'proposals:get:single', RATE_LIMITS.public);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error fetching proposal:', error);
    return NextResponse.json({ error: 'Failed to fetch proposal' }, { status: 500 });
  }
}
