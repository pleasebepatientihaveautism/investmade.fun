CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS weekly_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  epoch_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'OPEN', 'SWIPING', 'REVIEW', 'AWAITING_SIGNATURE',
      'SUBMITTED', 'SETTLED', 'PARTIAL', 'FAILED', 'CLOSED'
    )
  ),
  execution_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet, epoch_id)
);

CREATE TABLE IF NOT EXISTS executions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES weekly_sessions(id),
  authorized_plan_hash text NOT NULL,
  plan jsonb NOT NULL,
  status text NOT NULL CHECK (
    status IN ('PREPARED', 'SUBMITTED', 'SETTLED', 'PARTIAL', 'FAILED')
  ),
  transaction_hashes text[] NOT NULL DEFAULT '{}',
  submission_mode text NOT NULL DEFAULT 'SEQUENTIAL' CHECK (submission_mode IN ('SEQUENTIAL', 'BATCH')),
  settled_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id),
  UNIQUE (authorized_plan_hash)
);

ALTER TABLE weekly_sessions
  DROP CONSTRAINT IF EXISTS weekly_sessions_execution_id_fkey;

ALTER TABLE weekly_sessions
  ADD CONSTRAINT weekly_sessions_execution_id_fkey
  FOREIGN KEY (execution_id) REFERENCES executions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS executions_status_idx ON executions(status);

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS settled_outputs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS submission_mode text NOT NULL DEFAULT 'SEQUENTIAL'
  CHECK (submission_mode IN ('SEQUENTIAL', 'BATCH'));

CREATE TABLE IF NOT EXISTS human_verifications (
  wallet text PRIMARY KEY CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  nullifier_digest text NOT NULL UNIQUE CHECK (nullifier_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now()
);
