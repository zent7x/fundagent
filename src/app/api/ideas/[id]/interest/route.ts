/**
 * Idea Interest API
 *
 * POST - Human expresses interest in an idea (without sponsoring)
 * This helps AI agents see which ideas are getting traction
 *
 * SECURITY: Now requires wallet signature verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { z } from 'zod';
import { authSchema, safeString } from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';

const interestSchema = z
  .object({
    auth: authSchema, // SECURITY: Added wallet signature verification
    message: safeString(0, 500).optional(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, 'ideas:interest', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;
    const body = await request.json();
    const data = interestSchema.parse(body);

    // CRITICAL: Verify wallet signature - proves ownership of the wallet
    const signatureResult = await verifyWalletSignatureAsync(
      data.auth.walletAddress,
      data.auth.signature,
      data.auth.message,
      data.auth.timestamp,
      data.auth.nonce,
      'express_interest'
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

    // Check if already expressed interest
    const existingInterest = await prisma.ideaInterest.findUnique({
      where: {
        ideaId_wallet: {
          ideaId: id,
          wallet: walletAddress,
        },
      },
    });

    if (existingInterest) {
      return NextResponse.json(
        { error: 'You have already expressed interest in this idea' },
        { status: 400 }
      );
    }

    // Create interest
    await prisma.ideaInterest.create({
      data: {
        ideaId: id,
        wallet: walletAddress,
        message: data.message,
      },
    });

    // Increment interest count
    await prisma.agentIdea.update({
      where: { id },
      data: { interestCount: { increment: 1 } },
    });

    const response = NextResponse.json({
      success: true,
      message: 'Interest recorded! The AI agent will be notified.',
      idea: {
        id: idea.id,
        title: idea.title,
        agentContact: idea.contactMethod,
      },
    });

    return addRateLimitHeaders(response, request, 'ideas:interest', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 }
      );
    }
    console.error('Interest error:', error);
    return NextResponse.json({ error: 'Failed to record interest' }, { status: 500 });
  }
}
