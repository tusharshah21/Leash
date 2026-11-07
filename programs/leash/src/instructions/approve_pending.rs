use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    transfer_from_vault, ActionApproved, LeashError, Mandate, PendingAction, PendingStatus, Vault,
    MANDATE_SEED, PENDING_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ApprovePending<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [MANDATE_SEED, vault.key().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        mut,
        seeds = [PENDING_SEED, vault.key().as_ref(), &nonce.to_le_bytes()],
        bump = pending_action.bump,
    )]
    pub pending_action: Account<'info, PendingAction>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == pending_action.recipient
            @ LeashError::RecipientMismatch,
        constraint = recipient_token_account.mint == vault.mint @ LeashError::RecipientMismatch,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Works while paused and after the mandate expires: human authority survives both.
/// May exceed daily_cap, because a human chose to. Agent spending then stays blocked until the
/// window resets, since `spent_today` remains over the cap.
pub fn handle_approve_pending(ctx: Context<ApprovePending>, nonce: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let authority = ctx.accounts.authority.key();
    let mandate = &mut ctx.accounts.mandate;
    let pending = &mut ctx.accounts.pending_action;

    ctx.accounts.vault.check_owner_or_device(&authority)?;
    ctx.accounts.vault.check_current(nonce)?;
    pending.check_open(mandate.pending_ttl_secs, now)?;

    // Roll first, so the spend counts against the current window and not one that has ended.
    mandate.roll_window(now)?;
    mandate.spent_today = mandate.spent_today.saturating_add(pending.amount);
    pending.status = PendingStatus::Executed;

    transfer_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.vault_token_account,
        &ctx.accounts.mint,
        &ctx.accounts.recipient_token_account,
        &ctx.accounts.token_program,
        pending.amount,
    )?;

    emit!(ActionApproved {
        vault: ctx.accounts.vault.key(),
        nonce,
        approver: authority,
    });
    Ok(())
}
