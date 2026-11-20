CREATE TABLE admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  session_secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
