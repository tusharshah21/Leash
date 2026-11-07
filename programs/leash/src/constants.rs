use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const VAULT_TOKEN_SEED: &[u8] = b"vault_token";
#[constant]
pub const MANDATE_SEED: &[u8] = b"mandate";
#[constant]
pub const ALLOW_SEED: &[u8] = b"allow";
#[constant]
pub const PENDING_SEED: &[u8] = b"pending";

pub const DEFAULT_WINDOW_SECS: i64 = 86_400;
pub const DEFAULT_PENDING_TTL_SECS: i64 = 86_400;
pub const MIN_DURATION_SECS: i64 = 60;
/// A new vault's first nonce is its creation time times this, so it starts above any nonce an
/// earlier vault at this address could have reached.
pub const NONCES_PER_SECOND: u64 = 1 << 16;
