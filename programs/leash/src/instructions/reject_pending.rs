use anchor_lang::prelude::*;

use crate::{
    ActionRejected, LeashError, PendingAction, PendingStatus, Vault, PENDING_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct RejectPending<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [PENDING_SEED, vault.key().as_ref(), &nonce.to_le_bytes()],
        bump = pending_action.bump,
    )]
    pub pending_action: Account<'info, PendingAction>,
}

/// No TTL check, unlike approve_pending: rejecting moves no funds, so stale proposals can be
/// cleaned up after they expire.
pub fn handle_reject_pending(ctx: Context<RejectPending>, nonce: u64) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let pending = &mut ctx.accounts.pending_action;

    ctx.accounts.vault.check_owner_or_device(&authority)?;
    ctx.accounts.vault.check_current(nonce)?;
    require!(
        pending.status == PendingStatus::Pending,
        LeashError::PendingNotActive
    );

    pending.status = PendingStatus::Rejected;

    emit!(ActionRejected {
        vault: ctx.accounts.vault.key(),
        nonce,
        approver: authority,
    });
    Ok(())
}
