CREATE TABLE IF NOT EXISTS en_registrations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  country TEXT,
  time_zone TEXT,
  practice_note TEXT,
  referral_kind TEXT,
  referrer_name TEXT,
  discovery TEXT,
  status TEXT NOT NULL DEFAULT 'invited',
  invite_hash TEXT,
  invite_expires INTEGER,
  access_hash TEXT,
  access_expires INTEGER,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS en_registrations_status ON en_registrations(status, submitted_at);
CREATE TABLE IF NOT EXISTS en_sessions (
  token_hash TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE TABLE IF NOT EXISTS en_attendance (
  registration_id TEXT NOT NULL,
  practice_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (registration_id, practice_date),
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE INDEX IF NOT EXISTS en_attendance_date ON en_attendance(practice_date);
CREATE TABLE IF NOT EXISTS en_preferences (
  registration_id TEXT PRIMARY KEY,
  email_updates_opt_in INTEGER NOT NULL DEFAULT 0,
  email_updates_consented_at INTEGER,
  changed_at INTEGER NOT NULL,
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE TABLE IF NOT EXISTS en_push_subscriptions (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (registration_id) REFERENCES en_registrations(id)
);
CREATE INDEX IF NOT EXISTS en_push_registration ON en_push_subscriptions(registration_id);
