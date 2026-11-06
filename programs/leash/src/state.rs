use anchor_lang::prelude::*;

use crate::LeashError;

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

impl Vault {
    /// Gate shared by agent_execute and agent_propose. The order sets which error an attack sees.
    pub fn check_agent(&self, signer: &Pubkey, mandate: &Mandate, now: i64) -> Result<()> {
        require!(!self.paused, LeashError::VaultPaused);
        require!(*signer == self.agent, LeashError::Unauthorized);
        require!(now < mandate.expires_at, LeashError::MandateExpired);
        Ok(())
    }

    /// The humans: revoke_agent, approve_pending and reject_pending.
    pub fn check_owner_or_device(&self, signer: &Pubkey) -> Result<()> {
        require!(
            *signer == self.owner || self.device == Some(*signer),
            LeashError::Unauthorized
        );
        Ok(())
    }
}

pub fn validate_keys(
    owner: &Pubkey,
    agent: &Pubkey,
    guard: &Pubkey,
    device: Option<&Pubkey>,
) -> Result<()> {
    let device_ok = device.is_none_or(|d| d != agent && d != guard);
    require!(
        agent != guard && agent != owner && guard != owner && device_ok,
        LeashError::KeyReuseNotAllowed
    );
    Ok(())
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
    pub window_secs: i64,
    pub pending_ttl_secs: i64,
    pub _reserved: [u8; 48],
}

// New fields come out of _reserved: the account size must not change.
const _: () = assert!(Mandate::INIT_SPACE == 113);

impl Mandate {
    /// Starts a new spending window once the current one has ended.
    pub fn roll_window(&mut self, now: i64) -> Result<()> {
        let window_end = self
            .window_start
            .checked_add(self.window_secs)
            .ok_or(LeashError::MathOverflow)?;
        if now >= window_end {
            self.spent_today = 0;
            self.window_start = now;
        }
        Ok(())
    }

    /// The tier rules. `packages/sdk/src/tier.ts` mirrors these: change both together.
    pub fn route(&self, entry: Option<&AllowEntry>, amount: u64) -> Result<Tier> {
        let entry = entry.ok_or(LeashError::NotAllowlisted)?;
        require!(
            amount <= self.per_tx_max && amount <= entry.per_recipient_cap,
            LeashError::RequiresApproval
        );
        let within_cap = self
            .spent_today
            .checked_add(amount)
            .is_some_and(|total| total <= self.daily_cap);
        require!(within_cap, LeashError::ExceedsDailyCap);
        Ok(if amount <= self.low_threshold {
            Tier::Low
        } else {
            Tier::Medium
        })
    }
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

/// Seeds: ["pending", vault, nonce_le_bytes]
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

impl PendingAction {
    /// Gate shared by approve_pending and reject_pending.
    pub fn check_open(&self, ttl_secs: i64, now: i64) -> Result<()> {
        let expires_at = self
            .created_at
            .checked_add(ttl_secs)
            .ok_or(LeashError::MathOverflow)?;
        require!(now <= expires_at, LeashError::PendingExpired);
        require!(
            self.status == PendingStatus::Pending,
            LeashError::PendingNotActive
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PendingStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Low,
    Medium,
}
