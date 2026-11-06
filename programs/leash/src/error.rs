use anchor_lang::prelude::*;

#[error_code]
pub enum LeashError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault must be paused first")]
    VaultNotPaused,
    #[msg("Mandate has expired")]
    MandateExpired,
    #[msg("Mandate needs low_threshold <= per_tx_max <= daily_cap, a future expiry, and durations of at least 60 seconds")]
    InvalidMandate,
    #[msg("Recipient is not on the allowlist")]
    NotAllowlisted,
    #[msg("Amount exceeds the daily cap")]
    ExceedsDailyCap,
    #[msg("Guard co-signature is required")]
    GuardSignatureRequired,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg(
        "Agent, guard and device keys must be distinct, and agent and guard must not be the owner"
    )]
    KeyReuseNotAllowed,
    #[msg("Action exceeds what the agent may do alone: use agent_propose")]
    RequiresApproval,
    #[msg("Pending action has expired")]
    PendingExpired,
    #[msg("Pending action is no longer pending")]
    PendingNotActive,
    #[msg("Token account does not match the stored recipient and vault mint")]
    RecipientMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
