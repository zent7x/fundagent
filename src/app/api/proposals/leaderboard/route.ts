/**
 * Proposals Leaderboard API
 *
 * Returns proposals ranked by number of backers
 * Designed to be called by AI agents to discover top ideas
 *
 * Security features:
 * - Rate limiting (public tier)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';

export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'proposals:leaderboard', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    // SECURITY: Validate limit as positive integer and cap at 50
    const rawLimit = parseInt(searchParams.get('limit') || '10');
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 10 : rawLimit), 50);
    const category = searchParams.get('category');
    const status = searchParams.get('status');

    // SECURITY: Add database-level pagination to prevent memory exhaustion
    // First, get count for stats
    const totalCount = await prisma.proposal.count({
      where: {
        status: status && status !== 'all' ? status : { not: 'closed' },
        ...(category && category !== 'all' ? { category } : {}),
      },
    });

    // Get proposals with backer count - limited at database level
    // SECURITY: Use take to prevent fetching entire database
    const proposals = await prisma.proposal.findMany({
      where: {
        status: status && status !== 'all' ? status : { not: 'closed' },
        ...(category && category !== 'all' ? { category } : {}),
      },
      take: 200, // SECURITY: Hard limit to prevent memory exhaustion
      include: {
        fundings: {
          select: {
            backerId: true,
          },
        },
        milestones: {
          select: {
            id: true,
            title: true,
            status: true,
            percentage: true,
          },
          orderBy: { order: 'asc' },
        },
        creator: {
          select: {
            isAgent: true,
            agentVerified: true,
          },
        },
        _count: {
          select: {
            fundings: true,
            messages: true,
          },
        },
      },
      orderBy: {
        fundedAmount: 'desc', // Pre-sort by funding to get top proposals
      },
    });

    // Calculate unique backers and rank by backer count
    const rankedProposals = proposals
      .map(proposal => {
        const uniqueBackerIds = new Set(proposal.fundings.map(f => f.backerId));
        const completedMilestones = proposal.milestones.filter(m => m.status === 'completed').length;
        const totalMilestones = proposal.milestones.length;

        return {
          id: proposal.id,
          rank: 0, // Will be set after sorting
          agentName: proposal.agentName,
          agentWallet: proposal.agentWallet,
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          status: proposal.status,
          fundingGoal: proposal.fundingGoal,
          fundedAmount: proposal.fundedAmount,
          fundingProgress: Math.round((proposal.fundedAmount / proposal.fundingGoal) * 100),
          backerCount: uniqueBackerIds.size,
          messageCount: proposal._count.messages,
          milestoneProgress: totalMilestones > 0
            ? `${completedMilestones}/${totalMilestones}`
            : '0/0',
          isVerifiedAgent: proposal.creator?.agentVerified || false,
          isAIAgent: proposal.creator?.isAgent || false,
          createdAt: proposal.createdAt,
          timeline: proposal.timeline,
        };
      })
      .sort((a, b) => b.backerCount - a.backerCount)
      .slice(0, limit)
      .map((proposal, index) => ({
        ...proposal,
        rank: index + 1,
      }));

    // Get some stats - use pre-counted total, not fetched array length
    const totalProposals = totalCount;
    const uniqueBackerIds = new Set(proposals.flatMap(p => p.fundings.map(f => f.backerId)));
    const totalBackers = uniqueBackerIds.size;
    const totalFunded = proposals.reduce((sum, p) => sum + p.fundedAmount, 0);

    const response = NextResponse.json({
      leaderboard: rankedProposals,
      stats: {
        totalProposals,
        totalBackers,
        totalFunded: Math.round(totalFunded * 100) / 100,
      },
      filters: {
        category: category || 'all',
        status: status || 'all',
        limit,
      },
    });

    return addRateLimitHeaders(response, request, 'proposals:leaderboard', RATE_LIMITS.public);
  } catch (error) {
    console.error('Leaderboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
