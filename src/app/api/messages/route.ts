/**
 * Messages API
 *
 * Security features:
 * - Rate limiting (public for GET, write for POST)
 * - Schema-based input validation
 * - CRYPTOGRAPHIC WALLET SIGNATURE VERIFICATION for POST
 * - Sanitized outputs
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import {
  validateBody,
  validateQuery,
  messageQuerySchema,
  createMessageAuthSchema,
  ValidationError,
  sanitizeString,
} from '@/lib/validation';
import { verifyWalletSignatureAsync } from '@/lib/auth';

// GET messages for a proposal
export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = checkRateLimit(request, 'messages:get', RATE_LIMITS.public);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const { proposalId } = validateQuery(searchParams, messageQuerySchema);

    const messages = await prisma.message.findMany({
      where: { proposalId },
      include: {
        sender: {
          select: { walletAddress: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Don't return adminContent to regular users
    const sanitized = messages.map(({ adminContent, ...msg }) => msg);

    const response = NextResponse.json(sanitized);
    return addRateLimitHeaders(response, request, 'messages:get', RATE_LIMITS.public);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

// POST new message
export async function POST(request: NextRequest) {
  // Rate limit check - stricter for write operations
  const rateLimitResponse = checkRateLimit(request, 'messages:create', RATE_LIMITS.write);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const data = await validateBody(request, createMessageAuthSchema);
    const { auth, proposalId, content, isEncrypted, adminContent } = data;

    // CRITICAL: Verify wallet signature with ASYNC version for write operations
    // This prevents replay attacks by enforcing one-time nonce usage
    const signatureResult = await verifyWalletSignatureAsync(
      auth.walletAddress,
      auth.signature,
      auth.message,
      auth.timestamp,
      auth.nonce,
      'message_create'
    );

    if (!signatureResult.valid) {
      return NextResponse.json(
        { error: 'Authentication failed', details: signatureResult.error },
        { status: 401 }
      );
    }

    const walletAddress = auth.walletAddress;

    // Get proposal to verify it exists
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Get or create user (now we know they own this wallet)
    let user = await prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { walletAddress },
      });
    }

    // Check if user is banned
    if (user.isBanned) {
      return NextResponse.json(
        { error: 'Your account has been banned' },
        { status: 403 }
      );
    }

    // Create message with encrypted content and admin backup
    const message = await prisma.message.create({
      data: {
        content: sanitizeString(content),
        isEncrypted: isEncrypted || false,
        adminContent: adminContent ? sanitizeString(adminContent) : null,
        senderId: user.id,
        proposalId,
      },
      include: {
        sender: {
          select: { walletAddress: true },
        },
      },
    });

    // Don't return adminContent
    const { adminContent: _, ...sanitized } = message;

    const response = NextResponse.json(sanitized, { status: 201 });
    return addRateLimitHeaders(response, request, 'messages:create', RATE_LIMITS.write);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error creating message:', error);
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }
}
