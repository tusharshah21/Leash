use anchor_lang::prelude::*;

use crate::{LeashError, Vault, VaultUnpaused, VAULT_SEED};

#[derive(Accounts)]
pub struct Unpause<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_unpause(ctx: Context<Unpause>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.paused = false;

    emit!(VaultUnpaused { vault: vault.key() });
    Ok(())
}
