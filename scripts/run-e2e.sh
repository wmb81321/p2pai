#!/usr/bin/env bash
# p2pai — run the full end-to-end agentic test in one command.
#
# Generates two fresh ephemeral wallets, funds them from AGENT_ACCESS_KEY,
# then runs the complete trade flow on Moderato testnet.
#
# Usage (from repo root):
#   bash scripts/run-e2e.sh
#
# Optionally override defaults:
#   TEST_USDC_AMOUNT=10 FRONTEND_URL=http://localhost:3000 bash scripts/run-e2e.sh

set -euo pipefail

# Load .env from repo root (skip comment lines and blank lines)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -v '^\s*#' .env | grep -v '^\s*$')
  set +a
fi

# Run from agent/ so node_modules (mppx, viem, zod) resolve correctly
cd agent
exec npx tsx ../scripts/setup-e2e.ts
