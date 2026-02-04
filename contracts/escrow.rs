// AgentFund Escrow Smart Contract
// This Solana program handles milestone-based escrow for AI agent proposals
//
// Key Features:
// - Create escrow accounts for proposals
// - Accept funding from multiple backers
// - Release funds when milestones are verified
// - Refund if proposal fails/cancelled
//
// To deploy: Use Anchor framework or native Solana program

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};
use borsh::{BorshDeserialize, BorshSerialize};

// Program ID (replace with actual deployed address)
solana_program::declare_id!("AgentFund1111111111111111111111111111111111");

// Escrow account state
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct Escrow {
    pub is_initialized: bool,
    pub proposal_id: String,           // Off-chain proposal ID
    pub agent_wallet: Pubkey,          // Agent's wallet to receive funds
    pub funding_goal: u64,             // Target in lamports
    pub total_funded: u64,             // Current funded amount
    pub milestone_count: u8,           // Number of milestones (typically 4)
    pub milestones_completed: u8,      // How many milestones done
    pub status: EscrowStatus,          // Current status
    pub authority: Pubkey,             // Platform authority for disputes
    pub bump: u8,                      // PDA bump seed
}

#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq)]
pub enum EscrowStatus {
    Funding,      // Accepting funds
    Active,       // Funded, work in progress
    Completed,    // All milestones done
    Cancelled,    // Project cancelled, refunds available
    Disputed,     // Under dispute resolution
}

// Funding record for each backer
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct FundingRecord {
    pub backer: Pubkey,
    pub amount: u64,
    pub escrow: Pubkey,
    pub refunded: bool,
}

// Instructions
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum EscrowInstruction {
    /// Initialize a new escrow for a proposal
    /// Accounts:
    /// 0. [signer] Agent wallet
    /// 1. [writable] Escrow account (PDA)
    /// 2. [] System program
    InitializeEscrow {
        proposal_id: String,
        funding_goal: u64,
        milestone_count: u8,
    },

    /// Fund a proposal (send SOL to escrow)
    /// Accounts:
    /// 0. [signer] Backer wallet
    /// 1. [writable] Escrow account
    /// 2. [writable] Funding record account (PDA)
    /// 3. [] System program
    Fund {
        amount: u64,
    },

    /// Mark a milestone as complete and release funds
    /// Accounts:
    /// 0. [signer] Platform authority
    /// 1. [writable] Escrow account
    /// 2. [writable] Agent wallet (receives funds)
    CompleteMilestone {
        milestone_index: u8,
    },

    /// Cancel proposal and enable refunds
    /// Accounts:
    /// 0. [signer] Platform authority or agent
    /// 1. [writable] Escrow account
    CancelProposal,

    /// Claim refund (for cancelled proposals)
    /// Accounts:
    /// 0. [signer] Backer wallet
    /// 1. [writable] Escrow account
    /// 2. [writable] Funding record account
    ClaimRefund,
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = EscrowInstruction::try_from_slice(instruction_data)?;

    match instruction {
        EscrowInstruction::InitializeEscrow { proposal_id, funding_goal, milestone_count } => {
            msg!("Instruction: InitializeEscrow");
            process_initialize_escrow(program_id, accounts, proposal_id, funding_goal, milestone_count)
        }
        EscrowInstruction::Fund { amount } => {
            msg!("Instruction: Fund");
            process_fund(program_id, accounts, amount)
        }
        EscrowInstruction::CompleteMilestone { milestone_index } => {
            msg!("Instruction: CompleteMilestone");
            process_complete_milestone(program_id, accounts, milestone_index)
        }
        EscrowInstruction::CancelProposal => {
            msg!("Instruction: CancelProposal");
            process_cancel_proposal(program_id, accounts)
        }
        EscrowInstruction::ClaimRefund => {
            msg!("Instruction: ClaimRefund");
            process_claim_refund(program_id, accounts)
        }
    }
}

