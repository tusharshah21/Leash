use anchor_lang::prelude::*;

use crate::{
    LeashError, PendingAction, PendingClosed, PendingStatus, Vault, PENDING_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ClosePending<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        close = owner,
        seeds = [PENDING_SEED, vault.key().as_ref(), &nonce.to_le_bytes()],
        bump = pending_action.bump,
    )]
    pub pending_action: Account<'info, PendingAction>,
}

/// Rent goes to the owner, even though the agent paid it: a refund to the payer would hand SOL
/// to a leaked agent key. See Decision 24 in CLAUDE.md.
pub fn handle_close_pending(ctx: Context<ClosePending>, nonce: u64) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.pending_action.status,
            PendingStatus::Executed | PendingStatus::Rejected
        ),
        LeashError::PendingStillActive
    );

    emit!(PendingClosed {
        vault: ctx.accounts.vault.key(),
        nonce,
    });
    Ok(())
}
