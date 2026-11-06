use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{LeashError, Vault, Withdrawn, VAULT_SEED};

/// The one path funds leave the vault: withdraw, agent_execute and approve_pending all use it.
pub fn transfer_from_vault<'info>(
    vault: &Account<'info, Vault>,
    vault_token_account: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, vault.owner.as_ref(), &[vault.bump]]];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault_token_account.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}

// Deliberately has no paused check: the owner can always pull funds during an incident.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
        has_one = mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    pub mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, LeashError::InvalidAmount);

    transfer_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.vault_token_account,
        &ctx.accounts.mint,
        &ctx.accounts.owner_token_account,
        &ctx.accounts.token_program,
        amount,
    )?;

    emit!(Withdrawn {
        vault: ctx.accounts.vault.key(),
        amount,
    });
    Ok(())
}
