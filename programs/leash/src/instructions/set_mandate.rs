use anchor_lang::prelude::*;

use crate::{LeashError, Mandate, MandateSet, Vault, MANDATE_SEED, VAULT_SEED};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MandateParams {
    pub low_threshold: u64,
    pub per_tx_max: u64,
    pub daily_cap: u64,
    pub expires_at: i64,
}

#[derive(Accounts)]
pub struct SetMandate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,

    pub system_program: Program<'info, System>,
}

pub fn handle_set_mandate(ctx: Context<SetMandate>, params: MandateParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        params.low_threshold <= params.per_tx_max
            && params.per_tx_max <= params.daily_cap
            && params.expires_at > now,
        LeashError::InvalidMandate
    );

    let mandate = &mut ctx.accounts.mandate;
    mandate.low_threshold = params.low_threshold;
    mandate.per_tx_max = params.per_tx_max;
    mandate.daily_cap = params.daily_cap;
    mandate.expires_at = params.expires_at;
    mandate.bump = ctx.bumps.mandate;
    // Only a new mandate starts a window, so an update cannot reset today's spend.
    if mandate.window_start == 0 {
        mandate.window_start = now;
    }

    emit!(MandateSet {
        vault: ctx.accounts.vault.key(),
        low_threshold: params.low_threshold,
        per_tx_max: params.per_tx_max,
        daily_cap: params.daily_cap,
        expires_at: params.expires_at,
    });
    Ok(())
}
