/**
 * Admin Proposals API
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
import {
  validateBody,
  validateQuery,
  adminAuthQuerySchema,
  ValidationError,
  authSchema,
} from '@/lib/validation';
import { verifyWalletSignature, verifyWalletSignatureAsync } from '@/lib/auth';
import { z } from 'zod';

// Schema with auth for write operations
const adminProposalActionSchema = z
  .object({
    auth: authSchema,
    proposalId: z.string().min(1).max(50),
    action: z.enum(['delete', 'approve', 'reject']),
  })
  .strict();

export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'admin:proposals:get', RATE_LIMITS.admin);
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

    // Check for escrowOnly filter
    const escrowOnly = searchParams.get('escrowOnly') === 'true';

    // SECURITY: Add pagination to prevent memory exhaustion
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const skip = (page - 1) * limit;

    const [proposals, totalCount] = await Promise.all([
      prisma.proposal.findMany({
        where: escrowOnly ? { escrowAddress: { not: null } } : undefined,
        include: {
          _count: {
            select: { fundings: true, messages: true },
          },
          ...(escrowOnly && {
            milestones: {
              select: { id: true, title: true, percentage: true, status: true },
              orderBy: { order: 'asc' },
            },
            fundings: {
              select: {
                id: true,
                amount: true,
                status: true,
                backer: { select: { walletAddress: true } },
              },
            },
          }),
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit, // SECURITY: Limit results to prevent DoS
      }),
      prisma.proposal.count({
        where: escrowOnly ? { escrowAddress: { not: null } } : undefined,
      }),
    ]);

    const response = NextResponse.json({
      proposals,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
    return addRateLimitHeaders(response, request, 'admin:proposals:get', RATE_LIMITS.admin);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Error fetching proposals:', error);
    return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'admin:proposals:action', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const data = await validateBody(request, adminProposalActionSchema);
    const { auth, proposalId, action } = data;

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      `admin_proposal_${action}`
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    // Authorization check (now we know they actually own this wallet)
    if (!isAdmin(auth.walletAddress)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (action === 'delete') {
      await prisma.proposal.delete({ where: { id: proposalId } });
      const response = NextResponse.json({ success: true });
      return addRateLimitHeaders(response, request, 'admin:proposals:action', RATE_LIMITS.admin);
    }

    if (action === 'approve') {
      // SECURITY: Verify proposal has met funding goal before approving
      const proposal = await prisma.proposal.findUnique({
        where: { id: proposalId },
        select: { fundedAmount: true, fundingGoal: true },
      });

      if (!proposal) {
        return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
      }

      if (proposal.fundedAmount < proposal.fundingGoal) {
        return NextResponse.json(
          {
            error: 'Cannot approve: proposal has not met funding goal',
            details: {
              funded: proposal.fundedAmount,
              goal: proposal.fundingGoal,
              remaining: proposal.fundingGoal - proposal.fundedAmount,
            },
          },
          { status: 400 }
        );
      }

      await prisma.proposal.update({
        where: { id: proposalId },
        data: { status: 'funded' },
      });
      const response = NextResponse.json({ success: true });
      return addRateLimitHeaders(response, request, 'admin:proposals:action', RATE_LIMITS.admin);
    }

    if (action === 'reject') {
      await prisma.proposal.update({
        where: { id: proposalId },
        data: { status: 'rejected' },
      });
      const response = NextResponse.json({ success: true });
      return addRateLimitHeaders(response, request, 'admin:proposals:action', RATE_LIMITS.admin);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error performing action:', error);
    return NextResponse.json({ error: 'Failed to perform action' }, { status: 500 });
  }
}
