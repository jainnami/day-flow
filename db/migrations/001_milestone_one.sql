CREATE TABLE users (
  id uuid PRIMARY KEY,
  google_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  work_start text NOT NULL DEFAULT '09:00',
  work_end text NOT NULL DEFAULT '18:00',
  sleep_start text NOT NULL DEFAULT '23:00',
  sleep_end text NOT NULL DEFAULT '07:00',
  selected_calendar_ids text[] NOT NULL DEFAULT ARRAY['primary'],
  right_now_calendar_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oauth_connections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_refresh_token text NOT NULL,
  scopes text[] NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','reconnect_required')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_sessions_user_idx ON app_sessions(user_id);
CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
  due_at timestamptz NOT NULL,
  deadline_local text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','unscheduled','error')),
  rationale text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id),
  UNIQUE(user_id,id)
);
CREATE INDEX tasks_user_created_idx ON tasks(user_id,created_at DESC);
CREATE TABLE work_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL UNIQUE,
  google_calendar_id text NOT NULL,
  google_event_id text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id) ON DELETE CASCADE,
  UNIQUE(user_id,google_calendar_id,google_event_id)
);
