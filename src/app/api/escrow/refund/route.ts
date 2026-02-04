/**
 * Escrow Refund API
 *
 * Refunds funds from escrow back to backers when project is cancelled.
 * Only platform admins can initiate refunds.
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

const refundSchema = z.object({
  auth: z.object({
    walletAddress: walletAddressSchema,
    signature: z.string(),
    message: z.string(),
    timestamp: z.number(),
    nonce: z.string(),
  }),
  proposalId: z.string(),
  fundingId: z.string(),
  refundTxSignature: z.string(), // The transaction where admin sent refund to backer
  reason: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'escrow:refund', RATE_LIMITS.sensitive);
  if (rateLimitResponse) return rateLimitResponse;

  const clientIP = getClientIP(request);

  try {
    const body = await request.json();
    const data = refundSchema.parse(body);

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

    // Get funding record
    const funding = await prisma.funding.findUnique({
      where: { id: data.fundingId },
      include: {
        backer: true,
        proposal: true,
      },
    });

    if (!funding) {
      return NextResponse.json({ error: 'Funding not found' }, { status: 404 });
    }

    if (funding.proposalId !== data.proposalId) {
      return NextResponse.json({ error: 'Funding does not belong to this proposal' }, { status: 400 });
    }

    if (funding.status === 'refunded') {
      return NextResponse.json({ error: 'Funding already refunded' }, { status: 400 });
    }

    if (funding.status === 'released') {
      return NextResponse.json({ error: 'Funds already released to agent, cannot refund' }, { status: 400 });
    }

    // SECURITY: Verify the provided transaction signature on-chain before recording
    const txVerification = await verifyTransactionSuccess(
      data.refundTxSignature,
      funding.backer.walletAddress,
      funding.amount
    );

    if (!txVerification.valid) {
      return NextResponse.json(
        { error: 'Transaction verification failed', details: txVerification.error },
        { status: 400 }
      );
    }

    // Atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update funding status
      await tx.funding.update({
        where: { id: data.fundingId },
        data: {
          status: 'refunded',
          refundedAt: new Date(),
          refundTxSignature: data.refundTxSignature,
        },
      });

      // Update escrow account
      const escrow = await tx.escrowAccount.findUnique({
        where: { proposalId: data.proposalId },
      });

      if (escrow) {
        await tx.escrowAccount.update({
          where: { proposalId: data.proposalId },
          data: { totalRefunded: { increment: funding.amount } },
        });
      }

      // Update proposal funded amount
      await tx.proposal.update({
        where: { id: data.proposalId },
        data: {
          fundedAmount: { decrement: funding.amount },
        },
      });

      // Log the refund transaction
      await tx.transactionLog.create({
        data: {
          txSignature: data.refundTxSignature,
          txType: 'refund',
          senderWallet: funding.proposal.escrowAddress || 'platform',
          recipientWallet: funding.backer.walletAddress,
          amountSOL: funding.amount,
          amountLamports: BigInt(solToLamports(funding.amount)),
          verified: true,
          verifiedAt: new Date(),
          proposalId: data.proposalId,
          fundingId: data.fundingId,
          ipAddress: clientIP,
        },
      });

      // Create update
      await tx.update.create({
        data: {
          content: `Refund processed: ${funding.amount.toFixed(4)} SOL returned to backer ${funding.backer.walletAddress.slice(0, 8)}...`,
          proposalId: data.proposalId,
        },
      });

      return { refundedAmount: funding.amount, backerWallet: funding.backer.walletAddress };
    });

    console.log(`[Escrow] Refund SUCCESS:`, {
      proposalId: data.proposalId,
      fundingId: data.fundingId,
      amount: result.refundedAmount,
      backer: result.backerWallet.slice(0, 8) + '...',
      admin: data.auth.walletAddress.slice(0, 8) + '...',
      reason: data.reason,
    });

    const response = NextResponse.json({
      success: true,
      refunded: result.refundedAmount,
      backer: result.backerWallet,
    });

    return addRateLimitHeaders(response, request, 'escrow:refund', RATE_LIMITS.sensitive);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 });
    }
    console.error('[Escrow] Refund error:', error);
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 });
  }
}

// GET - List refundable fundings for a proposal
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'escrow:refund-list', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const proposalId = searchParams.get('proposalId');

    if (!proposalId) {
      return NextResponse.json({ error: 'proposalId required' }, { status: 400 });
    }

    const fundings = await prisma.funding.findMany({
      where: {
        proposalId,
        status: 'held', // Only held funds can be refunded
      },
      include: {
        backer: {
          select: { walletAddress: true },
        },
      },
    });

    const response = NextResponse.json({
      fundings: fundings.map(f => ({
        id: f.id,
        amount: f.amount,
        backerWallet: f.backer.walletAddress,
        createdAt: f.createdAt,
      })),
      totalRefundable: fundings.reduce((sum, f) => sum + f.amount, 0),
    });

    return addRateLimitHeaders(response, request, 'escrow:refund-list', RATE_LIMITS.public);
  } catch (error) {
    console.error('[Escrow] Refund list error:', error);
    return NextResponse.json({ error: 'Failed to list refundable fundings' }, { status: 500 });
  }
}
