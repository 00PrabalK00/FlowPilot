// SQLite storage via built-in node:sqlite (no native build needed).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FLOWPILOT_DB || join(__dir, '..', 'data', 'flowpilot.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS flow_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rev TEXT,
  flows TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS flow_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  name TEXT,
  intent TEXT,
  risk_level TEXT,
  flow TEXT NOT NULL,
  validation TEXT,
  status TEXT DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  prompt TEXT,
  status TEXT,
  result TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  tool TEXT,
  params TEXT,
  ok INTEGER,
  result TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  tool TEXT,
  params TEXT,
  risk_level TEXT,
  status TEXT DEFAULT 'pending',
  decided_at INTEGER,
  decided_by TEXT
);

CREATE TABLE IF NOT EXISTS file_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  path TEXT,
  tool TEXT,
  reverted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  actor TEXT,
  action TEXT,
  detail TEXT
);
`);

export function audit(workspaceId, actor, action, detail) {
  db.prepare('INSERT INTO audit_events (workspace_id, created_at, actor, action, detail) VALUES (?,?,?,?,?)')
    .run(workspaceId, Date.now(), actor, action, JSON.stringify(detail ?? null));
}
