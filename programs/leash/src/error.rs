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
    #[msg(
        "Mandate must satisfy low_threshold <= per_tx_max <= daily_cap and expire in the future"
    )]
    InvalidMandate,
    #[msg("Recipient is not on the allowlist")]
    NotAllowlisted,
    #[msg("Amount exceeds the per-transaction maximum")]
    ExceedsPerTxMax,
    #[msg("Amount exceeds the daily cap")]
    ExceedsDailyCap,
    #[msg("Guard co-signature is required")]
    GuardSignatureRequired,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
}
