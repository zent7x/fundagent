/**
 * Release Funds API
 *
 * Allows backers to release their escrowed funds to the agent
 * when they are satisfied with the work.
 *
 * Security:
 * - Rate limiting
 * - Wallet signature verification (async)
 * - Only backers can release their own funds
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, getClientIP } from '@/lib/rateLimit';
import { validateBody, ValidationError } from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';
import { releaseToAgent, isEscrowConfigured, verifyTransactionSuccess } from '@/lib/escrow';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { solToLamports } from '@/lib/escrow';
import { z } from 'zod';

// Auth schema for release request
const releaseAuthSchema = z.object({
  auth: z.object({
    walletAddress: z.string().min(32).max(44),
    signature: z.string().min(80).max(150),
    message: z.string().min(1).max(1000),
    timestamp: z.number().int().positive(),
    nonce: z.string().min(40).max(50),
  }),
  fundingId: z.string().min(1).max(50).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, 'proposals:release', RATE_LIMITS.sensitive);
  if (rateLimitResponse) return rateLimitResponse;

  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent');

  try {
    const { id: proposalId } = await params;
    const data = await validateBody(request, releaseAuthSchema);
    const { auth, fundingId } = data;

    // Verify wallet signature
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'release_funds'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    // Check escrow is configured
    if (!isEscrowConfigured()) {
      return NextResponse.json(
        { error: 'Escrow not configured' },
        { status: 400 }
      );
    }

    // Get proposal
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // SECURITY: Cannot release funds for cancelled proposals
    if (proposal.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot release funds for cancelled proposal' },
        { status: 400 }
      );
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Find the backer's funding record(s)
    const whereClause: any = {
      proposalId,
      backer: { walletAddress: auth.walletAddress },
      released: false,
      status: 'held',
    };

    if (fundingId) {
      whereClause.id = fundingId;
    }

    const fundings = await prisma.funding.findMany({
      where: whereClause,
      include: { backer: true },
    });

    if (fundings.length === 0) {
      return NextResponse.json(
        { error: 'No unreleased funds found for this wallet' },
        { status: 404 }
      );
    }

    // SECURITY: Process releases with atomic transaction to prevent race conditions
    // Each release is processed individually with full transaction isolation
    const results = [];
    for (const funding of fundings) {
      try {
        // Use atomic transaction to prevent race conditions:
        // 1. Re-check the funding status inside the transaction
        // 2. Mark as 'processing' to prevent concurrent releases
        // 3. Execute the Solana transfer
        // 4. Update to 'released' on success
        const result = await prisma.$transaction(async (tx) => {
          // Re-fetch and lock the funding record
          const currentFunding = await tx.funding.findUnique({
            where: { id: funding.id },
          });

          // Check if already released or being processed (race condition protection)
          if (!currentFunding || currentFunding.released || currentFunding.status !== 'held') {
            throw new Error('Funding already released or being processed');
          }

          // Mark as processing to prevent concurrent attempts
          await tx.funding.update({
            where: { id: funding.id },
            data: { status: 'processing' },
          });

          // Execute the Solana transfer (outside of DB transaction scope for the actual transfer)
          // Note: We mark as processing first, then do the transfer
          return { proceed: true, amount: currentFunding.amount };
        });

        if (!result.proceed) {
          results.push({
            fundingId: funding.id,
            amount: funding.amount,
            success: false,
            error: 'Funding already processed',
          });
          continue;
        }

        // Execute Solana transfer
        const txSignature = await releaseToAgent(proposal.agentWallet, result.amount);

        // SECURITY: Verify transaction succeeded on-chain before updating database
        const txVerification = await verifyTransactionSuccess(
          txSignature,
          proposal.agentWallet,
          result.amount
        );

        if (!txVerification.valid) {
          throw new Error(`Transaction verification failed: ${txVerification.error}`);
        }

        // Complete the release in database
        await prisma.$transaction(async (tx) => {
          await tx.funding.update({
            where: { id: funding.id },
            data: {
              released: true,
              releasedAt: new Date(),
              releaseTxSignature: txSignature,
              status: 'released',
            },
          });

          // Update escrow account tracking
          await tx.escrowAccount.update({
            where: { proposalId },
            data: {
              totalReleased: { increment: result.amount },
            },
          });

          // Log the transaction
          await tx.transactionLog.create({
            data: {
              txSignature,
              txType: 'release',
              senderWallet: process.env.NEXT_PUBLIC_ESCROW_WALLET || '',
              recipientWallet: proposal.agentWallet,
              amountSOL: result.amount,
              amountLamports: BigInt(solToLamports(result.amount)),
              verified: true,
              verifiedAt: new Date(),
              proposalId,
              fundingId: funding.id,
              ipAddress: clientIP,
              userAgent,
            },
          });
        });

        results.push({
          fundingId: funding.id,
          amount: result.amount,
          txSignature,
          success: true,
        });
      } catch (error: any) {
        console.error(`[Release] Failed to release funding ${funding.id}:`, error);

        // Revert status back to 'held' if transfer failed
        try {
          await prisma.funding.update({
            where: { id: funding.id },
            data: { status: 'held' },
          });
        } catch {
          // Log but don't throw - status will need manual cleanup
          console.error(`[Release] Failed to revert status for funding ${funding.id}`);
        }

        results.push({
          fundingId: funding.id,
          amount: funding.amount,
          success: false,
          error: error.message || 'Release failed',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalReleased = results.filter(r => r.success).reduce((sum, r) => sum + r.amount, 0);

    return NextResponse.json({
      success: successCount > 0,
      message: `Released ${totalReleased} SOL to agent`,
      results,
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[Release] Error:', error);
    return NextResponse.json({ error: 'Failed to release funds' }, { status: 500 });
  }
}
