use anchor_lang::prelude::*;

use crate::Tier;

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub guard: Pubkey,
    pub device: Option<Pubkey>,
    pub mint: Pubkey,
}

#[event]
pub struct MandateSet {
    pub vault: Pubkey,
    pub low_threshold: u64,
    pub per_tx_max: u64,
    pub daily_cap: u64,
    pub expires_at: i64,
    pub window_secs: i64,
    pub pending_ttl_secs: i64,
}

#[event]
pub struct RecipientAdded {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub per_recipient_cap: u64,
}

#[event]
pub struct RecipientRemoved {
    pub vault: Pubkey,
    pub recipient: Pubkey,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AgentRevoked {
    pub vault: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct VaultUnpaused {
    pub vault: Pubkey,
}

#[event]
pub struct KeysRotated {
    pub vault: Pubkey,
    pub agent: Pubkey,
    pub guard: Pubkey,
    pub device: Option<Pubkey>,
}

#[event]
pub struct ActionExecuted {
    pub vault: Pubkey,
    pub tier: Tier,
    pub amount: u64,
    pub recipient: Pubkey,
    pub reason_hash: [u8; 32],
    pub spent_today: u64,
}

#[event]
pub struct ActionPending {
    pub vault: Pubkey,
    pub nonce: u64,
    pub amount: u64,
    pub recipient: Pubkey,
    pub reason_hash: [u8; 32],
}

#[event]
pub struct ActionApproved {
    pub vault: Pubkey,
    pub nonce: u64,
    pub approver: Pubkey,
}

#[event]
pub struct ActionRejected {
    pub vault: Pubkey,
    pub nonce: u64,
    pub approver: Pubkey,
}
