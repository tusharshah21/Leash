use anchor_lang::prelude::*;

use crate::{
    ActionRejected, Mandate, PendingAction, PendingStatus, Vault, MANDATE_SEED, PENDING_SEED,
    VAULT_SEED,
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
}

pub fn handle_reject_pending(ctx: Context<RejectPending>, nonce: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let authority = ctx.accounts.authority.key();
    let pending = &mut ctx.accounts.pending_action;

    ctx.accounts.vault.check_owner_or_device(&authority)?;
    pending.check_open(ctx.accounts.mandate.pending_ttl_secs, now)?;

    pending.status = PendingStatus::Rejected;

    emit!(ActionRejected {
        vault: ctx.accounts.vault.key(),
        nonce,
        approver: authority,
    });
    Ok(())
}
