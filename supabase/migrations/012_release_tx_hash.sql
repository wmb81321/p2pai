-- Migration 012: add release_tx_hash to trades
-- Stores the on-chain tx hash of the USDC release transfer for auditability
-- and to enable reliable crash-recovery in confirmPayment.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS release_tx_hash text;
