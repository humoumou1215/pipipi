/** 全局 users.db DDL */
export const GLOBAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  dir TEXT NOT NULL,
  card_id INTEGER,
  activity_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS dirs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL
);
`;

/** 每目录 board.db DDL */
export const BOARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  claimable INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  workflow_role TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  priority INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  column_id INTEGER NOT NULL REFERENCES columns(id),
  status TEXT NOT NULL DEFAULT 'ready',
  holder_id TEXT,
  assignee_role TEXT,
  stage_idx INTEGER NOT NULL DEFAULT -1,
  due_at TEXT,
  review_approver INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_holder ON cards(holder_id);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  done_by TEXT,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stages_card ON stages(card_id);
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklist_card ON checklist_items(card_id);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_card ON activities(card_id, created_at);
CREATE TABLE IF NOT EXISTS wake_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_role_id TEXT NOT NULL,
  target_instance_id TEXT,
  card_id INTEGER,
  source TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wake_status ON wake_signals(status, priority, target_role_id);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent',
  model TEXT,
  thinking_level TEXT NOT NULL DEFAULT 'off',
  instance_count INTEGER NOT NULL DEFAULT 1,
  claim_policy TEXT NOT NULL DEFAULT '{}',
  mention_policy TEXT NOT NULL DEFAULT '{}',
  role_dir TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  current_card_id INTEGER,
  queue_len INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT NOT NULL,
  UNIQUE(role_id, idx)
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id TEXT,
  instance_id TEXT,
  card_id INTEGER,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  cost REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  source_card_id INTEGER,
  created_at TEXT NOT NULL
);
`;

/** 默认列种子 */
export const DEFAULT_COLUMNS = [
	{ name: "Backlog", claimable: 0, done: 0 },
	{ name: "Ready", claimable: 1, done: 0 },
	{ name: "In Progress", claimable: 1, done: 0 },
	{ name: "In Review", claimable: 0, done: 0 },
	{ name: "Done", claimable: 0, done: 1 },
];
