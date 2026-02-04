import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';
import * as borsh from 'borsh';
import bs58 from 'bs58';
import { connection } from '@/lib/solana';

/**
 * SECURITY: Convert SOL to lamports with proper precision handling
 * JavaScript floating point can cause issues like 0.1 * 1e9 = 99999999.99999999
 * This function rounds to 9 decimal places first to avoid precision loss
 */
export function solToLamports(amountSOL: number): number {
  // Round to 9 decimal places (maximum precision for SOL)
  const roundedSOL = Math.round(amountSOL * 1e9) / 1e9;
  // Convert to lamports using integer math after rounding
  return Math.round(roundedSOL * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL with precision handling
 */
export function lamportsToSOL(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

// Escrow Program ID (deployed on Devnet)
// For now using a placeholder - replace with actual deployed program ID
// Uses lazy initialization to avoid errors at import time
let _escrowProgramId: PublicKey | null = null;

export function getEscrowProgramId(): PublicKey {
  if (!_escrowProgramId) {
    const programId = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    if (!programId) {
      // Use System Program as fallback (won't work for actual escrow, but won't crash)
      _escrowProgramId = SystemProgram.programId;
    } else {
      _escrowProgramId = new PublicKey(programId);
    }
  }
  return _escrowProgramId;
}

// Legacy export - use getEscrowProgramId() instead
export const ESCROW_PROGRAM_ID = {
  toBuffer: () => getEscrowProgramId().toBuffer(),
  toBase58: () => getEscrowProgramId().toBase58(),
  equals: (other: PublicKey) => getEscrowProgramId().equals(other),
} as unknown as PublicKey;

// Escrow status enum
export enum EscrowStatus {
  Funding = 0,
  Active = 1,
  Completed = 2,
  Cancelled = 3,
  Disputed = 4,
}

// Escrow account data structure
export interface EscrowAccount {
  isInitialized: boolean;
  proposalId: string;
  agentWallet: PublicKey;
  fundingGoal: number;
  totalFunded: number;
  milestoneCount: number;
  milestonesCompleted: number;
  status: EscrowStatus;
  authority: PublicKey;
  bump: number;
}

// Instruction types
export enum EscrowInstruction {
  InitializeEscrow = 0,
  Fund = 1,
  CompleteMilestone = 2,
  CancelProposal = 3,
  ClaimRefund = 4,
}

// Find PDA for escrow account
export async function findEscrowPDA(proposalId: string): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(proposalId)],
    getEscrowProgramId()
  );
}

// Find PDA for funding record
export async function findFundingRecordPDA(
  escrow: PublicKey,
  backer: PublicKey
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('funding'), escrow.toBuffer(), backer.toBuffer()],
    getEscrowProgramId()
  );
}

// Create initialize escrow instruction
export function createInitializeEscrowInstruction(
  agent: PublicKey,
  escrowPDA: PublicKey,
  proposalId: string,
  fundingGoal: number,
  milestoneCount: number
): TransactionInstruction {
  // Encode instruction data
  const data = Buffer.alloc(1 + 32 + 8 + 1);
  data.writeUInt8(EscrowInstruction.InitializeEscrow, 0);

  // Write proposal ID (padded to 32 bytes)
  const proposalIdBuffer = Buffer.alloc(32);
  proposalIdBuffer.write(proposalId);
  proposalIdBuffer.copy(data, 1);

  // Write funding goal in lamports
  data.writeBigUInt64LE(BigInt(solToLamports(fundingGoal)), 33);

  // Write milestone count
  data.writeUInt8(milestoneCount, 41);

  return new TransactionInstruction({
    keys: [
      { pubkey: agent, isSigner: true, isWritable: true },
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: getEscrowProgramId(),
    data,
  });
}

// Create fund instruction
export function createFundInstruction(
  backer: PublicKey,
  escrowPDA: PublicKey,
  fundingRecordPDA: PublicKey,
  amount: number
): TransactionInstruction {
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(EscrowInstruction.Fund, 0);
  data.writeBigUInt64LE(BigInt(solToLamports(amount)), 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: backer, isSigner: true, isWritable: true },
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: fundingRecordPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: getEscrowProgramId(),
    data,
  });
}

