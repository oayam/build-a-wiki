ALTER TABLE auth_guard ADD COLUMN maintenance boolean NOT NULL DEFAULT false;
CREATE TABLE jobs (
 id uuid PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
 dedupe_key text NOT NULL UNIQUE, attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending ON jobs(available_at,id) WHERE completed_at IS NULL;
