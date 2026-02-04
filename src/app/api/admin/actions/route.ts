/**
 * Admin Actions API
 *
 * Security features:
 * - Rate limiting (admin tier)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION
 * - Role-based access control
 * - Sanitized inputs/outputs
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdmin, isHeadAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import {
  validateBody,
  validateQuery,
  adminActionSchema,
  adminAuthQuerySchema,
  ValidationError,
  sanitizeString,
} from '@/lib/validation';
import { verifyWalletSignature, verifyWalletSignatureAsync } from '@/lib/auth';
import { z } from 'zod';

// POST - Perform admin actions (uses async nonce verification to prevent replay attacks)
export async function POST(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'admin:actions', RATE_LIMITS.admin);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Validate request body
    const data = await validateBody(request, adminActionSchema);
    const { auth, action, targetWallet, targetId, reason } = data;

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      `admin_action_${action}`
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = auth.walletAddress;

    // Authorization check (now we know they actually own this wallet)
    if (!isAdmin(walletAddress)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const sanitizedReason = reason ? sanitizeString(reason) : undefined;

    switch (action) {
      // Ban a user
      case 'ban_user': {
        if (!targetWallet) {
          return NextResponse.json({ error: 'Target wallet required' }, { status: 400 });
        }

        const user = await prisma.user.update({
          where: { walletAddress: targetWallet },
          data: {
            isBanned: true,
            banReason: sanitizedReason || 'Banned by admin',
            bannedAt: new Date(),
            canCreateProposals: false,
          },
        });

        return NextResponse.json({ success: true, user });
      }

      // Unban a user
      case 'unban_user': {
        if (!targetWallet) {
          return NextResponse.json({ error: 'Target wallet required' }, { status: 400 });
        }

        const user = await prisma.user.update({
          where: { walletAddress: targetWallet },
          data: {
            isBanned: false,
            banReason: null,
            bannedAt: null,
            canCreateProposals: true,
          },
        });

        return NextResponse.json({ success: true, user });
      }

      // Ban wallet from creating proposals only
      case 'ban_create': {
        if (!targetWallet) {
          return NextResponse.json({ error: 'Target wallet required' }, { status: 400 });
        }

        // Update user if exists
        const existingUser = await prisma.user.findUnique({
          where: { walletAddress: targetWallet },
        });

        if (existingUser) {
          await prisma.user.update({
            where: { walletAddress: targetWallet },
            data: { canCreateProposals: false },
          });
        }

        // Also add to banned wallets list for new accounts
        await prisma.bannedWallet.upsert({
          where: { walletAddress: targetWallet },
          update: {
            reason: sanitizedReason || 'Banned from creating proposals',
            bannedBy: walletAddress,
          },
          create: {
            walletAddress: targetWallet,
            reason: sanitizedReason || 'Banned from creating proposals',
            bannedBy: walletAddress,
          },
        });

        return NextResponse.json({ success: true });
      }

      // Remove wallet from ban list
      case 'unban_wallet': {
        if (!targetWallet) {
          return NextResponse.json({ error: 'Target wallet required' }, { status: 400 });
        }

        // Update user if exists
        const existingUser = await prisma.user.findUnique({
          where: { walletAddress: targetWallet },
        });

        if (existingUser) {
          await prisma.user.update({
            where: { walletAddress: targetWallet },
            data: { canCreateProposals: true, isBanned: false, banReason: null },
          });
        }

        // Remove from banned wallets
        await prisma.bannedWallet.deleteMany({
          where: { walletAddress: targetWallet },
        });

        return NextResponse.json({ success: true });
      }

      // Close proposal with reason
      case 'close_proposal': {
        if (!targetId) {
          return NextResponse.json({ error: 'Proposal ID required' }, { status: 400 });
        }

        const proposal = await prisma.proposal.update({
          where: { id: targetId },
          data: {
            status: 'closed',
            closeReason: sanitizedReason || 'Closed by admin',
            closedBy: walletAddress,
            closedAt: new Date(),
          },
        });

        // Create update for the proposal
        await prisma.update.create({
          data: {
            content: `Proposal closed by admin. Reason: ${sanitizedReason || 'No reason provided'}`,
            proposalId: targetId,
          },
        });

        return NextResponse.json({ success: true, proposal });
      }

      // Reopen a closed proposal
      case 'reopen_proposal': {
        if (!targetId) {
          return NextResponse.json({ error: 'Proposal ID required' }, { status: 400 });
        }

        const proposal = await prisma.proposal.update({
          where: { id: targetId },
          data: {
            status: 'funding',
            closeReason: null,
            closedBy: null,
            closedAt: null,
          },
        });

        await prisma.update.create({
          data: {
            content: 'Proposal reopened by admin.',
            proposalId: targetId,
          },
        });

        return NextResponse.json({ success: true, proposal });
      }

      // Delete proposal
      case 'delete_proposal': {
        if (!targetId) {
          return NextResponse.json({ error: 'Proposal ID required' }, { status: 400 });
        }

        await prisma.proposal.delete({
          where: { id: targetId },
        });

        return NextResponse.json({ success: true });
      }

      // Cancel proposal and enable refunds
      case 'cancel_proposal': {
        if (!targetId) {
          return NextResponse.json({ error: 'Proposal ID required' }, { status: 400 });
        }

        // Get proposal with fundings
        const proposalToCancel = await prisma.proposal.findUnique({
          where: { id: targetId },
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

        if (!proposalToCancel) {
          return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
        }

        if (proposalToCancel.refundEnabled) {
          return NextResponse.json({ error: 'Proposal already cancelled' }, { status: 400 });
        }

        // Cancel proposal and create refund claims
        await prisma.$transaction(async (tx) => {
          // Update proposal status
          await tx.proposal.update({
            where: { id: targetId },
            data: {
              status: 'cancelled',
              refundEnabled: true,
              refundReason: sanitizedReason || 'Cancelled by admin',
              closedBy: walletAddress,
              closedAt: new Date(),
            },
          });

          // Create refund claims for unreleased fundings
          for (const funding of proposalToCancel.fundings) {
            await tx.refundClaim.create({
              data: {
                fundingId: funding.id,
                proposalId: targetId,
                backerWallet: funding.backer.walletAddress,
                amount: funding.amount,
                status: 'pending',
              },
            });
          }

          // Create update notification
          await tx.update.create({
            data: {
              content: `Proposal cancelled by admin. Refunds are now available. Reason: ${sanitizedReason || 'No reason provided'}`,
              proposalId: targetId,
            },
          });
        });

        return NextResponse.json({
          success: true,
          message: 'Proposal cancelled and refunds enabled',
          refundableCount: proposalToCancel.fundings.length,
          refundableAmount: proposalToCancel.fundings.reduce((sum, f) => sum + f.amount, 0),
        });
      }

      // Make user admin (head admin only)
      case 'make_admin': {
        if (!isHeadAdmin(walletAddress)) {
          return NextResponse.json({ error: 'Head admin access required' }, { status: 403 });
        }

        if (!targetWallet) {
          return NextResponse.json({ error: 'Target wallet required' }, { status: 400 });
        }

        const user = await prisma.user.upsert({
          where: { walletAddress: targetWallet },
          update: { isAdmin: true },
          create: { walletAddress: targetWallet, isAdmin: true },
        });

        return NextResponse.json({ success: true, user });
      }

      // Remove admin (head admin only)
      case 'remove_admin': {
        if (!isHeadAdmin(walletAddress)) {
          return NextResponse.json({ error: 'Head admin access required' }, { status: 403 });
        }

        if (!targetWallet) {
          return NextResponse.json({ error: 'Target wallet required' }, { status: 400 });
        }

        const user = await prisma.user.update({
          where: { walletAddress: targetWallet },
          data: { isAdmin: false },
        });

        return NextResponse.json({ success: true, user });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Admin action error:', error);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}

// GET - Get banned wallets list
export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'admin:actions:get', RATE_LIMITS.admin);
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

    const bannedWallets = await prisma.bannedWallet.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const response = NextResponse.json(bannedWallets);
    return addRateLimitHeaders(response, request, 'admin:actions:get', RATE_LIMITS.admin);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Error fetching banned wallets:', error);
    return NextResponse.json({ error: 'Failed to fetch banned wallets' }, { status: 500 });
  }
}
