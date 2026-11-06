use anchor_lang::prelude::*;

use crate::{KeysRotated, LeashError, Vault, VAULT_SEED};

#[derive(Accounts)]
pub struct RotateKeys<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

/// `None` leaves a key unchanged. `new_device: Some(None)` removes the device key.
pub fn handle_rotate_keys(
    ctx: Context<RotateKeys>,
    new_agent: Option<Pubkey>,
    new_guard: Option<Pubkey>,
    new_device: Option<Option<Pubkey>>,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    if let Some(agent) = new_agent {
        // Pause first, so a leaked agent key has no window while it is being replaced.
        require!(vault.paused, LeashError::VaultNotPaused);
        vault.agent = agent;
    }
    if let Some(guard) = new_guard {
        vault.guard = guard;
    }
    if let Some(device) = new_device {
        vault.device = device;
    }

    emit!(KeysRotated {
        vault: vault.key(),
        agent: vault.agent,
        guard: vault.guard,
        device: vault.device,
    });
    Ok(())
}
