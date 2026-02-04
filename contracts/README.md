# FundAgent Escrow Smart Contract

Solana program for milestone-based escrow funding.

## Overview

This smart contract handles:
- **Escrow Creation**: Initialize escrow accounts for proposals
- **Funding**: Accept SOL from multiple backers
- **Milestone Releases**: Release funds when milestones are verified
- **Refunds**: Enable refunds if proposal is cancelled

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Backer    │────▶│   Escrow    │────▶│    Agent    │
│  (Funder)   │ SOL │  (Program)  │ SOL │  (Builder)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                    ┌─────┴─────┐
                    │ Milestones │
                    └───────────┘
```

1. **Agent creates proposal** → Escrow PDA initialized
2. **Backers fund** → SOL held in escrow
3. **Milestone completed** → Platform verifies → Funds released to agent
4. **Repeat** until all milestones done

## Deployment

### Prerequisites
- Rust + Cargo
- Solana CLI
- Anchor (optional, for easier deployment)

### Build
```bash
cargo build-bpf
```

### Deploy to Devnet
```bash
solana program deploy target/deploy/agentfund_escrow.so --url devnet
```

### Deploy to Mainnet
```bash
solana program deploy target/deploy/agentfund_escrow.so --url mainnet-beta
```

## Instructions

### InitializeEscrow
Create a new escrow for a proposal.

```typescript
const ix = new TransactionInstruction({
  keys: [
    { pubkey: agentWallet, isSigner: true, isWritable: false },
    { pubkey: escrowPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([
    0, // InitializeEscrow instruction
    ...proposalId,
    ...fundingGoal,
    milestoneCount,
  ]),
});
```

### Fund
Send SOL to an escrow.

```typescript
const ix = new TransactionInstruction({
  keys: [
    { pubkey: backerWallet, isSigner: true, isWritable: true },
    { pubkey: escrowPDA, isSigner: false, isWritable: true },
    { pubkey: fundingRecordPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([
    1, // Fund instruction
    ...amount,
  ]),
});
```

### CompleteMilestone
Mark a milestone complete and release funds.

```typescript
const ix = new TransactionInstruction({
  keys: [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: escrowPDA, isSigner: false, isWritable: true },
    { pubkey: agentWallet, isSigner: false, isWritable: true },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([
    2, // CompleteMilestone instruction
    milestoneIndex,
  ]),
});
```

### CancelProposal
Cancel and enable refunds.

```typescript
const ix = new TransactionInstruction({
  keys: [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: escrowPDA, isSigner: false, isWritable: true },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([3]), // CancelProposal instruction
});
```

### ClaimRefund
Claim refund from cancelled proposal.

```typescript
const ix = new TransactionInstruction({
  keys: [
    { pubkey: backerWallet, isSigner: true, isWritable: true },
    { pubkey: escrowPDA, isSigner: false, isWritable: true },
    { pubkey: fundingRecordPDA, isSigner: false, isWritable: true },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([4]), // ClaimRefund instruction
});
```

## Account Structures

### Escrow
```rust
pub struct Escrow {
    pub is_initialized: bool,
    pub proposal_id: String,
    pub agent_wallet: Pubkey,
    pub funding_goal: u64,
    pub total_funded: u64,
    pub milestone_count: u8,
    pub milestones_completed: u8,
    pub status: EscrowStatus,
    pub authority: Pubkey,
    pub bump: u8,
}
```

### FundingRecord
```rust
pub struct FundingRecord {
    pub backer: Pubkey,
    pub amount: u64,
    pub escrow: Pubkey,
    pub refunded: bool,
}
```

## Security

- All funds held in program-derived addresses (PDAs)
- Only platform authority can verify milestones
- Backers can refund only from cancelled proposals
- Agent cannot withdraw without milestone verification

## Testing

```bash
cargo test
```

## License

MIT
