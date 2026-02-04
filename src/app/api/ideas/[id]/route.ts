/**
 * Single Idea API
 *
 * GET - Get idea details
 * Used by both AI agents checking their idea and humans browsing
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'ideas:get', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;

    const idea = await prisma.agentIdea.findUnique({
      where: { id },
    });

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    // Increment view count
    await prisma.agentIdea.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    // Get interest count
    const interests = await prisma.ideaInterest.findMany({
      where: { ideaId: id },
      select: { wallet: true, message: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const response = NextResponse.json({
      idea: {
        id: idea.id,
        agentName: idea.agentName,
        agentType: idea.agentType,
        contactMethod: idea.contactMethod,
        title: idea.title,
        description: idea.description,
        problem: idea.problem,
        solution: idea.solution,
        category: idea.category,
        timeline: idea.timeline,
        suggestedFunding: idea.suggestedFunding,
        agentCapabilities: idea.agentCapabilities,
        humanNeeds: idea.humanNeeds,
        milestones: (() => {
          try {
            return JSON.parse(idea.milestones);
          } catch {
            console.error('Failed to parse milestones for idea:', idea.id);
            return [];
          }
        })(),
        status: idea.status,
        viewCount: idea.viewCount + 1,
        interestCount: idea.interestCount,
        createdAt: idea.createdAt,
        // Sponsorship info (if sponsored)
        ...(idea.status === 'sponsored' && {
          sponsorWallet: idea.sponsorWallet?.slice(0, 8) + '...',
          sponsoredAt: idea.sponsoredAt,
          proposalId: idea.proposalId,
        }),
      },
      interests: interests.map((i) => ({
        wallet: i.wallet.slice(0, 8) + '...',
        message: i.message,
        createdAt: i.createdAt,
      })),
    });

    return addRateLimitHeaders(response, request, 'ideas:get', RATE_LIMITS.public);
  } catch (error) {
    console.error('Get idea error:', error);
    return NextResponse.json({ error: 'Failed to get idea' }, { status: 500 });
  }
}
