pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("8XkDgSyKTDfg7WGP8RGS4bgqN4L2XjMQmEnG4gUCCu2C");

#[program]
pub mod leash {
    use super::*;

    pub fn init_vault(
        ctx: Context<InitVault>,
        agent: Pubkey,
        guard: Pubkey,
        device: Option<Pubkey>,
    ) -> Result<()> {
        instructions::init_vault::handle_init_vault(ctx, agent, guard, device)
    }

    pub fn set_mandate(ctx: Context<SetMandate>, params: MandateParams) -> Result<()> {
        instructions::set_mandate::handle_set_mandate(ctx, params)
    }

    pub fn add_recipient(
        ctx: Context<AddRecipient>,
        recipient: Pubkey,
        label: [u8; 32],
        per_recipient_cap: u64,
    ) -> Result<()> {
        instructions::add_recipient::handle_add_recipient(ctx, recipient, label, per_recipient_cap)
    }

    pub fn remove_recipient(ctx: Context<RemoveRecipient>, recipient: Pubkey) -> Result<()> {
        instructions::remove_recipient::handle_remove_recipient(ctx, recipient)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }

    pub fn revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
        instructions::revoke_agent::handle_revoke_agent(ctx)
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::unpause::handle_unpause(ctx)
    }

    pub fn rotate_keys(
        ctx: Context<RotateKeys>,
        new_agent: Option<Pubkey>,
        new_guard: Option<Pubkey>,
        new_device: Option<Option<Pubkey>>,
    ) -> Result<()> {
        instructions::rotate_keys::handle_rotate_keys(ctx, new_agent, new_guard, new_device)
    }

    pub fn agent_execute(
        ctx: Context<AgentExecute>,
        amount: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        instructions::agent_execute::handle_agent_execute(ctx, amount, reason_hash)
    }

    pub fn agent_propose(
        ctx: Context<AgentPropose>,
        amount: u64,
        recipient: Pubkey,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        instructions::agent_propose::handle_agent_propose(ctx, amount, recipient, reason_hash)
    }

    pub fn approve_pending(ctx: Context<ApprovePending>, nonce: u64) -> Result<()> {
        instructions::approve_pending::handle_approve_pending(ctx, nonce)
    }

    pub fn reject_pending(ctx: Context<RejectPending>, nonce: u64) -> Result<()> {
        instructions::reject_pending::handle_reject_pending(ctx, nonce)
    }

    pub fn close_pending(ctx: Context<ClosePending>, nonce: u64) -> Result<()> {
        instructions::close_pending::handle_close_pending(ctx, nonce)
    }
}
