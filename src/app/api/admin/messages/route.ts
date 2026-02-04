/**
 * Admin Messages API
 *
 * Security features:
 * - Rate limiting (admin tier)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION
 * - Head admin only access (for message viewing)
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isHeadAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { validateQuery, adminAuthQuerySchema, ValidationError } from '@/lib/validation';
import { verifyWalletSignature } from '@/lib/auth';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'admin:messages', RATE_LIMITS.admin);
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

    // Only head admins can view messages (now we know they own this wallet)
    if (!isHeadAdmin(params.wallet)) {
      return NextResponse.json({ error: 'Unauthorized - Head Admin access required' }, { status: 403 });
    }

    const messages = await prisma.message.findMany({
      include: {
        sender: {
          select: { walletAddress: true },
        },
        proposal: {
          select: { title: true, agentWallet: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Decrypt admin copies of messages
    const decryptedMessages = messages.map((msg) => {
      // If we have admin content, use it (already decrypted server-side)
      // For now, return the stored content - in production, decrypt adminContent
      return {
        ...msg,
        content: msg.adminContent || msg.content,
      };
    });

    const response = NextResponse.json(decryptedMessages);
    return addRateLimitHeaders(response, request, 'admin:messages', RATE_LIMITS.admin);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
