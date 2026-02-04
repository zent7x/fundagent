/**
 * E2E Encryption utilities for messages
 *
 * SECURITY NOTES:
 * - Uses AES-256-GCM for authenticated encryption
 * - Keys are derived using PBKDF2 with 100k iterations
 * - Each message gets a unique 12-byte IV
 * - Conversation salt includes a server secret to prevent key derivation by third parties
 *
 * IMPORTANT: The key derivation now includes a server-side secret component
 * so attackers cannot derive keys just by knowing wallet addresses.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Get the server-side salt component for key derivation
 * This prevents attackers who know both wallet addresses from deriving the key
 */
function getServerSalt(): string {
  // SECURITY: Require proper secret configuration - no fallback allowed
  const secret = process.env.ADMIN_MASTER_SECRET || process.env.E2E_SECRET;
  if (!secret) {
    throw new Error(
      'E2E encryption requires ADMIN_MASTER_SECRET or E2E_SECRET environment variable to be set'
    );
  }
  return `fundagent-e2e-v2:${secret}`;
}

// Helper to convert Uint8Array to ArrayBuffer
function toBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.length);
  const view = new Uint8Array(buf);
  view.set(data);
  return buf;
}

/**
 * Generate a conversation key from two wallet addresses
 *
 * SECURITY: The key is derived from:
 * 1. Both wallet addresses (sorted for consistency)
 * 2. A server-side secret (so third parties can't derive the key)
 * 3. 100,000 PBKDF2 iterations
 *
 * This means attackers cannot decrypt messages even if they know both wallet addresses.
 */
export async function deriveConversationKey(wallet1: string, wallet2: string): Promise<CryptoKey> {
  // Sort wallets to ensure same key regardless of order
  const sorted = [wallet1, wallet2].sort().join(':');

  // Include server salt to prevent third-party key derivation
  const keyInput = `${sorted}:${getServerSalt()}`;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toBuffer(encoder.encode(keyInput)),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      // Salt now includes version to allow future upgrades
      salt: toBuffer(encoder.encode('fundagent-e2e-salt-v2')),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a message
export async function encryptMessage(
  plaintext: string,
  senderWallet: string,
  recipientWallet: string
): Promise<string> {
  const key = await deriveConversationKey(senderWallet, recipientWallet);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    toBuffer(encoder.encode(plaintext))
  );

  // Combine IV and ciphertext, then base64 encode
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

// Decrypt a message
export async function decryptMessage(
  ciphertext: string,
  wallet1: string,
  wallet2: string
): Promise<string> {
  try {
    const key = await deriveConversationKey(wallet1, wallet2);
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(iv) },
      key,
      toBuffer(encrypted)
    );

    return decoder.decode(decrypted);
  } catch {
    return '[Unable to decrypt message]';
  }
}

/**
 * Admin master key for message access
 *
 * Derived from admin wallet + master secret with PBKDF2
 * This allows head admins to access encrypted messages for moderation
 */
export async function deriveAdminKey(adminWallet: string, masterSecret: string): Promise<CryptoKey> {
  // Add extra entropy to the key derivation
  const keyInput = `admin:${adminWallet}:${masterSecret}:agentfund`;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toBuffer(encoder.encode(keyInput)),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBuffer(encoder.encode('fundagent-admin-salt-v2')),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Store encrypted copy for admin access
export async function encryptForAdmin(
  plaintext: string,
  adminWallet: string,
  masterSecret: string
): Promise<string> {
  const key = await deriveAdminKey(adminWallet, masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    toBuffer(encoder.encode(plaintext))
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptAsAdmin(
  ciphertext: string,
  adminWallet: string,
  masterSecret: string
): Promise<string> {
  try {
    const key = await deriveAdminKey(adminWallet, masterSecret);
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(iv) },
      key,
      toBuffer(encrypted)
    );

    return decoder.decode(decrypted);
  } catch {
    return '[Unable to decrypt message]';
  }
}
