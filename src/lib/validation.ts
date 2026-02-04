/**
 * Input Validation Module
 *
 * Schema-based validation using Zod with:
 * - Type checking and coercion
 * - Length limits to prevent abuse
 * - Format validation (wallet addresses, etc.)
 * - Rejection of unexpected fields
 * - Sanitization of string inputs
 *
 * OWASP: Protects against injection, XSS, and malformed data attacks
 */

import { z } from 'zod';

// =============================================================================
// COMMON VALIDATORS
// =============================================================================

/**
 * Solana wallet address validator
 * Base58 encoded, 32-44 characters
 */
export const walletAddressSchema = z
  .string()
  .min(32, 'Wallet address too short')
  .max(44, 'Wallet address too long')
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid wallet address format');

/**
 * Safe string - strips HTML tags and trims whitespace
 */
export const safeString = (minLength = 0, maxLength = 1000) =>
  z
    .string()
    .min(minLength)
    .max(maxLength)
    .transform((val) => {
      // Remove HTML tags
      const stripped = val.replace(/<[^>]*>/g, '');
      // Trim whitespace
      return stripped.trim();
    });

/**
 * Sanitize string for safe display
 */
export function sanitizeString(input: string): string {
  if (!input) return '';
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

// =============================================================================
// PROPOSAL SCHEMAS
// =============================================================================

/**
 * Milestone schema
 */
const milestoneSchema = z.object({
  title: safeString(1, 200),
  description: safeString(1, 1000),
  percentage: z.number().int().min(1).max(100),
});

/**
 * Create proposal request schema
 */
export const createProposalSchema = z
  .object({
    walletAddress: walletAddressSchema,
    agentName: safeString(1, 100),
    title: safeString(1, 200),
    description: safeString(1, 2000),
    problem: safeString(1, 2000),
    solution: safeString(1, 2000),
    fundingGoal: z.coerce
      .number()
      .positive('Funding goal must be positive')
      .max(10000, 'Funding goal must be 10000 SOL or less'),
    category: z.enum([
      'Developer Tools',
      'DeFi',
      'Marketing',
      'Consumer',
      'Infrastructure',
      'AI/ML',
      'Other',
    ]),
    timeline: safeString(1, 100),
    agentCapabilities: safeString(0, 2000).optional().default(''),
    humanNeeds: safeString(0, 2000).optional().default(''),
    milestones: z
      .array(milestoneSchema)
      .min(1, 'At least one milestone required')
      .max(10, 'Maximum 10 milestones allowed')
      .refine(
        (milestones) => {
          const total = milestones.reduce((sum, m) => sum + m.percentage, 0);
          return total === 100;
        },
        { message: 'Milestone percentages must sum to 100' }
      ),
  })
  .strict(); // Reject unexpected fields

/**
 * Fund proposal request schema
 */
export const fundProposalSchema = z
  .object({
    walletAddress: walletAddressSchema,
    amount: z
      .number()
      .positive('Amount must be positive')
      .max(10000, 'Amount too large'),
    txSignature: z
      .string()
      .min(80, 'Invalid transaction signature')
      .max(100, 'Invalid transaction signature')
      .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid transaction signature format'),
  })
  .strict();

// =============================================================================
// MESSAGE SCHEMAS
// =============================================================================

/**
 * Send message request schema
 */
export const sendMessageSchema = z
  .object({
    walletAddress: walletAddressSchema,
    content: safeString(1, 5000),
    proposalId: z.string().min(1).max(50),
  })
  .strict();

// =============================================================================
// AUTHENTICATION SCHEMAS
// =============================================================================

/**
 * Signature-based authentication schema
 * Required for all admin and sensitive operations
 */
export const authSchema = z.object({
  walletAddress: walletAddressSchema,
  signature: z
    .string()
    .min(80, 'Invalid signature')
    .max(150, 'Invalid signature')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid signature format'),
  message: z.string().min(1).max(1000),
  timestamp: z.number().int().positive(),
  nonce: z
    .string()
    .min(40, 'Invalid nonce')
    .max(50, 'Invalid nonce')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid nonce format'),
});

// =============================================================================
// ADMIN SCHEMAS
// =============================================================================

/**
 * Admin action request schema - NOW REQUIRES SIGNATURE
 */
export const adminActionSchema = z
  .object({
    // Authentication (required)
    auth: authSchema,
    // Action details
    action: z.enum([
      'ban_user',
      'unban_user',
      'ban_create',
      'unban_wallet',
      'close_proposal',
      'reopen_proposal',
      'delete_proposal',
      'make_admin',
      'remove_admin',
      'cancel_proposal',
    ]),
    targetWallet: walletAddressSchema.optional(),
    targetId: z.string().min(1).max(50).optional(),
    reason: safeString(0, 500).optional(),
  })
  .strict()
  .refine(
    (data) => {
      // Ensure required fields based on action type
      const walletActions = ['ban_user', 'unban_user', 'ban_create', 'unban_wallet', 'make_admin', 'remove_admin'];
      const idActions = ['close_proposal', 'reopen_proposal', 'delete_proposal', 'cancel_proposal'];

      if (walletActions.includes(data.action) && !data.targetWallet) {
        return false;
      }
      if (idActions.includes(data.action) && !data.targetId) {
        return false;
      }
      return true;
    },
    { message: 'Missing required field for this action type' }
  );

// =============================================================================
// LOGGING SCHEMAS
// =============================================================================

/**
 * Activity log request schema
 */
export const activityLogSchema = z
  .object({
    walletAddress: walletAddressSchema.nullable().optional(),
    sessionId: z.string().max(100).optional(),
    action: safeString(1, 50),
    actionDetails: z.record(z.unknown()).optional(),
    page: safeString(0, 200).optional(),
    element: safeString(0, 100).optional(),
    screenWidth: z.number().int().min(0).max(10000).optional(),
    screenHeight: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

// =============================================================================
// QUERY PARAM SCHEMAS
// =============================================================================

/**
 * Proposal list query schema
 */
export const proposalQuerySchema = z.object({
  category: z.string().max(50).optional(),
  status: z.enum(['all', 'funding', 'funded', 'building', 'completed', 'closed']).optional(),
  search: safeString(0, 100).optional(),
});

/**
 * Admin query schema - requires signature for GET requests too
 */
export const adminQuerySchema = z.object({
  wallet: walletAddressSchema,
  signature: z.string().min(80).max(150).optional(), // For backwards compat, enforce in route
  message: z.string().max(1000).optional(),
  timestamp: z.coerce.number().int().positive().optional(),
  nonce: z.string().max(50).optional(),
});

/**
 * Authenticated admin query schema - strict version
 */
export const adminAuthQuerySchema = z.object({
  wallet: walletAddressSchema,
  signature: z
    .string()
    .min(80, 'Invalid signature')
    .max(150, 'Invalid signature')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid signature format'),
  message: z.string().min(1).max(1000),
  timestamp: z.coerce.number().int().positive(),
  nonce: z
    .string()
    .min(40, 'Invalid nonce')
    .max(50, 'Invalid nonce')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid nonce format'),
});

/**
 * Logs query schema (legacy)
 */
export const logsQuerySchema = z.object({
  wallet: walletAddressSchema,
  searchWallet: walletAddressSchema.optional(),
  action: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * Authenticated logs query schema - requires signature verification
 */
export const logsAuthQuerySchema = z.object({
  wallet: walletAddressSchema,
  signature: z
    .string()
    .min(80, 'Invalid signature')
    .max(150, 'Invalid signature')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid signature format'),
  message: z.string().min(1).max(1000),
  timestamp: z.coerce.number().int().positive(),
  nonce: z
    .string()
    .min(40, 'Invalid nonce')
    .max(50, 'Invalid nonce')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid nonce format'),
  searchWallet: walletAddressSchema.optional(),
  action: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * Message query schema
 */
export const messageQuerySchema = z.object({
  proposalId: z.string().min(1).max(50),
});

/**
 * Create message schema (legacy)
 */
export const createMessageSchema = z
  .object({
    proposalId: z.string().min(1).max(50),
    walletAddress: walletAddressSchema,
    content: safeString(1, 5000),
    isEncrypted: z.boolean().optional().default(false),
    adminContent: safeString(0, 5000).optional(),
  })
  .strict();

/**
 * Authenticated create message schema - requires signature verification
 */
export const createMessageAuthSchema = z
  .object({
    auth: z.object({
      walletAddress: walletAddressSchema,
      signature: z
        .string()
        .min(80, 'Invalid signature')
        .max(150, 'Invalid signature')
        .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid signature format'),
      message: z.string().min(1).max(1000),
      timestamp: z.coerce.number().int().positive(),
      nonce: z
        .string()
        .min(40, 'Invalid nonce')
        .max(50, 'Invalid nonce')
        .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid nonce format'),
    }),
    proposalId: z.string().min(1).max(50),
    content: safeString(1, 5000),
    isEncrypted: z.boolean().optional().default(false),
    adminContent: safeString(0, 5000).optional(),
  })
  .strict();

/**
 * Proposal ID param schema
 */
export const proposalIdSchema = z.object({
  id: z.string().min(1).max(50),
});

/**
 * Milestone query schema
 */
export const milestoneQuerySchema = z.object({
  proposalId: z.string().min(1).max(50),
});

/**
 * Submit milestone schema
 */
export const submitMilestoneSchema = z
  .object({
    milestoneId: z.string().min(1).max(50),
    walletAddress: walletAddressSchema,
    deliverables: safeString(1, 2000),
    proofUrl: z.string().url().max(500).optional(),
  })
  .strict();

/**
 * Verify milestone schema
 */
export const verifyMilestoneSchema = z
  .object({
    milestoneId: z.string().min(1).max(50),
    walletAddress: walletAddressSchema,
    action: z.enum(['complete', 'reject']),
  })
  .strict();

/**
 * Auth data schema for wallet signature verification
 */
const authDataSchema = z.object({
  walletAddress: walletAddressSchema,
  signature: z
    .string()
    .min(80, 'Invalid signature')
    .max(150, 'Invalid signature')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid signature format'),
  message: z.string().min(1).max(1000),
  timestamp: z.coerce.number().int().positive(),
  nonce: z
    .string()
    .min(40, 'Invalid nonce')
    .max(50, 'Invalid nonce')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid nonce format'),
});

/**
 * Authenticated submit milestone schema - requires signature verification
 */
export const submitMilestoneAuthSchema = z
  .object({
    auth: authDataSchema,
    milestoneId: z.string().min(1).max(50),
    deliverables: safeString(1, 2000),
    proofUrl: z.string().url().max(500).optional(),
  })
  .strict();

/**
 * Authenticated verify milestone schema - requires signature verification
 */
export const verifyMilestoneAuthSchema = z
  .object({
    auth: authDataSchema,
    milestoneId: z.string().min(1).max(50),
    action: z.enum(['complete', 'reject']),
  })
  .strict();

/**
 * Admin proposal action schema
 */
export const adminProposalActionSchema = z
  .object({
    proposalId: z.string().min(1).max(50),
    walletAddress: walletAddressSchema,
    action: z.enum(['delete', 'approve', 'reject']),
  })
  .strict();

// =============================================================================
// AUTHENTICATED PROPOSAL SCHEMAS
// =============================================================================

/**
 * Milestone schema for proposal creation
 */
const proposalMilestoneSchema = z.object({
  title: safeString(1, 200),
  description: safeString(1, 1000),
  percentage: z.number().int().min(1).max(100),
});

/**
 * Authenticated create proposal schema - requires signature verification
 * This proves the creator actually owns the wallet they claim
 */
export const createProposalAuthSchema = z
  .object({
    auth: authDataSchema,
    agentName: safeString(1, 100),
    title: safeString(1, 200),
    description: safeString(1, 2000),
    problem: safeString(1, 2000),
    solution: safeString(1, 2000),
    fundingGoal: z.coerce
      .number()
      .positive('Funding goal must be positive')
      .max(10000, 'Funding goal must be 10000 SOL or less'),
    category: z.enum([
      'Developer Tools',
      'DeFi',
      'Marketing',
      'Consumer',
      'Infrastructure',
      'AI/ML',
      'Other',
    ]),
    timeline: safeString(1, 100),
    agentCapabilities: safeString(0, 2000).optional().default(''),
    humanNeeds: safeString(0, 2000).optional().default(''),
    milestones: z
      .array(proposalMilestoneSchema)
      .min(1, 'At least one milestone required')
      .max(10, 'Maximum 10 milestones allowed')
      .refine(
        (milestones) => {
          const total = milestones.reduce((sum, m) => sum + m.percentage, 0);
          return total === 100;
        },
        { message: 'Milestone percentages must sum to 100' }
      ),
  })
  .strict();

/**
 * Authenticated create update schema - requires signature verification
 * This proves the updater actually owns the agent wallet
 */
export const createUpdateAuthSchema = z
  .object({
    auth: authDataSchema,
    content: safeString(1, 2000),
  })
  .strict();

// =============================================================================
// RELEASE AND REFUND SCHEMAS
// =============================================================================

/**
 * Release auth schema - For backers releasing funds to agent
 */
export const releaseAuthSchema = z
  .object({
    auth: authDataSchema,
    fundingId: z.string().min(1).max(50).optional(), // Optional: specific funding to release
  })
  .strict();

/**
 * Refund claim schema - For backers claiming refunds
 */
export const refundClaimSchema = z
  .object({
    auth: authDataSchema,
    fundingId: z.string().min(1).max(50).optional(), // Optional: specific funding to refund
  })
  .strict();

/**
 * Enable refund schema - For admin enabling refunds on a proposal
 */
export const enableRefundSchema = z
  .object({
    auth: authSchema,
    reason: safeString(0, 500).optional(),
  })
  .strict();

// =============================================================================
// VALIDATION HELPER
// =============================================================================

/**
 * Validate request body against a schema
 * Returns parsed data or throws validation error
 */
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T> {
  try {
    const body = await request.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError(messages.join('; '));
    }
    throw new ValidationError('Invalid request body');
  }
}

/**
 * Validate query parameters against a schema
 */
export function validateQuery<T>(
  searchParams: URLSearchParams,
  schema: z.ZodSchema<T>
): T {
  const params = Object.fromEntries(searchParams.entries());
  return schema.parse(params);
}

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
