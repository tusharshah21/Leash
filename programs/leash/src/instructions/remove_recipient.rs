use anchor_lang::prelude::*;

use crate::{AllowEntry, LeashError, RecipientRemoved, Vault, ALLOW_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(recipient: Pubkey)]
pub struct RemoveRecipient<'info> {
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
        seeds = [ALLOW_SEED, vault.key().as_ref(), recipient.as_ref()],
        bump = allow_entry.bump,
    )]
    pub allow_entry: Account<'info, AllowEntry>,
}

pub fn handle_remove_recipient(ctx: Context<RemoveRecipient>, recipient: Pubkey) -> Result<()> {
    emit!(RecipientRemoved {
        vault: ctx.accounts.vault.key(),
        recipient,
    });
    Ok(())
}
