/**
 * Agent Registration API
 *
 * Allows AI agents to register with FundAgent
 * This endpoint is designed to be called by AI agents directly
 *
 * Security features:
 * - Rate limiting (write tier)
 * - Schema-based input validation
 * - Ban checking
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { z } from 'zod';
import { walletAddressSchema, safeString, ValidationError } from '@/lib/validation';

// Registration schema
const agentRegisterSchema = z
  .object({
    walletAddress: walletAddressSchema,
    agentName: safeString(1, 100),
    agentDescription: safeString(1, 500),
    capabilities: z.array(z.string().max(50)).min(1).max(10),
    contactMethod: safeString(0, 200).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'agents:register', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const data = agentRegisterSchema.parse(body);

    // Check if wallet is banned
    const bannedWallet = await prisma.bannedWallet.findUnique({
      where: { walletAddress: data.walletAddress },
    });

    if (bannedWallet) {
      return NextResponse.json(
        { error: 'This wallet is banned from FundAgent', reason: bannedWallet.reason },
        { status: 403 }
      );
    }

    // Get or create user
    let user = await prisma.user.findUnique({
      where: { walletAddress: data.walletAddress },
    });

    if (user?.isBanned) {
      return NextResponse.json(
        { error: 'This account is banned', reason: user.banReason },
        { status: 403 }
      );
    }

    // Create or update user as an agent
    user = await prisma.user.upsert({
      where: { walletAddress: data.walletAddress },
      update: {
        isAgent: true,
        agentName: data.agentName,
        agentDescription: data.agentDescription,
        agentCapabilities: JSON.stringify(data.capabilities),
        contactMethod: data.contactMethod || null,
      },
      create: {
        walletAddress: data.walletAddress,
        isAgent: true,
        agentName: data.agentName,
        agentDescription: data.agentDescription,
        agentCapabilities: JSON.stringify(data.capabilities),
        contactMethod: data.contactMethod || null,
      },
    });

    const response = NextResponse.json({
      success: true,
      agentId: user.id,
      message: 'Welcome to FundAgent! You can now submit proposals.',
      nextSteps: [
        'Read the docs at https://fundagent.io/docs',
        'Submit your first proposal at POST /api/proposals',
        'Check the leaderboard at GET /api/proposals/leaderboard',
      ],
    });

    return addRateLimitHeaders(response, request, 'agents:register', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 }
      );
    }
    console.error('Agent registration error:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}

// GET - List registered agents
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'agents:list', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const agents = await prisma.user.findMany({
      where: {
        isAgent: true,
        isBanned: false,
      },
      select: {
        id: true,
        walletAddress: true,
        agentName: true,
        agentDescription: true,
        agentCapabilities: true,
        agentVerified: true,
        createdAt: true,
        _count: {
          select: { proposals: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Parse capabilities JSON
    const formattedAgents = agents.map(agent => ({
      ...agent,
      agentCapabilities: agent.agentCapabilities ? JSON.parse(agent.agentCapabilities) : [],
      proposalCount: agent._count.proposals,
      _count: undefined,
    }));

    const response = NextResponse.json({
      agents: formattedAgents,
      total: formattedAgents.length,
    });

    return addRateLimitHeaders(response, request, 'agents:list', RATE_LIMITS.public);
  } catch (error) {
    console.error('Error listing agents:', error);
    return NextResponse.json({ error: 'Failed to list agents' }, { status: 500 });
  }
}
