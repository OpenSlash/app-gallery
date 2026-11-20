CREATE TABLE uploaded_icons (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 262144),
  created_at INTEGER NOT NULL
);
