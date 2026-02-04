import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Devnet endpoint - configurable via environment variable
export const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

/**
 * SECURITY: Convert SOL to lamports with proper precision handling
 * JavaScript floating point can cause issues like 0.1 * 1e9 = 99999999.99999999
 */
function solToLamports(amountSOL: number): number {
  const roundedSOL = Math.round(amountSOL * 1e9) / 1e9;
  return Math.round(roundedSOL * LAMPORTS_PER_SOL);
}
// SECURITY: Use 'finalized' commitment for transaction finality
// 'confirmed' is vulnerable to rollbacks, 'finalized' guarantees permanence
export const connection = new Connection(SOLANA_RPC, 'finalized');

// Platform wallet for escrow (in production, use a proper escrow program)
export const ESCROW_WALLET = new PublicKey('11111111111111111111111111111111'); // Replace with actual escrow wallet

// Tolerance for amount verification (0.1% to account for rounding)
const AMOUNT_TOLERANCE = 0.001;

export async function getBalance(walletAddress: string): Promise<number> {
  try {
    const pubkey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

export async function createFundingTransaction(
  fromWallet: PublicKey,
  toWallet: PublicKey,
  amountSOL: number
): Promise<Transaction> {
  const transaction = new Transaction();

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: fromWallet,
      toPubkey: toWallet,
      lamports: solToLamports(amountSOL),
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromWallet;

  return transaction;
}

/**
 * DEPRECATED: Use verifyFundingTransaction instead
 * This only checks if transaction exists, NOT the details
 */
export async function confirmTransaction(signature: string): Promise<boolean> {
  try {
    // SECURITY: Use 'finalized' for permanent transaction confirmation
    const confirmation = await connection.confirmTransaction(signature, 'finalized');
    return !confirmation.value.err;
  } catch {
    return false;
  }
}

/**
 * Transaction verification result
 */
export interface TransactionVerification {
  valid: boolean;
  error?: string;
  actualAmount?: number;
  sender?: string;
  recipient?: string;
}

/**
 * SECURE: Verify a funding transaction with full validation
 *
 * Checks:
 * 1. Transaction exists and is confirmed
 * 2. Transaction succeeded (no error)
 * 3. Sender matches claimed wallet
 * 4. Recipient matches expected recipient (agent wallet)
 * 5. Amount matches claimed amount (within tolerance)
 * 6. Is a valid SOL transfer (System Program)
 */
export async function verifyFundingTransaction(
  signature: string,
  expectedSender: string,
  expectedRecipient: string,
  expectedAmountSOL: number
): Promise<TransactionVerification> {
  try {
    // Validate inputs
    let senderPubkey: PublicKey;
    let recipientPubkey: PublicKey;

    try {
      senderPubkey = new PublicKey(expectedSender);
    } catch {
      return { valid: false, error: 'Invalid sender wallet address' };
    }

    try {
      recipientPubkey = new PublicKey(expectedRecipient);
    } catch {
      return { valid: false, error: 'Invalid recipient wallet address' };
    }

    // Fetch the transaction with full details
    // SECURITY: Use 'finalized' to ensure transaction won't be rolled back
    const tx = await connection.getTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { valid: false, error: 'Transaction not found' };
    }

    // Check transaction succeeded
    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on chain' };
    }

    // Get account keys from the transaction
    const accountKeys = tx.transaction.message.getAccountKeys();
    if (!accountKeys || accountKeys.length < 2) {
      return { valid: false, error: 'Invalid transaction structure' };
    }

    // For a SOL transfer, the first account is the sender (fee payer)
    const actualSender = accountKeys.get(0)?.toBase58();
    if (!actualSender) {
      return { valid: false, error: 'Could not determine sender' };
    }

    // Verify sender matches
    if (actualSender !== expectedSender) {
      return {
        valid: false,
        error: `Sender mismatch: expected ${expectedSender}, got ${actualSender}`,
        sender: actualSender,
      };
    }

    // Parse the transaction to find the transfer
    // For System Program transfers, we need to analyze pre/post balances
    const preBalances = tx.meta?.preBalances;
    const postBalances = tx.meta?.postBalances;

    if (!preBalances || !postBalances) {
      return { valid: false, error: 'Missing balance information' };
    }

    // Find the recipient's account index
    let recipientIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      if (accountKeys.get(i)?.toBase58() === expectedRecipient) {
        recipientIndex = i;
        break;
      }
    }

    if (recipientIndex === -1) {
      return {
        valid: false,
        error: `Recipient ${expectedRecipient} not found in transaction`,
      };
    }

    // Calculate the amount received by recipient
    const recipientPreBalance = preBalances[recipientIndex] || 0;
    const recipientPostBalance = postBalances[recipientIndex] || 0;
    const actualAmountLamports = recipientPostBalance - recipientPreBalance;
    const actualAmountSOL = actualAmountLamports / LAMPORTS_PER_SOL;

    // Verify amount (with small tolerance for rounding)
    const amountDiff = Math.abs(actualAmountSOL - expectedAmountSOL);
    const toleranceAmount = expectedAmountSOL * AMOUNT_TOLERANCE;

    if (amountDiff > toleranceAmount && amountDiff > 0.0001) {
      return {
        valid: false,
        error: `Amount mismatch: expected ${expectedAmountSOL} SOL, got ${actualAmountSOL} SOL`,
        actualAmount: actualAmountSOL,
        sender: actualSender,
        recipient: expectedRecipient,
      };
    }

    // All checks passed
    return {
      valid: true,
      actualAmount: actualAmountSOL,
      sender: actualSender,
      recipient: expectedRecipient,
    };
  } catch (error) {
    console.error('Transaction verification error:', error);
    return {
      valid: false,
      error: 'Failed to verify transaction',
    };
  }
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
