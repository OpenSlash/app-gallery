PRAGMA foreign_keys = ON;

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('website', 'service', 'app')),
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  environment TEXT NOT NULL DEFAULT 'production',
  url TEXT NOT NULL,
  launched_on TEXT,
  retired_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'retired')),
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE (application_id, environment)
);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  kind TEXT NOT NULL CHECK (kind IN ('launched', 'paused', 'resumed', 'retired', 'released', 'note')),
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  UNIQUE (deployment_id, id)
);
CREATE INDEX events_deployment ON events(deployment_id, occurred_at, seq);

CREATE TABLE lifecycle_periods (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX one_open_period ON lifecycle_periods(deployment_id) WHERE ended_at IS NULL;
CREATE INDEX periods_deployment ON lifecycle_periods(deployment_id);

-- A stale write aborts the complete D1 batch, including its related event writes.
CREATE TRIGGER deployment_revision_guard
BEFORE UPDATE ON deployments
WHEN NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'revision_conflict');
END;
