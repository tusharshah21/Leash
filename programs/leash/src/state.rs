use anchor_lang::prelude::*;

/// Seeds: ["vault", owner]
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub guard: Pubkey,
    pub device: Option<Pubkey>,
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub paused: bool,
    pub pending_nonce: u64,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

/// Seeds: ["mandate", vault]
#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub low_threshold: u64,
    pub per_tx_max: u64,
    pub daily_cap: u64,
    pub spent_today: u64,
    pub window_start: i64,
    pub expires_at: i64,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

/// Seeds: ["allow", vault, recipient]
#[account]
#[derive(InitSpace)]
pub struct AllowEntry {
    /// A wallet. The destination token account's owner and mint are checked at execution time.
    pub recipient: Pubkey,
    pub label: [u8; 32],
    pub per_recipient_cap: u64,
    pub bump: u8,
}

/// Seeds: ["pending", vault, nonce_le_bytes]. Created by agent_execute in Phase 2.
#[account]
#[derive(InitSpace)]
pub struct PendingAction {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub reason_hash: [u8; 32],
    pub status: PendingStatus,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PendingStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
}
