/**
 * Fund Proposal API
 *
 * Security features:
 * - Rate limiting (sensitive tier - financial transactions)
 * - Schema-based input validation
 * - FULL TRANSACTION VERIFICATION (amount, sender, recipient)
 * - ATOMIC DATABASE OPERATIONS (prevents race conditions)
 * - COMPREHENSIVE TRANSACTION LOGGING
 * - Double-spend prevention via unique constraint
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyFundingTransaction } from '@/lib/solana';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders, getClientIP } from '@/lib/rateLimit';
import {
  validateBody,
  fundProposalSchema,
  proposalIdSchema,
  ValidationError,
} from '@/lib/validation';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PLATFORM_ESCROW_WALLET, isEscrowConfigured, solToLamports } from '@/lib/escrow';

// POST fund a proposal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check - sensitive for financial transactions
  const rateLimitResponse = checkRateLimit(request, 'proposals:fund', RATE_LIMITS.sensitive);
  if (rateLimitResponse) return rateLimitResponse;

  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent');

  try {
    const { id } = await params;

    // Validate the proposal ID
    const validatedId = proposalIdSchema.parse({ id });

    // Validate request body
    const data = await validateBody(request, fundProposalSchema);
    const { walletAddress, amount, txSignature } = data;

    // Log incoming transaction attempt
    console.log(`[Fund] Incoming funding request:`, {
      proposalId: validatedId.id,
      wallet: walletAddress.slice(0, 8) + '...',
      amount,
      txSignature: txSignature.slice(0, 16) + '...',
      ip: clientIP,
    });

    // Get proposal FIRST to get the agent wallet for verification
    const proposal = await prisma.proposal.findUnique({
      where: { id: validatedId.id },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Check if proposal is still accepting funding
    if (proposal.status !== 'funding') {
      return NextResponse.json(
        { error: 'Proposal is not accepting funding' },
        { status: 400 }
      );
    }

    // Determine recipient wallet - escrow if configured, otherwise agent wallet (legacy)
    const escrowConfigured = isEscrowConfigured();
    const recipientWallet = escrowConfigured
      ? PLATFORM_ESCROW_WALLET.toBase58()
      : proposal.agentWallet;

    console.log(`[Fund] Escrow mode: ${escrowConfigured ? 'ENABLED' : 'DISABLED (direct to agent)'}`);

    // CRITICAL: Verify transaction with FULL DETAILS
    // - Checks sender matches claimed wallet
    // - Checks recipient matches escrow wallet (or agent wallet if escrow not configured)
    // - Checks amount matches claimed amount
    const verification = await verifyFundingTransaction(
      txSignature,
      walletAddress,    // Expected sender
      recipientWallet,  // Expected recipient (escrow or agent wallet)
      amount            // Expected amount in SOL
    );

    if (!verification.valid) {
      console.warn(`[Fund] Transaction verification FAILED:`, {
        signature: txSignature.slice(0, 16) + '...',
        error: verification.error,
        claimedSender: walletAddress.slice(0, 8) + '...',
        claimedAmount: amount,
        actualSender: verification.sender?.slice(0, 8),
        actualAmount: verification.actualAmount,
        ip: clientIP,
      });

      // Log failed verification to TransactionLog
      try {
        await prisma.transactionLog.create({
          data: {
            txSignature,
            txType: 'funding',
            senderWallet: walletAddress,
            recipientWallet: recipientWallet,
            amountSOL: amount,
            amountLamports: BigInt(solToLamports(amount)),
            verified: false,
            verificationError: verification.error,
            proposalId: validatedId.id,
            ipAddress: clientIP,
            userAgent,
          },
        });
      } catch (logError) {
        console.error('[Fund] Failed to create transaction log:', logError);
      }

      return NextResponse.json(
        { error: 'Transaction verification failed', details: verification.error },
        { status: 400 }
      );
    }

    const verifiedAmount = verification.actualAmount || amount;

    // ATOMIC TRANSACTION: Create funding, update proposal, and log - all or nothing
    // This prevents race conditions and ensures data consistency
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Check for duplicate transaction (unique constraint will also catch this)
        const existingFunding = await tx.funding.findUnique({
          where: { txSignature },
        });

        if (existingFunding) {
          throw new Error('DUPLICATE_TX');
        }

        // Get or create backer user
        let backer = await tx.user.findUnique({
          where: { walletAddress },
        });

        if (!backer) {
          backer = await tx.user.create({
            data: { walletAddress },
          });
        }

        if (backer.isBanned) {
          throw new Error('USER_BANNED');
        }

        // Re-check proposal status in transaction
        const currentProposal = await tx.proposal.findUnique({
          where: { id: validatedId.id },
        });

        if (!currentProposal || currentProposal.status !== 'funding') {
          throw new Error('PROPOSAL_NOT_FUNDING');
        }

        // Create funding record with escrow status
        const funding = await tx.funding.create({
          data: {
            amount: verifiedAmount,
            txSignature,
            backerId: backer.id,
            proposalId: validatedId.id,
            status: escrowConfigured ? 'held' : 'released', // held in escrow or released directly
          },
        });

        // Update or create escrow account tracking
        if (escrowConfigured) {
          await tx.escrowAccount.upsert({
            where: { proposalId: validatedId.id },
            create: {
              proposalId: validatedId.id,
              totalDeposited: verifiedAmount,
              status: 'active',
            },
            update: {
              totalDeposited: { increment: verifiedAmount },
            },
          });
        }

        // Update proposal funded amount
        const newFundedAmount = currentProposal.fundedAmount + verifiedAmount;
        const newStatus = newFundedAmount >= currentProposal.fundingGoal ? 'funded' : 'funding';

        await tx.proposal.update({
          where: { id: validatedId.id },
          data: {
            fundedAmount: newFundedAmount,
            status: newStatus,
            escrowAddress: escrowConfigured ? recipientWallet : null,
          },
        });

        // Create transaction log
        await tx.transactionLog.create({
          data: {
            txSignature,
            txType: 'funding',
            senderWallet: walletAddress,
            recipientWallet: recipientWallet,
            amountSOL: verifiedAmount,
            amountLamports: BigInt(solToLamports(verifiedAmount)),
            verified: true,
            verifiedAt: new Date(),
            proposalId: validatedId.id,
            fundingId: funding.id,
            ipAddress: clientIP,
            userAgent,
          },
        });

        if (newStatus === 'funded') {
          await tx.update.create({
            data: {
              content: escrowConfigured
                ? 'Project successfully funded! Funds are held in escrow until milestones are completed.'
                : 'Project successfully funded! Development will begin shortly.',
              proposalId: validatedId.id,
            },
          });
        }

        return { funding, newFundedAmount, newStatus, escrowConfigured };
      });

      console.log(`[Fund] SUCCESS:`, {
        proposalId: validatedId.id,
        fundingId: result.funding.id,
        amount: verifiedAmount,
        newTotal: result.newFundedAmount,
        status: result.newStatus,
        escrowEnabled: result.escrowConfigured,
      });

      const response = NextResponse.json({
        success: true,
        funding: result.funding,
        newFundedAmount: result.newFundedAmount,
        status: result.newStatus,
        escrow: result.escrowConfigured ? {
          enabled: true,
          message: 'Funds held in escrow until milestones completed',
        } : {
          enabled: false,
          message: 'Funds sent directly to agent',
        },
      });
      return addRateLimitHeaders(response, request, 'proposals:fund', RATE_LIMITS.sensitive);

    } catch (txError: any) {
      if (txError.message === 'DUPLICATE_TX') {
        console.warn(`[Fund] Duplicate transaction rejected:`, { txSignature: txSignature.slice(0, 16) + '...', ip: clientIP });
        return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
      }
      if (txError.message === 'USER_BANNED') {
        return NextResponse.json({ error: 'Your account has been banned' }, { status: 403 });
      }
      if (txError.message === 'PROPOSAL_NOT_FUNDING') {
        return NextResponse.json({ error: 'Proposal is not accepting funding' }, { status: 400 });
      }
      if (txError.code === 'P2002' && txError.meta?.target?.includes('txSignature')) {
        console.warn(`[Fund] Duplicate caught by constraint:`, { txSignature: txSignature.slice(0, 16) + '...', ip: clientIP });
        return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
      }
      throw txError;
    }

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[Fund] Error processing funding:', error);
    return NextResponse.json({ error: 'Failed to process funding' }, { status: 500 });
  }
}
