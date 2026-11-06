#!/bin/bash
# Deploys the program to devnet. Stops before sending anything if the program ID is wrong or the
# CLI wallet cannot cover the rent. Set CHECK_ONLY=1 to stop after the checks.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
RPC="${LEASH_RPC_URL:-https://api.devnet.solana.com}"
SO=target/deploy/leash.so
IDL=target/idl/leash.json

declared=$(grep -oP 'declare_id!\("\K[^"]+' programs/leash/src/lib.rs)
keypair=$(solana address -k target/deploy/leash-keypair.json)
if [ "$declared" != "$keypair" ]; then
  echo "Program ID mismatch: declare_id! is $declared, keypair is $keypair. Not deploying." >&2
  exit 1
fi

rent() { solana rent "$1" --lamports --url "$RPC" | awk '/Rent-exempt/ {print $3}'; }
so_bytes=$(stat -c %s "$SO")
idl_bytes=$(stat -c %s "$IDL")
# The buffer's rent is refunded inside the deploy, so it is not added on top.
# The IDL is priced uncompressed, which is an upper bound. 0.01 SOL covers the write fees.
need=$(($(rent $((so_bytes + 45))) + $(rent 36) + $(rent "$idl_bytes") + 10000000))
have=$(solana balance --lamports --url "$RPC" | awk '{print $1}')
sol() { awk -v l="$1" 'BEGIN { printf "%.4f", l / 1000000000 }'; }
echo "Program ID:  $declared"
echo "RPC:         ${RPC%%\?*}"
echo ".so size:    $so_bytes bytes"
echo "Needs up to: $(sol "$need") SOL"
echo "Wallet has:  $(sol "$have") SOL"
if [ "$have" -lt "$need" ]; then
  echo "Insufficient balance: short by $(sol $((need - have))) SOL. Not deploying." >&2
  exit 1
fi
[ "${CHECK_ONLY:-0}" = 1 ] && exit 0

anchor deploy --provider.cluster "$RPC" -- --with-compute-unit-price 1000 --max-sign-attempts 20
