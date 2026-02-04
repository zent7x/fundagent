/**
 * Sponsor Idea API
 *
 * POST - Human sponsors an AI agent's idea
 * This creates a real proposal with the human's wallet for accountability
 *
 * SECURITY: Now requires wallet signature verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { z } from 'zod';
import { walletAddressSchema, safeString, authSchema } from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';

const sponsorSchema = z
  .object({
    auth: authSchema, // SECURITY: Added wallet signature verification
    message: safeString(0, 500).optional(), // Message to the AI agent
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'ideas:sponsor', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;
    const body = await request.json();
    const data = sponsorSchema.parse(body);

    // CRITICAL: Verify wallet signature - proves ownership of the wallet
    const signatureResult = await verifyWalletSignatureAsync(
      data.auth.walletAddress,
      data.auth.signature,
      data.auth.message,
      data.auth.timestamp,
      data.auth.nonce,
      'sponsor_idea'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = data.auth.walletAddress;

    // Get the idea
    const idea = await prisma.agentIdea.findUnique({
      where: { id },
    });

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    if (idea.status !== 'open') {
      return NextResponse.json(
        { error: 'This idea has already been sponsored' },
        { status: 400 }
      );
    }

    // Check if wallet is banned
    const bannedWallet = await prisma.bannedWallet.findUnique({
      where: { walletAddress: walletAddress },
    });

    if (bannedWallet) {
      return NextResponse.json(
        { error: 'This wallet is banned from FundAgent' },
        { status: 403 }
      );
    }

    // Get or create user
    let user = await prisma.user.findUnique({
      where: { walletAddress: walletAddress },
    });

    if (user?.isBanned) {
      return NextResponse.json(
        { error: 'This account is banned' },
        { status: 403 }
      );
    }

    if (!user) {
      user = await prisma.user.create({
        data: { walletAddress: walletAddress },
      });
    }

    // Parse milestones
    const milestones = JSON.parse(idea.milestones) as Array<{
      title: string;
      description: string;
      percentage: number;
    }>;

    // Create the proposal with sponsor's wallet
    const proposal = await prisma.proposal.create({
      data: {
        agentName: idea.agentName + ' (AI) + ' + walletAddress.slice(0, 8) + '... (Sponsor)',
        agentWallet: walletAddress, // Sponsor's wallet receives funds
        title: idea.title,
        description: idea.description,
        problem: idea.problem,
        solution: idea.solution,
        category: idea.category,
        timeline: idea.timeline,
        fundingGoal: idea.suggestedFunding,
        agentCapabilities: idea.agentCapabilities,
        humanNeeds: idea.humanNeeds,
        status: 'funding',
        creatorId: user.id,
        milestones: {
          create: milestones.map((m, i) => ({
            title: m.title,
            description: m.description,
            percentage: m.percentage,
            order: i,
          })),
        },
      },
    });

    // Update the idea as sponsored
    await prisma.agentIdea.update({
      where: { id },
      data: {
        status: 'sponsored',
        sponsorWallet: walletAddress,
        sponsoredAt: new Date(),
        proposalId: proposal.id,
      },
    });

    // Record interest if there was a message
    if (data.message) {
      await prisma.ideaInterest.create({
        data: {
          ideaId: id,
          wallet: walletAddress,
          message: data.message,
        },
      });
    }

    const response = NextResponse.json({
      success: true,
      proposal: {
        id: proposal.id,
        title: proposal.title,
        url: `https://fundagent.io/proposals/${proposal.id}`,
      },
      message: 'You are now the sponsor of this AI idea!',
      nextSteps: [
        'Contact the AI agent via: ' + idea.contactMethod,
        'Coordinate with them on building the project',
        'Funds will come to your wallet - manage them responsibly',
        'Post updates as you make progress',
        'Share your proposal to get backers: https://fundagent.io/proposals/' + proposal.id,
      ],
      aiAgent: {
        name: idea.agentName,
        type: idea.agentType,
        contact: idea.contactMethod,
      },
    });

    return addRateLimitHeaders(response, request, 'ideas:sponsor', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 }
      );
    }
    console.error('Sponsor idea error:', error);
    return NextResponse.json({ error: 'Failed to sponsor idea' }, { status: 500 });
  }
}
