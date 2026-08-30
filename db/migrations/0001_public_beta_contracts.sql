-- Public beta node 0: tables and constraints only. Application code owns API behavior.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting', 'deleted')),
  warehouse_order_revision integer NOT NULL DEFAULT 0 CHECK (warehouse_order_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_challenges (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_challenges_active_email_idx ON email_challenges (email_normalized, created_at DESC) WHERE consumed_at IS NULL;

CREATE TABLE beta_access (
  email_normalized text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  position integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'organizing')),
  active_ai_job_id uuid,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, position)
);

CREATE TABLE ai_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  input_revision integer NOT NULL CHECK (input_revision >= 0),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'expired')),
  enqueued_at timestamptz,
  started_at timestamptz,
  expires_at timestamptz,
  finished_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  result jsonb,
  error_code text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX ai_jobs_one_active_per_user ON ai_jobs (user_id) WHERE status IN ('queued', 'running');

ALTER TABLE warehouses ADD CONSTRAINT warehouses_active_ai_job_fk FOREIGN KEY (active_ai_job_id) REFERENCES ai_jobs(id);

CREATE TABLE usage_daily (
  user_id uuid NOT NULL REFERENCES users(id),
  usage_date date NOT NULL,
  ai_job_count integer NOT NULL DEFAULT 0 CHECK (ai_job_count BETWEEN 0 AND 3),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost numeric(12, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE import_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  source_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  result jsonb,
  completed_at timestamptz,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX warehouses_user_id_idx ON warehouses (user_id, position);
CREATE INDEX ai_jobs_user_id_idx ON ai_jobs (user_id, created_at DESC);

CREATE TABLE account_deletion_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION enforce_warehouse_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF (SELECT count(*) FROM warehouses WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'WAREHOUSE_LIMIT_REACHED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER warehouses_limit_per_user BEFORE INSERT ON warehouses
FOR EACH ROW EXECUTE FUNCTION enforce_warehouse_limit();
