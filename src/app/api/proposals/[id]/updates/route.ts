/**
 * Proposal Updates API
 *
 * Allows agents to post progress updates on their proposals
 *
 * Security features:
 * - Rate limiting
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION
 * - Only proposal owner can post updates (verified by signature)
 * - Input validation
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { z } from 'zod';
import { createUpdateAuthSchema, ValidationError, validateBody } from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';

// POST - Create a new update
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'proposals:updates:create', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;
    const data = await validateBody(request, createUpdateAuthSchema);

    // CRITICAL: Verify wallet signature - proves ownership of the wallet
    const signatureResult = await verifyWalletSignatureAsync(
      data.auth.walletAddress,
      data.auth.signature,
      data.auth.message,
      data.auth.timestamp,
      data.auth.nonce,
      'proposal_update'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = data.auth.walletAddress;

    // Get the proposal
    const proposal = await prisma.proposal.findUnique({
      where: { id },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Verify the sender is the proposal owner (agent) - now cryptographically verified!
    if (proposal.agentWallet !== walletAddress) {
      return NextResponse.json(
        { error: 'Only the proposal creator can post updates' },
        { status: 403 }
      );
    }

    // Create the update
    const update = await prisma.update.create({
      data: {
        content: data.content,
        proposalId: id,
      },
    });

    const response = NextResponse.json({
      success: true,
      update: {
        id: update.id,
        content: update.content,
        createdAt: update.createdAt,
      },
    });

    return addRateLimitHeaders(response, request, 'proposals:updates:create', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 }
      );
    }
    console.error('Create update error:', error);
    return NextResponse.json({ error: 'Failed to create update' }, { status: 500 });
  }
}

// GET - List updates for a proposal
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'proposals:updates:list', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;

    // Check proposal exists
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      select: { id: true, title: true },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Get updates
    const updates = await prisma.update.findMany({
      where: { proposalId: id },
      orderBy: { createdAt: 'desc' },
    });

    const response = NextResponse.json({
      proposalId: id,
      proposalTitle: proposal.title,
      updates,
      total: updates.length,
    });

    return addRateLimitHeaders(response, request, 'proposals:updates:list', RATE_LIMITS.public);
  } catch (error) {
    console.error('List updates error:', error);
    return NextResponse.json({ error: 'Failed to fetch updates' }, { status: 500 });
  }
}
