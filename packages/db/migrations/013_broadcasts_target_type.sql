-- Migration 013: Expand broadcasts target_type CHECK constraint to include tag_exclude and no_tags
CREATE TABLE broadcasts_new (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'tag_exclude', 'no_tags')) DEFAULT 'all',
  target_tag_id   TEXT REFERENCES tags (id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at    TEXT,
  sent_at         TEXT,
  total_count     INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  line_account_id TEXT,
  alt_text        TEXT
);
INSERT INTO broadcasts_new SELECT id, title, message_type, message_content, target_type, target_tag_id, status, scheduled_at, sent_at, total_count, success_count, created_at, line_account_id, alt_text FROM broadcasts;
DROP TABLE broadcasts;
ALTER TABLE broadcasts_new RENAME TO broadcasts;
