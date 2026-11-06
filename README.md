# Leash

An onchain firewall for AI agents. Leash is a Solana program that enforces what an AI agent may do with funds, using three layers:

1. An owner-signed mandate: caps, a recipient allowlist, and an expiry.
2. A required guard-AI co-signature for medium-risk actions.
3. Onchain pending actions for high-risk actions, which only the owner or a hardware device key can approve.

Built for the MLH Solana Hackathon, November 2026. Contributor setup and commands are in [CLAUDE.md](CLAUDE.md).

## Roadmap

- **Multiple mints per owner.** Today each owner has one vault and one mint (dUSDC), because vault seeds are `["vault", owner]`. The upgrade path is to add the mint to the seeds: `["vault", owner, mint]`.
- **`close_vault`.** Today a vault cannot be closed. Closing would return rent and free the owner's vault address.
- **Reclaiming rent from settled PendingActions.** Today they stay onchain as an audit trail, and the rent the agent paid stays locked.
