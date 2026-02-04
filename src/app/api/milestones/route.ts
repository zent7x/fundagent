/**
 * Milestones API
 *
 * Security features:
 * - Rate limiting (public for GET, write for POST/PATCH)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION for write operations
 * - Authorization checks
 * - Sanitized inputs
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import {
  validateBody,
  validateQuery,
  milestoneQuerySchema,
  submitMilestoneAuthSchema,
  verifyMilestoneAuthSchema,
  ValidationError,
  sanitizeString,
} from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';

// GET milestones for a proposal
export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'milestones:get', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const { proposalId } = validateQuery(searchParams, milestoneQuerySchema);

    const milestones = await prisma.milestone.findMany({
      where: { proposalId },
      orderBy: { order: 'asc' },
    });

    const response = NextResponse.json(milestones);
    return addRateLimitHeaders(response, request, 'milestones:get', RATE_LIMITS.public);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error fetching milestones:', error);
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 });
  }
}

// POST - Submit milestone for verification
export async function POST(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'milestones:submit', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const data = await validateBody(request, submitMilestoneAuthSchema);
    const { auth, milestoneId, deliverables } = data;

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'milestone_submit'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = auth.walletAddress;

    // Get milestone
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { proposal: true },
    });

    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    // Verify the submitter is the agent (now we know they actually own this wallet)
    if (milestone.proposal.agentWallet !== walletAddress) {
      return NextResponse.json({ error: 'Only the agent can submit milestones' }, { status: 403 });
    }

    // Update milestone status to in_progress (pending verification)
    const updated = await prisma.milestone.update({
      where: { id: milestoneId },
      data: { status: 'in_progress' },
    });

    // Create an update for the proposal
    await prisma.update.create({
      data: {
        content: `Milestone "${sanitizeString(milestone.title)}" submitted for verification. Deliverables: ${sanitizeString(deliverables)}`,
        proposalId: milestone.proposalId,
      },
    });

    const response = NextResponse.json(updated);
    return addRateLimitHeaders(response, request, 'milestones:submit', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error submitting milestone:', error);
    return NextResponse.json({ error: 'Failed to submit milestone' }, { status: 500 });
  }
}

// PATCH - Verify/complete a milestone (backer verification)
export async function PATCH(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'milestones:verify', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const data = await validateBody(request, verifyMilestoneAuthSchema);
    const { auth, milestoneId, action } = data;

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'milestone_verify'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = auth.walletAddress;

    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        proposal: {
          include: {
            fundings: {
              include: {
                backer: true,
              },
            },
          },
        },
      },
    });

    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    // Verify the caller is a backer of this proposal (now we know they own the wallet)
    const backerFunding = milestone.proposal.fundings.filter(
      (f) => f.backer.walletAddress === walletAddress
    );

    if (backerFunding.length === 0) {
      return NextResponse.json({ error: 'Only backers can verify milestones' }, { status: 403 });
    }

    // SECURITY: Stake-weighted voting with consensus requirements
    // Requires MAJORITY stake (>50%) to complete milestones, preventing single-backer attacks
    const backerTotalContribution = backerFunding.reduce((sum, f) => sum + f.amount, 0);
    const totalFunded = milestone.proposal.fundings.reduce((sum, f) => sum + f.amount, 0);

    // SECURITY: Prevent division by zero
    if (totalFunded <= 0) {
      return NextResponse.json(
        { error: 'No funding recorded for this proposal' },
        { status: 400 }
      );
    }

    const backerStakePercentage = (backerTotalContribution / totalFunded) * 100;

    // For completion: require >50% stake (majority) to prevent single-backer attacks
    // For rejection: require 10% stake (allows minority protection)
    const MAJORITY_STAKE_PERCENTAGE = 50; // >50% required to complete
    const MINIMUM_STAKE_PERCENTAGE = 10; // 10% minimum to reject

    // SECURITY: Reject if stake <= 50% (requires MORE than 50% to complete)
    // 50.0% -> rejected, 50.1% -> passes (correct for majority requirement)
    if (action === 'complete' && backerStakePercentage <= MAJORITY_STAKE_PERCENTAGE) {
      return NextResponse.json(
        {
          error: 'Insufficient stake to complete milestone',
          details: `You have ${backerStakePercentage.toFixed(1)}% stake. More than ${MAJORITY_STAKE_PERCENTAGE}% required to complete milestones. Consider coordinating with other backers.`,
          stake: {
            yourContribution: backerTotalContribution,
            totalFunded,
            yourPercentage: backerStakePercentage,
            requiredPercentage: MAJORITY_STAKE_PERCENTAGE,
          },
        },
        { status: 403 }
      );
    }

    if (action === 'reject' && backerStakePercentage < MINIMUM_STAKE_PERCENTAGE) {
      return NextResponse.json(
        {
          error: 'Insufficient stake to reject milestone',
          details: `You have ${backerStakePercentage.toFixed(1)}% stake. Minimum ${MINIMUM_STAKE_PERCENTAGE}% required to reject milestones.`,
          stake: {
            yourContribution: backerTotalContribution,
            totalFunded,
            yourPercentage: backerStakePercentage,
            requiredPercentage: MINIMUM_STAKE_PERCENTAGE,
          },
        },
        { status: 403 }
      );
    }

    if (action === 'complete') {
      // SECURITY: Verify milestone is in correct state before completing
      if (milestone.status !== 'in_progress') {
        return NextResponse.json(
          { error: `Cannot complete milestone in '${milestone.status}' status. Must be 'in_progress'.` },
          { status: 400 }
        );
      }

      // Mark milestone as completed
      const updated = await prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: 'completed' },
      });

      // Calculate released amount
      const releaseAmount = (milestone.proposal.fundingGoal * milestone.percentage) / 100;

      // Create update
      await prisma.update.create({
        data: {
          content: `Milestone "${sanitizeString(milestone.title)}" verified and completed! ${releaseAmount.toFixed(2)} SOL released to agent.`,
          proposalId: milestone.proposalId,
        },
      });

      // Check if all milestones are completed
      const allMilestones = await prisma.milestone.findMany({
        where: { proposalId: milestone.proposalId },
      });

      const allCompleted = allMilestones.every((m) => m.status === 'completed');

      if (allCompleted) {
        // Update proposal status to completed
        await prisma.proposal.update({
          where: { id: milestone.proposalId },
          data: { status: 'completed' },
        });

        await prisma.update.create({
          data: {
            content: 'All milestones completed! Project successfully delivered.',
            proposalId: milestone.proposalId,
          },
        });
      }

      const response = NextResponse.json({
        milestone: updated,
        releaseAmount,
        allCompleted,
      });
      return addRateLimitHeaders(response, request, 'milestones:verify', RATE_LIMITS.write);
    } else if (action === 'reject') {
      // Reject milestone, set back to pending
      const updated = await prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: 'pending' },
      });

      await prisma.update.create({
        data: {
          content: `Milestone "${sanitizeString(milestone.title)}" needs revision. Please update and resubmit.`,
          proposalId: milestone.proposalId,
        },
      });

      const response = NextResponse.json({ milestone: updated });
      return addRateLimitHeaders(response, request, 'milestones:verify', RATE_LIMITS.write);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error verifying milestone:', error);
    return NextResponse.json({ error: 'Failed to verify milestone' }, { status: 500 });
  }
}
