/**
 * Smoke test — runs the full five-phase pipeline twice in a temp database with
 * the deterministic dry-run mock (no API key needed). Verifies:
 *   1. Mission 1 completes all phases (plan → breakdown → execute → review →
 *      complete) and stores a pattern in the Knowledge Library.
 *   2. Mission 2 (a similar request) completes and its plan cites the stored
 *      pattern — the knowledge loop working end-to-end.
 *
 * Run: node_modules\.bin\tsx.cmd scripts\smoke.ts   (or: npm.cmd run smoke)
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Must be set BEFORE importing src/db.js — the module-level singleton reads it at import.
process.env.COMMAND_CENTER_DB = join(mkdtempSync(join(tmpdir(), 'itops-smoke-')), 'smoke.db');

const { db, one, many } = await import('../src/db.js');
const { syncAgentsToDb } = await import('../src/agents/registry.js');
const { startMission } = await import('../src/orchestrator/mission-runner.js');

interface MissionRow {
  id: number;
  phase: string;
  status: string;
  error: string;
}

async function waitForMission(id: number, timeoutMs = 120_000): Promise<MissionRow> {
  const started = Date.now();
  for (;;) {
    const m = one<MissionRow>(
      db.prepare('SELECT id, phase, status, error FROM missions WHERE id = ?').get(id)
    );
    if (m && ['completed', 'blocked', 'failed'].includes(m.status)) return m;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Mission ${id} timed out (phase: ${m?.phase}, status: ${m?.status})`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main(): Promise<void> {
  console.log('Smoke test: IT Ops Command Center (dry-run, no API key needed)\n');

  const synced = syncAgentsToDb();
  console.log(`Agents synced from .agents/skills: ${synced}`);
  if (synced < 8) console.log('WARN: expected at least 8 agents.');

  // ---- Mission 1: full pipeline ----
  console.log('\n[1/2] "create a mailbox for jdoe with access to the Finance shared drive"');
  const m1 = startMission('create a mailbox for jdoe with access to the Finance shared drive', 'smoke', 'user-access');
  const r1 = await waitForMission(m1);
  const subs1 = many<{ id: number; title: string; status: string }>(
    db.prepare('SELECT id, title, status FROM subtasks WHERE mission_id = ? ORDER BY id').all(m1)
  );
  console.log(`     Phase: ${r1.phase} — Status: ${r1.status}`);
  for (const s of subs1) console.log(`     #${s.id} [${s.status}] ${s.title}`);
  const docs1 = one<{ n: number }>(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE mission_id = ?').get(m1));
  console.log(`     Documents produced: ${docs1?.n ?? 0}`);
  const knowledgeBefore = one<{ n: number }>(db.prepare('SELECT COUNT(*) AS n FROM knowledge').get());
  console.log(`     Knowledge patterns stored: ${knowledgeBefore?.n ?? 0}`);

  // ---- Mission 2: similar request — should cite mission 1's pattern ----
  console.log('\n[2/2] "create a mailbox for asmith with access to the HR shared drive"');
  const m2 = startMission('create a mailbox for asmith with access to the HR shared drive', 'smoke', 'user-access');
  const r2 = await waitForMission(m2);
  const plan2 = one<{ knowledge_used: string }>(
    db.prepare('SELECT knowledge_used FROM plans WHERE mission_id = ? ORDER BY id DESC').get(m2)
  );
  let cited: string[] = [];
  try {
    cited = plan2 ? (JSON.parse(plan2.knowledge_used) as string[]) : [];
  } catch {
    cited = [];
  }
  console.log(`     Phase: ${r2.phase} — Status: ${r2.status}`);
  console.log(`     Plan cites stored patterns: ${cited.length ? cited.join(', ') : '(none)'}`);

  // ---- Verdict ----
  const pass1 = r1.status === 'completed' && subs1.length > 0 && subs1.every((s) => s.status === 'approved');
  const pass2 = r2.status === 'completed' && cited.length > 0;

  console.log('\nResult:');
  console.log(`  Pipeline (5 phases + review gate + docs): ${pass1 ? 'PASS' : 'FAIL'}`);
  console.log(`  Knowledge loop (pattern stored, then cited): ${pass2 ? 'PASS' : 'FAIL'}`);
  if (!pass1 || !pass2) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('Smoke test failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
