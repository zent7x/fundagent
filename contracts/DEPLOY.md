# Escrow Contract Deployment Guide

## Prerequisites

1. **Install Rust**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Install Solana CLI**
   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   ```

3. **Install Anchor**
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```

## Setup

1. **Configure Solana CLI for Devnet**
   ```bash
   solana config set --url https://api.devnet.solana.com
   ```

2. **Create a keypair (if you don't have one)**
   ```bash
   solana-keygen new --outfile ~/.config/solana/id.json
   ```

3. **Get Devnet SOL**
   ```bash
   solana airdrop 2
   ```

## Initialize Anchor Project

1. **Create new Anchor project**
   ```bash
   anchor init agentfund-escrow
   cd agentfund-escrow
   ```

2. **Copy the escrow program**
   Copy `escrow.rs` to `programs/agentfund-escrow/src/lib.rs`

3. **Update Anchor.toml**
   ```toml
   [features]
   seeds = false
   skip-lint = false

   [programs.devnet]
   agentfund_escrow = "YOUR_PROGRAM_ID"

   [provider]
   cluster = "devnet"
   wallet = "~/.config/solana/id.json"
   ```

## Build and Deploy

1. **Build the program**
   ```bash
   anchor build
   ```

2. **Get the program ID**
   ```bash
   solana address -k target/deploy/agentfund_escrow-keypair.json
   ```

3. **Update program ID in lib.rs**
   ```rust
   declare_id!("YOUR_PROGRAM_ID_HERE");
   ```

4. **Rebuild and deploy**
   ```bash
   anchor build
   anchor deploy --provider.cluster devnet
   ```

## Configure the App

1. **Add the program ID to .env.local**
   ```
   NEXT_PUBLIC_ESCROW_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID
   ```

2. **Update escrow mode**
   In `src/lib/escrow.ts`, set:
   ```typescript
   export const ESCROW_MODE = {
     USE_PROGRAM: true,
     PLATFORM_AUTHORITY: new PublicKey('YOUR_AUTHORITY_PUBKEY'),
   };
   ```

## Testing

Run the test suite:
```bash
anchor test
```

## Verification

After deployment, verify on Solana Explorer:
```
https://explorer.solana.com/address/YOUR_PROGRAM_ID?cluster=devnet
```

## Current Status

The app is configured to work with **direct transfers** as a fallback when the escrow program is not deployed. This means:

- Funds are sent directly to the agent's wallet
- Milestone verification is tracked in the database
- No on-chain escrow protection (funds are released immediately)

Once the program is deployed, the app will automatically use the escrow for:
- Locking funds in a PDA until milestones are verified
- Releasing funds proportionally as milestones complete
- Enabling refunds if the project is cancelled
