use anchor_lang::prelude::*;

use crate::{
    ActionPending, LeashError, Mandate, PendingAction, PendingStatus, Vault, MANDATE_SEED,
    PENDING_SEED, VAULT_SEED,
};

#[derive(Accounts)]
pub struct AgentPropose<'info> {
    /// Pays the rent, so the agent needs SOL.
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [MANDATE_SEED, vault.key().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        init,
        payer = agent,
        space = 8 + PendingAction::INIT_SPACE,
        seeds = [PENDING_SEED, vault.key().as_ref(), &vault.pending_nonce.to_le_bytes()],
        bump,
    )]
    pub pending_action: Account<'info, PendingAction>,

    pub system_program: Program<'info, System>,
}

/// Any proposal is allowed, including one that would be LOW or MEDIUM or is not allowlisted:
/// the agent may always escalate, and a proposal moves no funds until a human approves it.
pub fn handle_agent_propose(
    ctx: Context<AgentPropose>,
    amount: u64,
    recipient: Pubkey,
    reason_hash: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;

    vault.check_agent(&ctx.accounts.agent.key(), &ctx.accounts.mandate, now)?;
    require!(amount > 0, LeashError::InvalidAmount);

    let nonce = vault.pending_nonce;
    vault.pending_nonce = nonce.checked_add(1).ok_or(LeashError::MathOverflow)?;

    let pending = &mut ctx.accounts.pending_action;
    pending.vault = vault.key();
    pending.recipient = recipient;
    pending.amount = amount;
    pending.reason_hash = reason_hash;
    pending.status = PendingStatus::Pending;
    pending.created_at = now;
    pending.bump = ctx.bumps.pending_action;

    emit!(ActionPending {
        vault: vault.key(),
        nonce,
        amount,
        recipient,
        reason_hash,
    });
    Ok(())
}
