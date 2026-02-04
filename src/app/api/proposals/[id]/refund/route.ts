/**
 * Refund API
 *
 * POST - Admin enables refunds for a cancelled proposal
 * PATCH - Backer claims their refund
 *
 * Security:
 * - Rate limiting
 * - Wallet signature verification
 * - Admin check for enabling refunds
 * - Backer verification for claiming
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, getClientIP } from '@/lib/rateLimit';
import { validateBody, ValidationError, safeString } from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';
import { refundToBacker, isEscrowConfigured, verifyTransactionSuccess } from '@/lib/escrow';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { solToLamports } from '@/lib/escrow';
import { z } from 'zod';

// Auth schema
const authSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  signature: z.string().min(80).max(150),
  message: z.string().min(1).max(1000),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(40).max(50),
});

// Enable refund schema (admin)
const enableRefundSchema = z.object({
  auth: authSchema,
  reason: z.string().max(500).optional(),
}).strict();

// Claim refund schema (backer)
const claimRefundSchema = z.object({
  auth: authSchema,
  fundingId: z.string().min(1).max(50).optional(),
}).strict();

// POST - Admin enables refunds
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'proposals:refund:enable', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: proposalId } = await params;
    const data = await validateBody(request, enableRefundSchema);
    const { auth, reason } = data;

    // Verify admin signature
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'enable_refunds'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    // Check admin
    if (!isAdmin(auth.walletAddress)) {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    // Get proposal
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        fundings: {
          where: {
            status: 'held',
            released: false,
          },
          include: { backer: true },
        },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.refundEnabled) {
      return NextResponse.json({ error: 'Refunds already enabled' }, { status: 400 });
    }

    // Enable refunds and create RefundClaim records
    await prisma.$transaction(async (tx) => {
      // Update proposal
      await tx.proposal.update({
        where: { id: proposalId },
        data: {
          refundEnabled: true,
          refundReason: reason || 'Proposal cancelled',
          status: 'cancelled',
        },
      });

      // Create refund claims for each unreleased funding
      for (const funding of proposal.fundings) {
        await tx.refundClaim.create({
          data: {
            fundingId: funding.id,
            proposalId,
            backerWallet: funding.backer.walletAddress,
            amount: funding.amount,
            status: 'pending',
          },
        });
      }

      // Create update
      await tx.update.create({
        data: {
          content: `Proposal cancelled. Refunds enabled for all backers. Reason: ${reason || 'No reason provided'}`,
          proposalId,
        },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Refunds enabled',
      refundableCount: proposal.fundings.length,
      refundableAmount: proposal.fundings.reduce((sum, f) => sum + f.amount, 0),
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[Refund] Enable error:', error);
    return NextResponse.json({ error: 'Failed to enable refunds' }, { status: 500 });
  }
}

// PATCH - Backer claims refund
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'proposals:refund:claim', RATE_LIMITS.sensitive);
  if (rateLimitResponse) return rateLimitResponse;

  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent');

  try {
    const { id: proposalId } = await params;
    const data = await validateBody(request, claimRefundSchema);
    const { auth, fundingId } = data;

    // Verify backer signature
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'claim_refund'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    // Check escrow configured
    if (!isEscrowConfigured()) {
      return NextResponse.json({ error: 'Escrow not configured' }, { status: 400 });
    }

    // Get proposal
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (!proposal.refundEnabled) {
      return NextResponse.json({ error: 'Refunds not enabled for this proposal' }, { status: 400 });
    }

    // Find pending refund claims for this backer
    const whereClause: any = {
      proposalId,
      backerWallet: auth.walletAddress,
      status: 'pending',
    };

    if (fundingId) {
      whereClause.fundingId = fundingId;
    }

    const claims = await prisma.refundClaim.findMany({
      where: whereClause,
    });

    if (claims.length === 0) {
      return NextResponse.json(
        { error: 'No pending refunds found' },
        { status: 404 }
      );
    }

    // SECURITY: Process refunds with atomic transaction to prevent race conditions
    const results = [];
    for (const claim of claims) {
      try {
        // Use atomic transaction to prevent race conditions
        const result = await prisma.$transaction(async (tx) => {
          // Re-fetch and lock the claim record
          const currentClaim = await tx.refundClaim.findUnique({
            where: { id: claim.id },
          });

          // Check if already processed (race condition protection)
          if (!currentClaim || currentClaim.status !== 'pending') {
            throw new Error('Refund claim already processed or being processed');
          }

          // Mark as processing to prevent concurrent attempts
          await tx.refundClaim.update({
            where: { id: claim.id },
            data: { status: 'processing' },
          });

          return { proceed: true, amount: currentClaim.amount, fundingId: currentClaim.fundingId };
        });

        if (!result.proceed) {
          results.push({
            claimId: claim.id,
            amount: claim.amount,
            success: false,
            error: 'Refund already processed',
          });
          continue;
        }

        // Execute Solana refund transfer
        const txSignature = await refundToBacker(auth.walletAddress, result.amount);

        // SECURITY: Verify transaction succeeded on-chain before updating database
        const txVerification = await verifyTransactionSuccess(
          txSignature,
          auth.walletAddress,
          result.amount
        );

        if (!txVerification.valid) {
          throw new Error(`Transaction verification failed: ${txVerification.error}`);
        }

        // Complete the refund in database
        await prisma.$transaction(async (tx) => {
          // Update refund claim
          await tx.refundClaim.update({
            where: { id: claim.id },
            data: {
              status: 'completed',
              txSignature,
              processedAt: new Date(),
            },
          });

          // Update funding record
          await tx.funding.update({
            where: { id: result.fundingId },
            data: {
              status: 'refunded',
              refundedAt: new Date(),
              refundTxSignature: txSignature,
            },
          });

          // Update escrow account
          await tx.escrowAccount.update({
            where: { proposalId },
            data: {
              totalRefunded: { increment: result.amount },
            },
          });

          // Log transaction
          await tx.transactionLog.create({
            data: {
              txSignature,
              txType: 'refund',
              senderWallet: process.env.NEXT_PUBLIC_ESCROW_WALLET || '',
              recipientWallet: auth.walletAddress,
              amountSOL: result.amount,
              amountLamports: BigInt(solToLamports(result.amount)),
              verified: true,
              verifiedAt: new Date(),
              proposalId,
              fundingId: result.fundingId,
              ipAddress: clientIP,
              userAgent,
            },
          });
        });

        results.push({
          claimId: claim.id,
          amount: result.amount,
          txSignature,
          success: true,
        });
      } catch (error: any) {
        console.error(`[Refund] Failed to process claim ${claim.id}:`, error);

        // Revert status back to 'pending' if transfer failed
        try {
          await prisma.refundClaim.update({
            where: { id: claim.id },
            data: { status: 'pending' },
          });
        } catch {
          // Log but don't throw - status will need manual cleanup
          console.error(`[Refund] Failed to revert status for claim ${claim.id}`);
        }

        results.push({
          claimId: claim.id,
          amount: claim.amount,
          success: false,
          error: error.message || 'Refund failed',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalRefunded = results.filter(r => r.success).reduce((sum, r) => sum + r.amount, 0);

    return NextResponse.json({
      success: successCount > 0,
      message: `Refunded ${totalRefunded} SOL`,
      results,
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[Refund] Claim error:', error);
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 });
  }
}
