-- Phase 2 authentication hardening. Apply after 0001_public_beta_contracts.sql.
ALTER TABLE email_challenges
  ADD COLUMN request_ip inet NOT NULL DEFAULT '0.0.0.0',
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed'));

CREATE INDEX email_challenges_ip_created_idx
  ON email_challenges (request_ip, created_at DESC);

CREATE INDEX email_challenges_email_created_idx
  ON email_challenges (email_normalized, created_at DESC);

WITH ranked_active AS (
  SELECT id,
         row_number() OVER (PARTITION BY email_normalized ORDER BY created_at DESC, id DESC) AS active_rank
  FROM email_challenges
  WHERE consumed_at IS NULL
)
UPDATE email_challenges AS challenge
SET consumed_at = now()
FROM ranked_active
WHERE challenge.id = ranked_active.id
  AND ranked_active.active_rank > 1;

CREATE UNIQUE INDEX email_challenges_one_active_per_email
  ON email_challenges (email_normalized)
  WHERE consumed_at IS NULL;

ALTER TABLE sessions
  ADD COLUMN absolute_expires_at timestamptz;

UPDATE sessions
  SET absolute_expires_at = created_at + interval '30 days'
  WHERE absolute_expires_at IS NULL;

ALTER TABLE sessions
  ALTER COLUMN absolute_expires_at SET NOT NULL,
  ALTER COLUMN absolute_expires_at SET DEFAULT (now() + interval '30 days');

ALTER TABLE email_challenges
  ADD CONSTRAINT email_challenges_failed_attempts_v2
  CHECK (failed_attempts BETWEEN 0 AND 5);
