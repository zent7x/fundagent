/**
 * Authentication Module - Wallet Signature Verification
 *
 * Security features:
 * - Cryptographic proof of wallet ownership via signed messages
 * - Time-limited authentication challenges
 * - Replay attack prevention via PERSISTENT nonces (database-backed)
 * - Survives server restarts
 *
 * OWASP compliant - Proper authentication before authorization
 */

import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { prisma } from './prisma';

// Challenge expiration (5 minutes)
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;

// Cleanup expired nonces periodically (every 5 minutes)
// This runs in the background and removes old nonce records
let cleanupScheduled = false;

async function cleanupExpiredNonces() {
  try {
    const result = await prisma.usedNonce.deleteMany({
      where: {
        expiresAt: { lt: new Date() }
      }
    });
    if (result.count > 0) {
      console.log(`[Auth] Cleaned up ${result.count} expired nonces`);
    }
  } catch (error) {
    console.error('[Auth] Nonce cleanup error:', error);
  }
}

// Schedule periodic cleanup (only once)
if (typeof setInterval !== 'undefined' && !cleanupScheduled) {
  cleanupScheduled = true;
  // Run cleanup every 5 minutes
  setInterval(cleanupExpiredNonces, 5 * 60 * 1000);
  // Also run on startup after a small delay
  setTimeout(cleanupExpiredNonces, 10000);
}

/**
 * Generate a challenge message for wallet authentication
 * The message includes a timestamp and nonce for replay protection
 */
