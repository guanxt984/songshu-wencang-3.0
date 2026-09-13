ALTER TABLE users ADD COLUMN github_id text UNIQUE,
  ADD COLUMN github_login text;

CREATE TABLE github_login_states (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX github_login_states_expiry ON github_login_states (expires_at);
ALTER TABLE github_login_states ENABLE ROW LEVEL SECURITY;
