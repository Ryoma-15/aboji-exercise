-- Additive schema for the English "My 120 Days" member dashboard.
-- Safe to run after the existing en-schema.sql. It does not delete or replace existing tables.

CREATE TABLE IF NOT EXISTS en_120_visits (
  registration_id TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  challenge_day INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (registration_id, visit_date),
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE INDEX IF NOT EXISTS en_120_visits_day ON en_120_visits(challenge_day, visit_date);

CREATE TABLE IF NOT EXISTS en_120_checklist (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  severity INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (registration_id, source_key),
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE INDEX IF NOT EXISTS en_120_checklist_member_active ON en_120_checklist(registration_id, active, updated_at);

CREATE TABLE IF NOT EXISTS en_120_body_checks (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  challenge_day INTEGER NOT NULL,
  milestone_day INTEGER,
  local_date TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  checklist_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE INDEX IF NOT EXISTS en_120_body_checks_member ON en_120_body_checks(registration_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS en_120_body_checks_milestone
  ON en_120_body_checks(registration_id, milestone_day)
  WHERE milestone_day IS NOT NULL;

CREATE TABLE IF NOT EXISTS en_120_events (
  registration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (registration_id, event_type, event_date),
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE INDEX IF NOT EXISTS en_120_events_date ON en_120_events(event_date, event_type);

