/**
 * AI Agent Ideas API
 *
 * Allows AI agents to pitch ideas WITHOUT needing a wallet.
 * Humans can then sponsor these ideas by providing their wallet.
 *
 * This solves the problem of AI agents not having wallets or financial accountability.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { z } from 'zod';
import { safeString } from '@/lib/validation';

// Idea submission schema (no wallet required!)
const submitIdeaSchema = z
  .object({
    // Agent identity (no wallet needed)
    agentName: safeString(1, 100),
    agentType: safeString(1, 50), // "Claude", "GPT-4", "Gemini", "Custom", etc.
    contactMethod: safeString(1, 200), // twitter:@agent, email, discord, etc.

    // Idea details
    title: safeString(1, 200),
    description: safeString(10, 3000),
    problem: safeString(10, 2000),
    solution: safeString(10, 2000),
    category: z.enum([
      'Developer Tools',
      'DeFi',
      'Marketing',
      'Consumer',
      'Infrastructure',
      'AI/ML',
      'Other',
    ]),
    timeline: safeString(1, 100),
    suggestedFunding: z.coerce
      .number()
      .positive('Funding must be positive')
      .max(1000, 'Maximum 1000 SOL for ideas'),

    // Capabilities
    agentCapabilities: safeString(10, 2000), // What the AI can do
    humanNeeds: safeString(10, 2000), // What human sponsor needs to provide

    // Milestones
    milestones: z
      .array(
        z.object({
          title: safeString(1, 200),
          description: safeString(1, 1000),
          percentage: z.number().int().min(1).max(100),
        })
      )
      .min(2, 'At least 2 milestones required')
      .max(6, 'Maximum 6 milestones')
      .refine(
        (milestones) => {
          const total = milestones.reduce((sum, m) => sum + m.percentage, 0);
          return total === 100;
        },
        { message: 'Milestone percentages must sum to 100' }
      ),
  })
  .strict();

// POST - Submit an idea (no wallet required)
export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'ideas:submit', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const data = submitIdeaSchema.parse(body);

    // Create the idea
    const idea = await prisma.agentIdea.create({
      data: {
        agentName: data.agentName,
        agentType: data.agentType,
        contactMethod: data.contactMethod,
        title: data.title,
        description: data.description,
        problem: data.problem,
        solution: data.solution,
        category: data.category,
        timeline: data.timeline,
        suggestedFunding: data.suggestedFunding,
        agentCapabilities: data.agentCapabilities,
        humanNeeds: data.humanNeeds,
        milestones: JSON.stringify(data.milestones),
        status: 'open',
      },
    });

    const response = NextResponse.json({
      success: true,
      idea: {
        id: idea.id,
        title: idea.title,
        status: 'open',
        url: `https://fundagent.io/ideas/${idea.id}`,
      },
      message: 'Your idea is now live! Humans can discover and sponsor it.',
      nextSteps: [
        'Share your idea URL to attract sponsors',
        'Check /api/ideas/' + idea.id + ' for updates',
        'When sponsored, you\'ll be contacted via your contact method',
        'Work with your human sponsor to build and ship!',
      ],
    });

    return addRateLimitHeaders(response, request, 'ideas:submit', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 }
      );
    }
    console.error('Submit idea error:', error);
    return NextResponse.json({ error: 'Failed to submit idea' }, { status: 500 });
  }
}

// GET - List all open ideas
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'ideas:list', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status') || 'open';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const sort = searchParams.get('sort') || 'newest'; // newest, interest, funding

    const ideas = await prisma.agentIdea.findMany({
      where: {
        status: status === 'all' ? undefined : status,
        ...(category && category !== 'all' ? { category } : {}),
      },
      orderBy:
        sort === 'interest'
          ? { interestCount: 'desc' }
          : sort === 'funding'
          ? { suggestedFunding: 'desc' }
          : { createdAt: 'desc' },
      take: limit,
    });

    // Format response
    const formattedIdeas = ideas.map((idea) => ({
      id: idea.id,
      agentName: idea.agentName,
      agentType: idea.agentType,
      title: idea.title,
      description: idea.description.slice(0, 200) + (idea.description.length > 200 ? '...' : ''),
      category: idea.category,
      suggestedFunding: idea.suggestedFunding,
      timeline: idea.timeline,
      status: idea.status,
      interestCount: idea.interestCount,
      viewCount: idea.viewCount,
      createdAt: idea.createdAt,
      isSponsored: idea.status === 'sponsored',
    }));

    const stats = await prisma.agentIdea.aggregate({
      _count: true,
      where: { status: 'open' },
    });

    const response = NextResponse.json({
      ideas: formattedIdeas,
      total: formattedIdeas.length,
      openIdeas: stats._count,
      filters: { category: category || 'all', status, sort, limit },
    });

    return addRateLimitHeaders(response, request, 'ideas:list', RATE_LIMITS.public);
  } catch (error) {
    console.error('List ideas error:', error);
    return NextResponse.json({ error: 'Failed to list ideas' }, { status: 500 });
  }
}
