/**
 * Admin Configuration Module
 *
 * Security features:
 * - Wallet-based admin authentication
 * - Role-based access control (Head Admin vs Admin)
 * - Server-side only secrets (never exposed to client)
 *
 * IMPORTANT: Never prefix secrets with NEXT_PUBLIC_
 * Admin wallets are loaded server-side only for security
 */

// Validate required environment variables on server startup
if (typeof window === 'undefined') {
  // Server-side validation - ALWAYS require proper configuration
  if (!process.env.ADMIN_MASTER_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: ADMIN_MASTER_SECRET must be set in production!');
    }
    // In development, still require it but give a helpful message
    console.error('='.repeat(70));
    console.error('ERROR: ADMIN_MASTER_SECRET is not set!');
    console.error('');
    console.error('Add the following to your .env file:');
    console.error('  ADMIN_MASTER_SECRET=your-secure-random-secret-here');
    console.error('');
    console.error('You can generate a secure secret with:');
    console.error('  openssl rand -base64 32');
    console.error('='.repeat(70));
  }

  if (!process.env.HEAD_ADMIN_WALLET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: HEAD_ADMIN_WALLET must be set in production!');
    }
    console.warn('WARNING: HEAD_ADMIN_WALLET not set. Admin features will be disabled.');
  }
}

export const ADMIN_CONFIG = {
  // Head admin wallet addresses (full access)
  // Server-side only - no NEXT_PUBLIC_ prefix for security
  get HEAD_ADMINS(): string[] {
    // Use server-side env var (no NEXT_PUBLIC_ prefix)
    const wallet = process.env.HEAD_ADMIN_WALLET;
    return wallet ? [wallet] : [];
  },

  // Regular admin wallet addresses (manage proposals, no message access)
  // In production, load from database instead of hardcoding
  ADMINS: [] as string[],

  // Master secret for admin message decryption
  // NEVER expose this client-side - no NEXT_PUBLIC_ prefix
  get MASTER_SECRET(): string {
    if (typeof window !== 'undefined') {
      throw new Error('ADMIN_MASTER_SECRET cannot be accessed on the client');
    }

    const secret = process.env.ADMIN_MASTER_SECRET;

    if (!secret) {
      // NO FALLBACK - require proper configuration
      throw new Error(
        'ADMIN_MASTER_SECRET is not configured. ' +
        'Please set it in your .env file. ' +
        'Generate with: openssl rand -base64 32'
      );
    }

    // Validate minimum secret length
    if (secret.length < 32) {
      throw new Error(
        'ADMIN_MASTER_SECRET is too short (minimum 32 characters). ' +
        'Generate a secure secret with: openssl rand -base64 32'
      );
    }

    return secret;
  },
};

/**
 * Check if wallet is a head admin (full access)
 */
export function isHeadAdmin(walletAddress: string): boolean {
  if (!walletAddress) return false;
  return ADMIN_CONFIG.HEAD_ADMINS.includes(walletAddress);
}

/**
 * Check if wallet is any type of admin
 */
export function isAdmin(walletAddress: string): boolean {
  if (!walletAddress) return false;
  return isHeadAdmin(walletAddress) || ADMIN_CONFIG.ADMINS.includes(walletAddress);
}

/**
 * Check if wallet can view encrypted messages
 * Only head admins can view messages for moderation
 */
export function canViewMessages(walletAddress: string): boolean {
  return isHeadAdmin(walletAddress);
}

/**
 * Get admin master secret (server-side only)
 * Used for encrypting admin copies of messages
 */
export function getAdminSecret(): string {
  if (typeof window !== 'undefined') {
    throw new Error('Admin secret cannot be accessed on the client');
  }
  return ADMIN_CONFIG.MASTER_SECRET;
}
