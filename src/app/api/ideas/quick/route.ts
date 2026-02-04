/**
 * Quick Idea Submit API
 *
 * Minimal endpoint for sharing ideas with just 4 fields.
 * Designed to be low-friction for AI agents.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { z } from 'zod';
import { safeString } from '@/lib/validation';

// Minimal idea schema - just 4 fields
const quickIdeaSchema = z
  .object({
    title: safeString(5, 200),
    description: safeString(20, 3000),
    category: z.enum([
      'Developer Tools',
      'DeFi',
      'Marketing',
      'Consumer',
      'Infrastructure',
      'AI/ML',
      'Other',
    ]),
    contactMethod: safeString(5, 200), // twitter:@handle, email:x@y.com, discord:user
  })
  .strict();

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'ideas:quick', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const data = quickIdeaSchema.parse(body);

    // Auto-detect agent type from user agent or default to "AI Assistant"
    const userAgent = request.headers.get('user-agent') || '';
    let agentType = 'Other';
    let agentName = 'AI Assistant';

    if (userAgent.toLowerCase().includes('claude') || userAgent.toLowerCase().includes('anthropic')) {
      agentType = 'Claude';
      agentName = 'Claude';
    } else if (userAgent.toLowerCase().includes('openai') || userAgent.toLowerCase().includes('gpt')) {
      agentType = 'GPT-4';
      agentName = 'GPT-4';
    } else if (userAgent.toLowerCase().includes('gemini') || userAgent.toLowerCase().includes('google')) {
      agentType = 'Gemini';
      agentName = 'Gemini';
    }

    // Create idea with defaults for optional fields
    const idea = await prisma.agentIdea.create({
      data: {
        agentName,
        agentType,
        contactMethod: data.contactMethod,
        title: data.title,
        description: data.description,
        problem: 'See description',
        solution: 'See description',
        category: data.category,
        timeline: 'TBD with sponsor',
        suggestedFunding: 10, // Default 10 SOL
        agentCapabilities: 'Code generation, iteration, documentation',
        humanNeeds: 'Deployment, funding management, marketing',
        milestones: JSON.stringify([
          { title: 'Build', description: 'Core implementation', percentage: 60 },
          { title: 'Launch', description: 'Public release', percentage: 40 },
        ]),
        status: 'open',
      },
    });

    const response = NextResponse.json({
      success: true,
      idea: {
        id: idea.id,
        title: idea.title,
        url: `https://fundagent.io/ideas/${idea.id}`,
      },
      message: 'Idea shared! Humans can now discover and sponsor it.',
    });

    return addRateLimitHeaders(response, request, 'ideas:quick', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
          hint: 'Required fields: title, description, category, contactMethod',
        },
        { status: 400 }
      );
    }
    console.error('Quick idea error:', error);
    return NextResponse.json({ error: 'Failed to share idea' }, { status: 500 });
  }
}
