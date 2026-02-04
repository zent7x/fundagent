/**
 * Escrow Release API
 *
 * Releases funds from escrow to agent wallet when milestone is completed.
 * Only platform admins can release funds.
 *
 * Security:
 * - Admin wallet signature required
 * - Atomic database operations
 * - Full transaction logging
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders, getClientIP } from '@/lib/rateLimit';
import { verifyWalletSignature } from '@/lib/auth';
import { z } from 'zod';
import { walletAddressSchema } from '@/lib/validation';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { solToLamports, verifyTransactionSuccess } from '@/lib/escrow';

const releaseSchema = z.object({
  auth: z.object({
    walletAddress: walletAddressSchema,
    signature: z.string(),
    message: z.string(),
    timestamp: z.number(),
    nonce: z.string(),
  }),
  proposalId: z.string(),
  milestoneId: z.string(),
  releaseTxSignature: z.string(), // The transaction where admin sent funds to agent
});

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'escrow:release', RATE_LIMITS.sensitive);
  if (rateLimitResponse) return rateLimitResponse;

  const clientIP = getClientIP(request);

  try {
    const body = await request.json();
    const data = releaseSchema.parse(body);

    // Verify admin signature
    const sigResult = verifyWalletSignature(
      data.auth.walletAddress,
      data.auth.signature,
      data.auth.message,
      data.auth.timestamp,
      data.auth.nonce
    );

    if (!sigResult.valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Check if user is admin
    const admin = await prisma.user.findUnique({
      where: { walletAddress: data.auth.walletAddress },
    });

    if (!admin?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get proposal and milestone
    const proposal = await prisma.proposal.findUnique({
      where: { id: data.proposalId },
      include: { milestones: true, fundings: true },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // SECURITY: Check proposal status before releasing funds
    if (proposal.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot release funds for cancelled proposal' }, { status: 400 });
    }

    const milestone = proposal.milestones.find(m => m.id === data.milestoneId);
    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    if (milestone.status === 'completed') {
      return NextResponse.json({ error: 'Milestone already completed' }, { status: 400 });
    }

    // SECURITY: Verify milestone is in correct state (should be in_progress, verified by backers)
    if (milestone.status !== 'in_progress') {
      return NextResponse.json(
        { error: `Cannot release funds for milestone in '${milestone.status}' status. Must be 'in_progress'.` },
        { status: 400 }
      );
    }

    // Calculate release amount
    const releaseAmount = (proposal.fundingGoal * milestone.percentage) / 100;

    // SECURITY: Verify the transaction signature on-chain before accepting
    const txVerification = await verifyTransactionSuccess(
      data.releaseTxSignature,
      proposal.agentWallet,
      releaseAmount
    );

    if (!txVerification.valid) {
      return NextResponse.json(
        { error: 'Transaction verification failed', details: txVerification.error },
        { status: 400 }
      );
    }

    // Atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update milestone status
      await tx.milestone.update({
        where: { id: data.milestoneId },
        data: { status: 'completed' },
      });

      // Update escrow account
      const escrow = await tx.escrowAccount.findUnique({
        where: { proposalId: data.proposalId },
      });

      if (escrow) {
        await tx.escrowAccount.update({
          where: { proposalId: data.proposalId },
          data: { totalReleased: { increment: releaseAmount } },
        });
      }

      // Update funding records - track total milestone percentage completed
      // SECURITY FIX: Calculate based on milestone percentages, not accumulated amounts
      // to avoid exponential accumulation errors
      const heldFundings = proposal.fundings.filter(f => f.status === 'held');

      // Calculate total percentage of milestones completed after this one
      const completedMilestones = await tx.milestone.findMany({
        where: { proposalId: data.proposalId, status: 'completed' },
      });
      const totalPercentageReleased = completedMilestones.reduce((sum, m) => sum + m.percentage, 0);

      for (const funding of heldFundings) {
        // SECURITY: Prevent division by zero
        if (proposal.fundedAmount <= 0) continue;

        // Mark as released when 100% of milestones are completed (99% threshold for rounding)
        const shouldMarkReleased = totalPercentageReleased >= 99;

        if (shouldMarkReleased) {
          await tx.funding.update({
            where: { id: funding.id },
            data: { status: 'released', releasedAt: new Date() },
          });
        }
      }

      // Log the release transaction
      await tx.transactionLog.create({
        data: {
          txSignature: data.releaseTxSignature,
          txType: 'milestone_release',
          senderWallet: proposal.escrowAddress || 'platform',
          recipientWallet: proposal.agentWallet,
          amountSOL: releaseAmount,
          amountLamports: BigInt(solToLamports(releaseAmount)),
          verified: true,
          verifiedAt: new Date(),
          proposalId: data.proposalId,
          milestoneId: data.milestoneId,
          ipAddress: clientIP,
        },
      });

      // Create update
      await tx.update.create({
        data: {
          content: `Milestone "${milestone.title}" completed! ${releaseAmount.toFixed(2)} SOL released to agent.`,
          proposalId: data.proposalId,
        },
      });

      // Check if all milestones completed
      const allMilestones = await tx.milestone.findMany({
        where: { proposalId: data.proposalId },
      });
      const allCompleted = allMilestones.every(m => m.status === 'completed');

      if (allCompleted) {
        await tx.proposal.update({
          where: { id: data.proposalId },
          data: { status: 'completed' },
        });

        if (escrow) {
          await tx.escrowAccount.update({
            where: { proposalId: data.proposalId },
            data: { status: 'completed' },
          });
        }
      }

      return { releaseAmount, allCompleted };
    });

    console.log(`[Escrow] Release SUCCESS:`, {
      proposalId: data.proposalId,
      milestoneId: data.milestoneId,
      amount: result.releaseAmount,
      allCompleted: result.allCompleted,
      admin: data.auth.walletAddress.slice(0, 8) + '...',
    });

    const response = NextResponse.json({
      success: true,
      released: result.releaseAmount,
      allCompleted: result.allCompleted,
    });

    return addRateLimitHeaders(response, request, 'escrow:release', RATE_LIMITS.sensitive);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 });
    }
    console.error('[Escrow] Release error:', error);
    return NextResponse.json({ error: 'Failed to release funds' }, { status: 500 });
  }
}
