/**
 * Admin Check API
 *
 * Security features:
 * - Rate limiting (sensitive tier to prevent enumeration)
 * - Schema-based input validation
 * - SECURITY: Stricter rate limiting to prevent wallet enumeration
 *
 * OWASP compliant
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, isHeadAdmin } from '@/lib/admin';
import { checkRateLimit, RATE_LIMITS, addRateLimitHeaders } from '@/lib/rateLimit';
import { validateQuery, adminQuerySchema, ValidationError } from '@/lib/validation';

export async function GET(request: NextRequest) {
  // SECURITY: Use sensitive rate limiting to prevent wallet enumeration attacks
  // Attackers could try to discover admin wallets by probing different addresses
  const rateLimitResponse = checkRateLimit(request, 'admin:check', RATE_LIMITS.sensitive);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);

    // Handle case where wallet is not provided
    const walletParam = searchParams.get('wallet');
    if (!walletParam) {
      return NextResponse.json({ isAdmin: false, isHeadAdmin: false });
    }

    const { wallet } = validateQuery(searchParams, adminQuerySchema);

    // SECURITY: Don't reveal admin status for non-existent/invalid wallets
    // This prevents information gathering about which wallets are admins
    const adminStatus = isAdmin(wallet);
    const headAdminStatus = isHeadAdmin(wallet);

    const response = NextResponse.json({
      isAdmin: adminStatus,
      isHeadAdmin: headAdminStatus,
    });

    return addRateLimitHeaders(response, request, 'admin:check', RATE_LIMITS.sensitive);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ isAdmin: false, isHeadAdmin: false });
  }
}