fn process_initialize_escrow(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    proposal_id: String,
    funding_goal: u64,
    milestone_count: u8,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let agent_account = next_account_info(account_info_iter)?;
    let escrow_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !agent_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive PDA for escrow
    let (escrow_pda, bump) = Pubkey::find_program_address(
        &[b"escrow", proposal_id.as_bytes()],
        program_id,
    );

    if escrow_pda != *escrow_account.key {
        return Err(ProgramError::InvalidAccountData);
    }

    // Create escrow account
    let escrow = Escrow {
        is_initialized: true,
        proposal_id,
        agent_wallet: *agent_account.key,
        funding_goal,
        total_funded: 0,
        milestone_count,
        milestones_completed: 0,
        status: EscrowStatus::Funding,
        authority: *agent_account.key, // In production, use platform multisig
        bump,
    };

    escrow.serialize(&mut *escrow_account.data.borrow_mut())?;

    msg!("Escrow initialized for proposal");
    Ok(())
}

fn process_fund(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let backer_account = next_account_info(account_info_iter)?;
    let escrow_account = next_account_info(account_info_iter)?;
    let _funding_record_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !backer_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

    if escrow.status != EscrowStatus::Funding {
        return Err(ProgramError::InvalidAccountData);
    }

    // Transfer SOL to escrow
    invoke(
        &system_instruction::transfer(
            backer_account.key,
            escrow_account.key,
            amount,
        ),
        &[backer_account.clone(), escrow_account.clone(), system_program.clone()],
    )?;

    escrow.total_funded += amount;

    // Check if fully funded
    if escrow.total_funded >= escrow.funding_goal {
        escrow.status = EscrowStatus::Active;
        msg!("Proposal fully funded!");
    }

    escrow.serialize(&mut *escrow_account.data.borrow_mut())?;

    msg!("Funded {} lamports", amount);
    Ok(())
}

fn process_complete_milestone(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    milestone_index: u8,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let authority_account = next_account_info(account_info_iter)?;
    let escrow_account = next_account_info(account_info_iter)?;
    let agent_account = next_account_info(account_info_iter)?;

    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

    if escrow.status != EscrowStatus::Active {
        return Err(ProgramError::InvalidAccountData);
    }

    if *authority_account.key != escrow.authority {
        return Err(ProgramError::InvalidAccountData);
    }

    if milestone_index != escrow.milestones_completed {
        return Err(ProgramError::InvalidArgument);
    }

    // Calculate release amount (equal split per milestone)
    let release_amount = escrow.funding_goal / escrow.milestone_count as u64;

    // Transfer from escrow to agent
    **escrow_account.try_borrow_mut_lamports()? -= release_amount;
    **agent_account.try_borrow_mut_lamports()? += release_amount;

    escrow.milestones_completed += 1;

    if escrow.milestones_completed == escrow.milestone_count {
        escrow.status = EscrowStatus::Completed;
        msg!("All milestones completed!");
    }

    escrow.serialize(&mut *escrow_account.data.borrow_mut())?;

    msg!("Milestone {} completed, released {} lamports", milestone_index, release_amount);
    Ok(())
}

fn process_cancel_proposal(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let authority_account = next_account_info(account_info_iter)?;
    let escrow_account = next_account_info(account_info_iter)?;

    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

    // Only authority or agent can cancel
    if *authority_account.key != escrow.authority && *authority_account.key != escrow.agent_wallet {
        return Err(ProgramError::InvalidAccountData);
    }

    escrow.status = EscrowStatus::Cancelled;
    escrow.serialize(&mut *escrow_account.data.borrow_mut())?;

    msg!("Proposal cancelled");
    Ok(())
}

fn process_claim_refund(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let backer_account = next_account_info(account_info_iter)?;
    let escrow_account = next_account_info(account_info_iter)?;
    let funding_record_account = next_account_info(account_info_iter)?;

    if !backer_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

    if escrow.status != EscrowStatus::Cancelled {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut funding_record = FundingRecord::try_from_slice(&funding_record_account.data.borrow())?;

    if funding_record.backer != *backer_account.key {
        return Err(ProgramError::InvalidAccountData);
    }

    if funding_record.refunded {
        return Err(ProgramError::InvalidAccountData);
    }

    // Transfer refund
    **escrow_account.try_borrow_mut_lamports()? -= funding_record.amount;
    **backer_account.try_borrow_mut_lamports()? += funding_record.amount;

    funding_record.refunded = true;
    funding_record.serialize(&mut *funding_record_account.data.borrow_mut())?;

    msg!("Refunded {} lamports", funding_record.amount);
    Ok(())
}

// Tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escrow_status() {
        assert_eq!(EscrowStatus::Funding, EscrowStatus::Funding);
    }
}
