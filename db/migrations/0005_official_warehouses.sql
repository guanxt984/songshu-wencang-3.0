ALTER TABLE users
  ADD COLUMN official_seed_version integer NOT NULL DEFAULT 0 CHECK (official_seed_version >= 0);

ALTER TABLE warehouses
  ADD COLUMN official_template_key text;

CREATE UNIQUE INDEX warehouses_official_template_per_user
  ON warehouses (user_id, official_template_key)
  WHERE official_template_key IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_warehouse_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF NEW.official_template_key IS NULL AND
     (SELECT count(*) FROM warehouses WHERE user_id = NEW.user_id AND official_template_key IS NULL) >= 10 THEN
    RAISE EXCEPTION 'WAREHOUSE_LIMIT_REACHED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
