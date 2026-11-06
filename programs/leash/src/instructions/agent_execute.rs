use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    transfer_from_vault, ActionExecuted, AllowEntry, LeashError, Mandate, Tier, Vault, ALLOW_SEED,
    MANDATE_SEED, VAULT_SEED,
};

#[derive(Accounts)]
pub struct AgentExecute<'info> {
    pub agent: Signer<'info>,

    /// Required only for MEDIUM. Checked against `vault.guard` in the handler.
    pub guard: Option<Signer<'info>>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [MANDATE_SEED, vault.key().as_ref()],
        bump = mandate.bump,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// The recipient is this account's owner.
    #[account(mut, token::mint = mint)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: the seeds tie this to the recipient, and `load_allow_entry` reads it only when the
    /// program owns it. An `Account` here would fail on a missing entry before the ordered
    /// checks in the handler, hiding NotAllowlisted behind AccountNotInitialized.
    #[account(
        seeds = [ALLOW_SEED, vault.key().as_ref(), recipient_token_account.owner.as_ref()],
        bump,
    )]
    pub allow_entry: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

fn load_allow_entry(info: &AccountInfo) -> Result<Option<AllowEntry>> {
    if info.owner != &crate::ID {
        return Ok(None);
    }
    let data = info.try_borrow_data()?;
    Ok(Some(AllowEntry::try_deserialize(&mut &data[..])?))
}

pub fn handle_agent_execute(
    ctx: Context<AgentExecute>,
    amount: u64,
    reason_hash: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &ctx.accounts.vault;
    let mandate = &mut ctx.accounts.mandate;

    vault.check_agent(&ctx.accounts.agent.key(), mandate, now)?;
    mandate.roll_window(now)?;
    require!(amount > 0, LeashError::InvalidAmount);

    let entry = load_allow_entry(&ctx.accounts.allow_entry.to_account_info())?;
    let tier = mandate.route(entry.as_ref(), amount)?;
    if tier == Tier::Medium {
        let guard_signed = ctx
            .accounts
            .guard
            .as_ref()
            .is_some_and(|guard| guard.key() == vault.guard);
        require!(guard_signed, LeashError::GuardSignatureRequired);
    }

    mandate.spent_today = mandate
        .spent_today
        .checked_add(amount)
        .ok_or(LeashError::MathOverflow)?;

    transfer_from_vault(
        vault,
        &ctx.accounts.vault_token_account,
        &ctx.accounts.mint,
        &ctx.accounts.recipient_token_account,
        &ctx.accounts.token_program,
        amount,
    )?;

    emit!(ActionExecuted {
        vault: vault.key(),
        tier,
        amount,
        recipient: ctx.accounts.recipient_token_account.owner,
        reason_hash,
        spent_today: mandate.spent_today,
    });
    Ok(())
}