// Create complete milestone instruction
export function createCompleteMilestoneInstruction(
  authority: PublicKey,
  escrowPDA: PublicKey,
  agentWallet: PublicKey,
  milestoneIndex: number
): TransactionInstruction {
  const data = Buffer.alloc(2);
  data.writeUInt8(EscrowInstruction.CompleteMilestone, 0);
  data.writeUInt8(milestoneIndex, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: agentWallet, isSigner: false, isWritable: true },
    ],
    programId: getEscrowProgramId(),
    data,
  });
}

// Create cancel proposal instruction
export function createCancelProposalInstruction(
  authority: PublicKey,
  escrowPDA: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(EscrowInstruction.CancelProposal, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
    ],
    programId: getEscrowProgramId(),
    data,
  });
}

// Create claim refund instruction
export function createClaimRefundInstruction(
  backer: PublicKey,
  escrowPDA: PublicKey,
  fundingRecordPDA: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(EscrowInstruction.ClaimRefund, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: backer, isSigner: true, isWritable: true },
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: fundingRecordPDA, isSigner: false, isWritable: true },
    ],
    programId: getEscrowProgramId(),
    data,
  });
}

// Helper to check if escrow program is deployed
export async function isEscrowProgramDeployed(connection: Connection): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(getEscrowProgramId());
    return accountInfo !== null && accountInfo.executable;
  } catch {
    return false;
  }
}

