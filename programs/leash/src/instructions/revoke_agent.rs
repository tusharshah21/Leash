use anchor_lang::prelude::*;

use crate::{AgentRevoked, LeashError, Vault, VAULT_SEED};

#[derive(Accounts)]
pub struct RevokeAgent<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let vault = &mut ctx.accounts.vault;
    require!(
        authority == vault.owner || vault.device == Some(authority),
        LeashError::Unauthorized
    );

    vault.paused = true;

    emit!(AgentRevoked {
        vault: vault.key(),
        by: authority,
    });
    Ok(())
}
