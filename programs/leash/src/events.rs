use anchor_lang::prelude::*;

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