// For MVP: Simple escrow using direct transfer (no program needed)
// This is a temporary solution until the program is deployed
export async function createSimpleFundingTransaction(
  connection: Connection,
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

// Escrow mode configuration
let _platformAuthority: PublicKey | null = null;

function getPlatformAuthority(): PublicKey {
  if (!_platformAuthority) {
    const authority = process.env.NEXT_PUBLIC_PLATFORM_AUTHORITY;
    if (!authority) {
      _platformAuthority = SystemProgram.programId;
    } else {
      _platformAuthority = new PublicKey(authority);
    }
  }
  return _platformAuthority;
}

export const ESCROW_MODE = {
  // Set to true when escrow program is deployed
  USE_PROGRAM: false,

  // Platform authority for milestone verification (getter function)
  get PLATFORM_AUTHORITY(): PublicKey {
    return getPlatformAuthority();
  },
};

// Platform escrow wallet - funds are held here until milestone completion
// Uses lazy initialization to avoid errors when env vars aren't set
let _platformEscrowWallet: PublicKey | null = null;

export function getPlatformEscrowWallet(): PublicKey {
  if (!_platformEscrowWallet) {
    const walletAddress = process.env.NEXT_PUBLIC_ESCROW_WALLET || process.env.NEXT_PUBLIC_PLATFORM_AUTHORITY;
    if (!walletAddress || walletAddress === '11111111111111111111111111111111') {
      throw new Error('NEXT_PUBLIC_ESCROW_WALLET environment variable not configured');
    }
    _platformEscrowWallet = new PublicKey(walletAddress);
  }
  return _platformEscrowWallet;
}

// Legacy export for backwards compatibility - only use when escrow is configured
export const PLATFORM_ESCROW_WALLET = {
  toBase58: () => {
    const wallet = process.env.NEXT_PUBLIC_ESCROW_WALLET;
    if (!wallet || wallet === '11111111111111111111111111111111') {
      throw new Error('Escrow wallet not configured');
    }
    return wallet;
  }
};

// Check if escrow is properly configured
export function isEscrowConfigured(): boolean {
  const escrowWallet = process.env.NEXT_PUBLIC_ESCROW_WALLET;
  return !!escrowWallet && escrowWallet !== '11111111111111111111111111111111';
}

// ============================================================================
// Server-side escrow functions
// ============================================================================

/**
 * Load escrow keypair from ESCROW_WALLET_PRIVATE_KEY environment variable
 * The private key should be base58 encoded
 * @returns Keypair for the escrow wallet
 * @throws Error if ESCROW_WALLET_PRIVATE_KEY is not set
 */
export function getEscrowKeypair(): Keypair {
  const privateKeyBase58 = process.env.ESCROW_WALLET_PRIVATE_KEY;
  if (!privateKeyBase58) {
    throw new Error('ESCROW_WALLET_PRIVATE_KEY environment variable is not set');
  }
  const privateKeyBytes = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(privateKeyBytes);
}

/**
 * Transfer funds from escrow wallet to agent wallet
 * @param agentWallet - The agent's wallet address (base58 string)
 * @param amountSOL - Amount to transfer in SOL
 * @returns Transaction signature
 */
export async function releaseToAgent(agentWallet: string, amountSOL: number): Promise<string> {
  const escrowKeypair = getEscrowKeypair();
  const agentPubkey = new PublicKey(agentWallet);

  const transaction = new Transaction();
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: agentPubkey,
      lamports: solToLamports(amountSOL),
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = escrowKeypair.publicKey;

  transaction.sign(escrowKeypair);

  const signature = await connection.sendRawTransaction(transaction.serialize());
  // SECURITY: Use 'finalized' commitment for permanent transaction confirmation
  await connection.confirmTransaction(signature, 'finalized');

  return signature;
}

/**
 * Transfer funds from escrow wallet back to backer wallet (refund)
 * @param backerWallet - The backer's wallet address (base58 string)
 * @param amountSOL - Amount to refund in SOL
 * @returns Transaction signature
 */
export async function refundToBacker(backerWallet: string, amountSOL: number): Promise<string> {
  const escrowKeypair = getEscrowKeypair();
  const backerPubkey = new PublicKey(backerWallet);

  const transaction = new Transaction();
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: backerPubkey,
      lamports: solToLamports(amountSOL),
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = escrowKeypair.publicKey;

  transaction.sign(escrowKeypair);

  const signature = await connection.sendRawTransaction(transaction.serialize());
  // SECURITY: Use 'finalized' commitment for permanent transaction confirmation
  await connection.confirmTransaction(signature, 'finalized');

  return signature;
}

/**
 * Verify a transaction was successful on-chain
 * @param signature - Transaction signature to verify
 * @param expectedRecipient - Expected recipient wallet address
 * @param expectedAmountSOL - Expected amount in SOL
 * @returns Verification result
 */
export async function verifyTransactionSuccess(
  signature: string,
  expectedRecipient: string,
  expectedAmountSOL: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { valid: false, error: 'Transaction not found' };
    }

    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on-chain' };
    }

    // Verify recipient received funds
    const accountKeys = tx.transaction.message.getAccountKeys();
    let recipientIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      if (accountKeys.get(i)?.toBase58() === expectedRecipient) {
        recipientIndex = i;
        break;
      }
    }

    if (recipientIndex === -1) {
      return { valid: false, error: 'Recipient not found in transaction' };
    }

    // Check amount received
    const preBalance = tx.meta?.preBalances?.[recipientIndex] || 0;
    const postBalance = tx.meta?.postBalances?.[recipientIndex] || 0;
    const receivedLamports = postBalance - preBalance;
    const receivedSOL = receivedLamports / LAMPORTS_PER_SOL;

    // Allow 0.1% tolerance for rounding
    const tolerance = expectedAmountSOL * 0.001;
    if (Math.abs(receivedSOL - expectedAmountSOL) > tolerance) {
      return { valid: false, error: `Amount mismatch: expected ${expectedAmountSOL}, got ${receivedSOL}` };
    }

    return { valid: true };
  } catch (error) {
    console.error('[Escrow] Transaction verification error:', error);
    return { valid: false, error: 'Verification failed' };
  }
}

/**
 * Get the current balance of the escrow wallet
 * @returns Balance in SOL
 */
export async function getEscrowBalance(): Promise<number> {
  const escrowKeypair = getEscrowKeypair();
  const balance = await connection.getBalance(escrowKeypair.publicKey);
  return balance / LAMPORTS_PER_SOL;
}
