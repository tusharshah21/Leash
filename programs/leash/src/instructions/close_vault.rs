use anchor_lang::prelude::*;
use anchor_spl::token::{close_account, CloseAccount, Mint, Token, TokenAccount};

use crate::{
    transfer_from_vault, AllowEntry, LeashError, Mandate, Vault, VaultClosed, ALLOW_SEED,
    MANDATE_SEED, VAULT_SEED,
};

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
        has_one = mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        close = owner,
        seeds = [MANDATE_SEED, vault.key().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Returns every token and all rent to the owner. Remaining accounts are this vault's AllowEntry
/// accounts, all of which a client should pass: one left behind would still apply to a vault
/// recreated at this address. Pending actions cannot be listed here, since they store no nonce.
/// They stay behind and go inert, because the next vault's `pending_base` is above their nonces.
pub fn handle_close_vault<'info>(ctx: Context<'info, CloseVault<'info>>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(vault.paused, LeashError::VaultNotPaused);

    let vault_key = vault.key();
    let owner_info = ctx.accounts.owner.to_account_info();
    let returned = ctx.accounts.vault_token_account.amount;
    if returned > 0 {
        transfer_from_vault(
            vault,
            &ctx.accounts.vault_token_account,
            &ctx.accounts.mint,
            &ctx.accounts.owner_token_account,
            &ctx.accounts.token_program,
            returned,
        )?;
    }

    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, vault.owner.as_ref(), &[vault.bump]]];
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault_token_account.to_account_info(),
            destination: owner_info.clone(),
            authority: vault.to_account_info(),
        },
        signer_seeds,
    ))?;

    // After the token CPIs: the runtime refuses a CPI while this frame's lamports are mid-move.
    for info in ctx.remaining_accounts {
        let entry = Account::<AllowEntry>::try_from(info)
            .map_err(|_| error!(LeashError::InvalidRemainingAccount))?;
        let expected = Pubkey::create_program_address(
            &[
                ALLOW_SEED,
                vault_key.as_ref(),
                entry.recipient.as_ref(),
                &[entry.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| error!(LeashError::InvalidRemainingAccount))?;
        require_keys_eq!(info.key(), expected, LeashError::InvalidRemainingAccount);
        entry.close(owner_info.clone())?;
    }

    emit!(VaultClosed {
        vault: vault_key,
        owner: vault.owner,
        returned,
    });
    Ok(())
}
