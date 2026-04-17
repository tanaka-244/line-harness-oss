-- Migration 015: extend intake_sessions for beauty_medicell and contraindication cancellation
CREATE TABLE intake_sessions_new (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('injury', 'chronic', 'beauty', 'beauty_medicell', 'revisit', 'consultation')),
  current_step INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'cancelled')) DEFAULT 'in_progress',
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO intake_sessions_new (id, line_user_id, session_type, current_step, answers, status, cancel_reason, created_at, updated_at)
SELECT id, line_user_id, session_type, current_step, answers, status, NULL, created_at, updated_at
FROM intake_sessions;

DROP TABLE intake_sessions;
ALTER TABLE intake_sessions_new RENAME TO intake_sessions;

CREATE INDEX IF NOT EXISTS idx_intake_sessions_line_user_id ON intake_sessions (line_user_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_status ON intake_sessions (status);