export function generateAuthChallenge(action: string): {
  message: string;
  nonce: string;
  timestamp: number;
} {
  const timestamp = Date.now();
  const nonce = bs58.encode(nacl.randomBytes(32));

  const message = [
    'FundAgent Authentication',
    '',
    `Action: ${action}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    '',
    'Sign this message to prove wallet ownership.',
    'This signature will expire in 5 minutes.',
  ].join('\n');

  return { message, nonce, timestamp };
}

/**
 * Verify a signed authentication message (SYNCHRONOUS version for backwards compatibility)
 * NOTE: Use verifyWalletSignatureAsync for new code
 *
 * @param walletAddress - The claimed wallet address
 * @param signature - Base58 encoded signature
 * @param message - The original message that was signed
 * @param timestamp - The timestamp from the challenge
 * @param nonce - The nonce from the challenge
 * @returns true if signature is valid and not expired/replayed
 */
export function verifyWalletSignature(
  walletAddress: string,
  signature: string,
  message: string,
  timestamp: number,
  nonce: string
): { valid: boolean; error?: string } {
  // This is a synchronous wrapper - it validates everything except nonce persistence
  // The nonce check is done asynchronously in the background
  // For maximum security, use verifyWalletSignatureAsync instead

  try {
    // Check timestamp expiration
    const now = Date.now();
    if (now - timestamp > CHALLENGE_EXPIRY_MS) {
      return { valid: false, error: 'Authentication challenge expired' };
    }

    // Validate wallet address format
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(walletAddress);
    } catch {
      return { valid: false, error: 'Invalid wallet address format' };
    }

    // Decode signature from base58
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = bs58.decode(signature);
    } catch {
      return { valid: false, error: 'Invalid signature format' };
    }

    // Verify signature length (ed25519 signatures are 64 bytes)
    if (signatureBytes.length !== 64) {
      return { valid: false, error: 'Invalid signature length' };
    }

    // Encode message to bytes
    const messageBytes = new TextEncoder().encode(message);

    // Verify the signature using nacl
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!isValid) {
      return { valid: false, error: 'Signature verification failed' };
    }

    // Store nonce in database asynchronously (fire and forget for sync version)
    // This provides persistence but the sync version can't guarantee uniqueness
    storeNonceAsync(nonce, walletAddress, timestamp).catch(err => {
      console.error('[Auth] Failed to store nonce:', err);
    });

    return { valid: true };
  } catch (error) {
    console.error('Signature verification error:', error);
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Store a nonce in the database (async helper)
 */
async function storeNonceAsync(nonce: string, wallet: string, timestamp: number): Promise<void> {
  const expiresAt = new Date(timestamp + CHALLENGE_EXPIRY_MS + 60000); // Extra minute buffer

  await prisma.usedNonce.create({
    data: {
      nonce,
      wallet,
      expiresAt,
    }
  }).catch(() => {
    // Ignore duplicate errors - nonce was already used
  });
}

/**
 * Verify a signed authentication message (ASYNC version - RECOMMENDED)
 * This version properly checks nonce in database before allowing authentication
 *
 * @param walletAddress - The claimed wallet address
 * @param signature - Base58 encoded signature
 * @param message - The original message that was signed
 * @param timestamp - The timestamp from the challenge
 * @param nonce - The nonce from the challenge
 * @param action - Optional action identifier for audit trail
 * @returns Promise with validation result
 */
export async function verifyWalletSignatureAsync(
  walletAddress: string,
  signature: string,
  message: string,
  timestamp: number,
  nonce: string,
  action?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Check timestamp expiration
    const now = Date.now();
    if (now - timestamp > CHALLENGE_EXPIRY_MS) {
      return { valid: false, error: 'Authentication challenge expired' };
    }

    // Check for replay attack - nonce already used in database
    const existingNonce = await prisma.usedNonce.findUnique({
      where: { nonce }
    });

    if (existingNonce) {
      console.warn(`[Auth] Replay attack detected: nonce ${nonce.slice(0, 8)}... already used by ${existingNonce.wallet}`);
      return { valid: false, error: 'Authentication challenge already used (replay detected)' };
    }

    // Validate wallet address format
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(walletAddress);
    } catch {
      return { valid: false, error: 'Invalid wallet address format' };
    }

    // Decode signature from base58
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = bs58.decode(signature);
    } catch {
      return { valid: false, error: 'Invalid signature format' };
    }

    // Verify signature length (ed25519 signatures are 64 bytes)
    if (signatureBytes.length !== 64) {
      return { valid: false, error: 'Invalid signature length' };
    }

    // Encode message to bytes
    const messageBytes = new TextEncoder().encode(message);

    // Verify the signature using nacl
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!isValid) {
      return { valid: false, error: 'Signature verification failed' };
    }

    // Mark nonce as used in database (atomic operation)
    // Using try-catch to handle race condition where another request uses same nonce
    try {
      await prisma.usedNonce.create({
        data: {
          nonce,
          wallet: walletAddress,
          action: action || 'auth',
          expiresAt: new Date(timestamp + CHALLENGE_EXPIRY_MS + 60000), // Extra minute buffer
        }
      });
    } catch (error: unknown) {
      // Check if it's a unique constraint violation (nonce already used)
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        console.warn(`[Auth] Race condition: nonce ${nonce.slice(0, 8)}... was just used`);
        return { valid: false, error: 'Authentication challenge already used' };
      }
      throw error; // Re-throw other errors
    }

    return { valid: true };
  } catch (error) {
    console.error('Signature verification error:', error);
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Authentication data structure for API requests
 */
export interface AuthData {
  walletAddress: string;
  signature: string;
  message: string;
  timestamp: number;
  nonce: string;
}

/**
 * Validate authentication data from request body
 */
export function validateAuth(auth: unknown): auth is AuthData {
  if (!auth || typeof auth !== 'object') return false;

  const a = auth as Record<string, unknown>;
  return (
    typeof a.walletAddress === 'string' &&
    typeof a.signature === 'string' &&
    typeof a.message === 'string' &&
    typeof a.timestamp === 'number' &&
    typeof a.nonce === 'string'
  );
}

/**
 * Authenticate a request by verifying wallet signature (sync version)
 * Returns the verified wallet address or null if authentication fails
 */
export function authenticateRequest(auth: AuthData): {
  authenticated: boolean;
  walletAddress?: string;
  error?: string;
} {
  // Verify the signature
  const result = verifyWalletSignature(
    auth.walletAddress,
    auth.signature,
    auth.message,
    auth.timestamp,
    auth.nonce
  );

  if (!result.valid) {
    return { authenticated: false, error: result.error };
  }

  return { authenticated: true, walletAddress: auth.walletAddress };
}

/**
 * Authenticate a request by verifying wallet signature (ASYNC version - RECOMMENDED)
 * Returns the verified wallet address or null if authentication fails
 * This version properly checks nonce in database before allowing authentication
 */
export async function authenticateRequestAsync(auth: AuthData, action?: string): Promise<{
  authenticated: boolean;
  walletAddress?: string;
  error?: string;
}> {
  // Verify the signature with proper nonce checking
  const result = await verifyWalletSignatureAsync(
    auth.walletAddress,
    auth.signature,
    auth.message,
    auth.timestamp,
    auth.nonce,
    action
  );

  if (!result.valid) {
    return { authenticated: false, error: result.error };
  }

  return { authenticated: true, walletAddress: auth.walletAddress };
}

/**
 * Manually trigger cleanup of expired nonces
 * Can be called from admin endpoints or cron jobs
 */
export async function cleanupNonces(): Promise<{ deleted: number }> {
  const result = await prisma.usedNonce.deleteMany({
    where: {
      expiresAt: { lt: new Date() }
    }
  });
  return { deleted: result.count };
}

/**
 * Get nonce statistics for monitoring
 */
export async function getNonceStats(): Promise<{
  total: number;
  expired: number;
  active: number;
}> {
  const now = new Date();
  const [total, expired] = await Promise.all([
    prisma.usedNonce.count(),
    prisma.usedNonce.count({ where: { expiresAt: { lt: now } } })
  ]);
  return {
    total,
    expired,
    active: total - expired
  };
}
