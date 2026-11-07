use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    validate_keys, LeashError, Vault, VaultInitialized, NONCES_PER_SECOND, VAULT_SEED,
    VAULT_TOKEN_SEED,
};

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    pub mint: Account<'info, Mint>,

    // A PDA rather than an ATA: anyone could create the ATA first and make this init fail.
    #[account(
        init,
        payer = owner,
        seeds = [VAULT_TOKEN_SEED, vault.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_vault(
    ctx: Context<InitVault>,
    agent: Pubkey,
    guard: Pubkey,
    device: Option<Pubkey>,
) -> Result<()> {
    validate_keys(&ctx.accounts.owner.key(), &agent, &guard, device.as_ref())?;

    let vault = &mut ctx.accounts.vault;
    vault.owner = ctx.accounts.owner.key();
    vault.agent = agent;
    vault.guard = guard;
    vault.device = device;
    vault.mint = ctx.accounts.mint.key();
    vault.vault_token_account = ctx.accounts.vault_token_account.key();
    vault.paused = false;
    let now = u64::try_from(Clock::get()?.unix_timestamp).map_err(|_| LeashError::MathOverflow)?;
    vault.pending_base = now
        .checked_mul(NONCES_PER_SECOND)
        .ok_or(LeashError::MathOverflow)?;
    vault.pending_nonce = vault.pending_base;
    vault.bump = ctx.bumps.vault;
    vault._reserved = [0; 56];

    emit!(VaultInitialized {
        vault: vault.key(),
        owner: vault.owner,
        agent,
        guard,
        device,
        mint: vault.mint,
    });
    Ok(())
}
