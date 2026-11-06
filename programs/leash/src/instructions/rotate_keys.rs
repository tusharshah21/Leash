use anchor_lang::prelude::*;

use crate::{validate_keys, KeysRotated, LeashError, Vault, VAULT_SEED};

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

    // Pause first, so a leaked agent key has no window while it is being replaced.
    if new_agent.is_some() {
        require!(vault.paused, LeashError::VaultNotPaused);
    }

    let agent = new_agent.unwrap_or(vault.agent);
    let guard = new_guard.unwrap_or(vault.guard);
    let device = new_device.unwrap_or(vault.device);
    // Checks the resulting set, so a rotation cannot collide with a key it left unchanged.
    validate_keys(&vault.owner, &agent, &guard, device.as_ref())?;

    vault.agent = agent;
    vault.guard = guard;
    vault.device = device;

    emit!(KeysRotated {
        vault: vault.key(),
        agent,
        guard,
        device,
    });
    Ok(())
}
