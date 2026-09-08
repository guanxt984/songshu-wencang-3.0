CREATE INDEX IF NOT EXISTS sessions_active_token_idx
  ON sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_user_id_position_key;
ALTER TABLE warehouses
  ADD CONSTRAINT warehouses_user_id_position_key
  UNIQUE (user_id, position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS import_batches_user_key_idx
  ON import_batches (user_id, idempotency_key);
