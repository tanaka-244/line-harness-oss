-- Migration 014: add intake_sessions for LINE-based intake flow
CREATE TABLE IF NOT EXISTS intake_sessions (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('injury', 'chronic', 'beauty', 'revisit', 'consultation')),
  current_step INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'cancelled')) DEFAULT 'in_progress',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_intake_sessions_line_user_id ON intake_sessions (line_user_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_status ON intake_sessions (status);
