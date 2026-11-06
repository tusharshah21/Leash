use anchor_lang::prelude::*;

use crate::{AllowEntry, LeashError, RecipientAdded, Vault, ALLOW_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(recipient: Pubkey)]
pub struct AddRecipient<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        space = 8 + AllowEntry::INIT_SPACE,
        seeds = [ALLOW_SEED, vault.key().as_ref(), recipient.as_ref()],
        bump,
    )]
    pub allow_entry: Account<'info, AllowEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handle_add_recipient(
    ctx: Context<AddRecipient>,
    recipient: Pubkey,
    label: [u8; 32],
    per_recipient_cap: u64,
) -> Result<()> {
    let entry = &mut ctx.accounts.allow_entry;
    entry.recipient = recipient;
    entry.label = label;
    entry.per_recipient_cap = per_recipient_cap;
    entry.bump = ctx.bumps.allow_entry;

    emit!(RecipientAdded {
        vault: ctx.accounts.vault.key(),
        recipient,
        per_recipient_cap,
    });
    Ok(())
}
