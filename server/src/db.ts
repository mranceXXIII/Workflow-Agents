import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const DB_PATH = join(dataDir, 'app.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  request TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  task_domain TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'plan',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  capabilities TEXT NOT NULL DEFAULT '[]',
  system_prompt TEXT NOT NULL DEFAULT '',
  doc_duty INTEGER NOT NULL DEFAULT 1,
  review_duty INTEGER NOT NULL DEFAULT 0,
  performance TEXT NOT NULL DEFAULT '{"tasks_done":0,"approvals":0,"reworks":0}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  content_md TEXT NOT NULL DEFAULT '',
  knowledge_used TEXT NOT NULL DEFAULT '[]',
  subtasks_json TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  plan_id INTEGER REFERENCES plans(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  assigned_agent_id INTEGER REFERENCES agents(id),
  suggested_agent TEXT NOT NULL DEFAULT '',
  requested_capabilities TEXT NOT NULL DEFAULT '[]',
  depends_on TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  result_md TEXT NOT NULL DEFAULT '',
  rework_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  agent_id INTEGER REFERENCES agents(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  subtask_id INTEGER REFERENCES subtasks(id),
  reviewer TEXT NOT NULL DEFAULT 'team-leader',
  verdict TEXT NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  overridden_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  embedding TEXT NOT NULL DEFAULT '[]',
  source_mission_id INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER REFERENCES missions(id),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Cast one sqlite row to a typed object. */
export function one<T>(row: unknown): T | undefined {
  return (row ?? undefined) as T | undefined;
}

/** Cast a sqlite row list to a typed array. */
export function many<T>(rows: unknown): T[] {
  return (rows ?? []) as T[];
}

export function getSetting(key: string): string | null {
  const row = one<{ value: string }>(
    db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  );
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function allSettings(): Record<string, string> {
  const rows = many<{ key: string; value: string }>(
    db.prepare('SELECT key, value FROM settings').all()
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function touchMission(
  id: number,
  fields: { title?: string; phase?: string; status?: string; error?: string; task_domain?: string }
): void {
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: (string | number)[] = [];
  if (fields.title !== undefined) { sets.push('title = ?'); vals.push(fields.title); }
  if (fields.phase !== undefined) { sets.push('phase = ?'); vals.push(fields.phase); }
  if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
  if (fields.error !== undefined) { sets.push('error = ?'); vals.push(fields.error); }
  if (fields.task_domain !== undefined) { sets.push('task_domain = ?'); vals.push(fields.task_domain); }
  vals.push(id);
  db.prepare(`UPDATE missions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
