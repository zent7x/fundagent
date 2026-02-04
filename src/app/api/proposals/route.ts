/**
 * Proposals API
 *
 * Security features:
 * - Rate limiting (public for GET, write for POST)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION for POST
 * - Sanitized outputs
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import {
  validateBody,
  validateQuery,
  createProposalAuthSchema,
  proposalQuerySchema,
  ValidationError,
  sanitizeString,
} from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';

// GET all proposals
export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'proposals:get', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Validate query parameters
    const { searchParams } = new URL(request.url);
    const { category, status, search } = validateQuery(searchParams, proposalQuerySchema);

    const proposals = await prisma.proposal.findMany({
      where: {
        ...(category && category !== 'All' ? { category } : {}),
        ...(status && status !== 'all' ? { status } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search } },
                { description: { contains: search } },
                { agentName: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        milestones: true,
        fundings: {
          include: {
            backer: true,
          },
        },
        _count: {
          select: { fundings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const response = NextResponse.json(proposals);
    return addRateLimitHeaders(response, request, 'proposals:get', RATE_LIMITS.public);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error fetching proposals:', error);
    return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 });
  }
}

// POST create new proposal
export async function POST(request: NextRequest) {
  // Rate limit check - stricter for write operations
  const rateLimitResponse = checkRateLimit(request, 'proposals:create', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Validate and sanitize request body (now requires auth)
    const data = await validateBody(request, createProposalAuthSchema);

    const {
      auth,
      agentName,
      title,
      description,
      problem,
      solution,
      fundingGoal,
      category,
      timeline,
      agentCapabilities,
      humanNeeds,
      milestones,
    } = data;

    // CRITICAL: Verify wallet signature - proves ownership of the wallet
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'proposal_create'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = auth.walletAddress;

    // Check if wallet is banned
    const bannedWallet = await prisma.bannedWallet.findUnique({
      where: { walletAddress },
    });

    if (bannedWallet) {
      return NextResponse.json(
        {
          error: 'Your wallet has been banned from creating proposals',
          reason: sanitizeString(bannedWallet.reason || ''),
        },
        { status: 403 }
      );
    }

    // Get or create user
    let user = await prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { walletAddress },
      });
    }

    // Check if user is banned or can't create proposals
    if (user.isBanned) {
      return NextResponse.json(
        {
          error: 'Your account has been banned',
          reason: sanitizeString(user.banReason || ''),
        },
        { status: 403 }
      );
    }

    if (!user.canCreateProposals) {
      return NextResponse.json(
        { error: 'You are not allowed to create proposals' },
        { status: 403 }
      );
    }

    // Create proposal with milestones
    const proposal = await prisma.proposal.create({
      data: {
        agentName: sanitizeString(agentName),
        agentWallet: walletAddress,
        title: sanitizeString(title),
        description: sanitizeString(description),
        problem: sanitizeString(problem),
        solution: sanitizeString(solution),
        fundingGoal,
        category,
        timeline: sanitizeString(timeline),
        agentCapabilities: sanitizeString(agentCapabilities || ''),
        humanNeeds: sanitizeString(humanNeeds || ''),
        creatorId: user.id,
        milestones: {
          create: milestones.map((m, index) => ({
            title: sanitizeString(m.title),
            description: sanitizeString(m.description),
            percentage: m.percentage,
            order: index,
          })),
        },
      },
      include: {
        milestones: true,
      },
    });

    const response = NextResponse.json(proposal, { status: 201 });
    return addRateLimitHeaders(response, request, 'proposals:create', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error creating proposal:', error);
    return NextResponse.json({ error: 'Failed to create proposal' }, { status: 500 });
  }
}
