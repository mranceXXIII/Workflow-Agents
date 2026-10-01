import { EventEmitter } from 'node:events';
import { db, one, many } from '../db.js';
import { createPlan, latestPlan, setPlanStatus, planSubtasks } from './planner.js';
import { breakdownAndAssign, getSubtaskRow } from './dispatcher.js';
import { reviewPlan, reviewSubtask } from './reviewer.js';
import { writeMissionArtifacts, artifactsRootPath } from '../artifacts/writer.js';
import { distillMission, searchKnowledge } from '../knowledge/store.js';
import { getAgentById, type AgentRow } from '../agents/registry.js';
import { chatAuto } from '../llm/nim.js';

export const bus = new EventEmitter();
const running = new Set<number>();

export interface MissionEvent {
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  at: string;
}

export function missionEvents(missionId: number, listener: (evt: MissionEvent) => void): () => void {
  const key = `mission:${missionId}`;
  bus.on(key, listener);
  return () => bus.off(key, listener);
}

export function emitMissionEvent(missionId: number, kind: string, summary: string, payload: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO events (mission_id, kind, summary, payload) VALUES (?, ?, ?, ?)').run(
    missionId,
    kind,
    summary,
    JSON.stringify(payload)
  );
  bus.emit(`mission:${missionId}`, { kind, summary, payload, at: new Date().toISOString() } satisfies MissionEvent);
}

export function startMission(request: string, source: string, taskDomain: string): number {
  const res = db
    .prepare("INSERT INTO missions (request, source, task_domain, phase, status) VALUES (?, ?, ?, 'plan', 'queued')")
    .run(request, source, taskDomain);
  const id = Number(res.lastInsertRowid);
  emitMissionEvent(id, 'mission_created', 'Mission created');
  void runMission(id);
  return id;
}

/** Resume a paused/blocked mission from its current persisted state. */
export function resumeMission(missionId: number): void {
  void runMission(missionId);
}

interface MissionRow {
  id: number;
  title: string;
  request: string;
  source: string;
  task_domain: string;
  phase: string;
  status: string;
  error: string;
}

interface SubtaskRow {
  id: number;
  mission_id: number;
  title: string;
  description: string;
  acceptance_criteria: string;
  assigned_agent_id: number | null;
  status: string;
  result_md: string;
  rework_count: number;
}

function missionRow(missionId: number): MissionRow {
  const m = one<MissionRow>(db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId));
  if (!m) throw new Error(`Mission ${missionId} not found.`);
  return m;
}

function subtaskRows(missionId: number): SubtaskRow[] {
  return many<SubtaskRow>(db.prepare('SELECT * FROM subtasks WHERE mission_id = ? ORDER BY id').all(missionId));
}

async function executeSubtask(missionId: number, st: SubtaskRow, reworkFeedback?: string): Promise<void> {
  const agent: AgentRow | undefined = st.assigned_agent_id ? getAgentById(st.assigned_agent_id) : undefined;
  if (!agent) throw new Error(`Assigned agent missing for subtask ${st.id}.`);
  db.prepare("UPDATE subtasks SET status = 'in_progress' WHERE id = ?").run(st.id);
  emitMissionEvent(missionId, 'subtask_status', `${st.title} — ${agent.name} working`, { subtaskId: st.id, status: 'in_progress' });

  const knowledge = await searchKnowledge(`${st.title} ${st.description}`, 3);
  const knowledgeBlock = knowledge.length
    ? knowledge.map((k) => `- ${k.title}: ${k.content_md.slice(0, 300)}`).join('\n')
    : '(no matches)';

  const user = [
    '[[TASK:EXECUTE]]',
    `[[AGENT]]${agent.name} (${agent.slug})[[/AGENT]]`,
    '[[AGENT_SKILL]]',
    agent.system_prompt.slice(0, 6000),
    '[[/AGENT_SKILL]]',
    `[[SUBTASK_TITLE]]${st.title}[[/SUBTASK_TITLE]]`,
    `[[SUBTASK_DESCRIPTION]]${st.description}[[/SUBTASK_DESCRIPTION]]`,
    `[[ACCEPTANCE_CRITERIA]]${st.acceptance_criteria}[[/ACCEPTANCE_CRITERIA]]`,
    '[[KNOWLEDGE]]',
    knowledgeBlock,
    '[[/KNOWLEDGE]]',
    ...(reworkFeedback ? [`[[REWORK_FEEDBACK]]${reworkFeedback}[[/REWORK_FEEDBACK]]`] : []),
    '',
    'Do the assigned work as this agent, following your skill definition. Produce ONLY JSON: {"result_md": "the deliverable (markdown)", "documentation_md": "working documentation in the mandated format: ### [agent-name] — <step> with Action/Decision/Artifact/Confidence bullets", "artifacts": [{"name": "file-name.ext", "content": "full file content"}]}. No markdown fences around the JSON.'
  ].join('\n');

  const raw = await chatAuto([
    { role: 'system', content: 'You are a specialized IT operations worker agent executing an assigned sub-task with mandatory documentation. Reply with ONLY valid JSON, no markdown fences.' },
    { role: 'user', content: user }
  ]);

  interface AgentOutput {
    result_md?: string;
    documentation_md?: string;
    artifacts?: { name?: string; content?: string }[];
  }

  let parsed: AgentOutput | null = null;
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) parsed = JSON.parse(raw.slice(start, end + 1)) as AgentOutput;
  } catch {
    parsed = null;
  }

  const resultMd = parsed?.result_md || raw;
  const docMd =
    parsed?.documentation_md ||
    `### [${agent.slug}] — ${st.title}\n- **Action:** executed sub-task\n- **Decision:** see result\n- **Artifact:** result_md\n- **Confidence:** Low — LLM output was not valid JSON`;

  db.prepare("UPDATE subtasks SET status = 'in_review', result_md = ? WHERE id = ?").run(resultMd, st.id);
  db.prepare("INSERT INTO documents (mission_id, agent_id, type, title, content_md) VALUES (?, ?, 'agent_doc', ?, ?)").run(
    missionId,
    agent.id,
    `${st.title} — working documentation`,
    docMd
  );
  let artifactCount = 0;
  for (const a of parsed?.artifacts ?? []) {
    if (!a?.name || !a?.content) continue;
    db.prepare("INSERT INTO documents (mission_id, agent_id, type, title, content_md) VALUES (?, ?, 'artifact', ?, ?)").run(
      missionId,
      agent.id,
      a.name,
      a.content
    );
    artifactCount++;
  }
  emitMissionEvent(missionId, 'subtask_status', `${st.title} — deliverable ready for review`, { subtaskId: st.id, status: 'in_review', artifacts: artifactCount });
}

/**
 * The five-phase pipeline engine. State-aware: it resumes a mission from its
 * persisted state, so it doubles as the resume function after user overrides.
 */
async function runMission(missionId: number): Promise<void> {
  if (running.has(missionId)) return;
  running.add(missionId);
  try {
    const mission = missionRow(missionId);
    const allApproved = subtaskRows(missionId).every((s) => s.status === 'approved');
    if (mission.status === 'completed' && allApproved) return;
    db.prepare("UPDATE missions SET status = 'running', error = '', updated_at = datetime('now') WHERE id = ?").run(missionId);

    // ---- Phase 1 — Plan (skip when the plan already exists and is approved) ----
    let planRow = latestPlan(missionId);
    if (!planRow) {
      db.prepare("UPDATE missions SET phase = 'plan', updated_at = datetime('now') WHERE id = ?").run(missionId);
      emitMissionEvent(missionId, 'phase', 'Phase 1 — Plan: analyzing the request against the Knowledge Library');
      const persisted = await createPlan(missionId, mission.request);
      planRow = latestPlan(missionId);
      emitMissionEvent(missionId, 'plan_created', persisted.plan.title, { planId: persisted.planId });
      const verdict = await reviewPlan(missionId, persisted.planId, persisted.contentMd);
      emitMissionEvent(missionId, 'plan_reviewed', `Leader review: plan ${verdict.verdict}`, { feedback: verdict.feedback });
      if (verdict.verdict === 'disapproved') {
        emitMissionEvent(missionId, 'phase', 'Plan disapproved — revising once with feedback');
        const revised = await createPlan(missionId, mission.request, verdict.feedback);
        planRow = latestPlan(missionId);
        const v2 = await reviewPlan(missionId, revised.planId, revised.contentMd);
        emitMissionEvent(missionId, 'plan_reviewed', `Leader re-review: plan ${v2.verdict}`, { feedback: v2.feedback });
        if (v2.verdict === 'disapproved') {
          blockMission(missionId, 'Plan failed leader review twice. You can approve or revise it.');
          return;
        }
      }
    } else if (planRow.status !== 'approved') {
      emitMissionEvent(missionId, 'phase', 'Phase 1 — Plan: re-reviewing the pending plan');
      const verdict = await reviewPlan(missionId, planRow.id, planRow.content_md);
      emitMissionEvent(missionId, 'plan_reviewed', `Leader review: plan ${verdict.verdict}`, { feedback: verdict.feedback });
      if (verdict.verdict === 'disapproved') {
        blockMission(missionId, 'Plan pending review. Approve or revise it to continue.');
        return;
      }
    }
    planRow = latestPlan(missionId);
    if (!planRow) throw new Error('Plan missing after Phase 1.');

    // ---- Phase 2 — Breakdown & Assign (skip when sub-tasks already exist) ----
    if (!subtaskRows(missionId).length) {
      db.prepare("UPDATE missions SET phase = 'breakdown', updated_at = datetime('now') WHERE id = ?").run(missionId);
      emitMissionEvent(missionId, 'phase', 'Phase 2 — Breakdown & assignment: matching agents by skill fit');
      const specs = planSubtasks(planRow.id);
      if (!specs.length) throw new Error('Plan has no sub-tasks.');
      breakdownAndAssign(missionId, planRow.id, specs);
    }
    if (!subtaskRows(missionId).length) throw new Error('No sub-tasks after Phase 2.');

    // ---- Phase 3 — Execute (with docs; skip already-executed) ----
    db.prepare("UPDATE missions SET phase = 'execute', updated_at = datetime('now') WHERE id = ?").run(missionId);
    emitMissionEvent(missionId, 'phase', 'Phase 3 — Execute: agents work with mandatory documentation');
    for (const st of subtaskRows(missionId)) {
      if (['in_review', 'approved', 'blocked'].includes(st.status)) continue;
      const lastDisapproved = one<{ feedback: string }>(
        db.prepare("SELECT feedback FROM reviews WHERE subtask_id = ? AND verdict = 'disapproved' ORDER BY id DESC").get(st.id)
      );
      await executeSubtask(missionId, st, lastDisapproved?.feedback);
    }

    // ---- Phase 4 — Review & gate (one automatic rework round) ----
    db.prepare("UPDATE missions SET phase = 'review', updated_at = datetime('now') WHERE id = ?").run(missionId);
    emitMissionEvent(missionId, 'phase', 'Phase 4 — Review & gate: leader reads agent documentation');
    for (const st of subtaskRows(missionId)) {
      if (st.status === 'approved') continue;
      if (st.status === 'pending') await executeSubtask(missionId, st);
      let verdict = await reviewSubtask(missionId, st.id);
      emitMissionEvent(missionId, 'review_verdict', `${st.title} — ${verdict.verdict}`, { subtaskId: st.id, feedback: verdict.feedback });
      if (verdict.verdict === 'disapproved' && st.rework_count < 1) {
        db.prepare("UPDATE subtasks SET status = 'rework', rework_count = rework_count + 1 WHERE id = ?").run(st.id);
        emitMissionEvent(missionId, 'subtask_status', `${st.title} — sent back for rework`, { subtaskId: st.id, status: 'rework', feedback: verdict.feedback });
        const refreshed = getSubtaskRow(st.id);
        if (!refreshed) throw new Error(`Subtask ${st.id} vanished during rework.`);
        await executeSubtask(missionId, refreshed as SubtaskRow, verdict.feedback);
        verdict = await reviewSubtask(missionId, st.id);
        emitMissionEvent(missionId, 'review_verdict', `${st.title} — re-review: ${verdict.verdict}`, { subtaskId: st.id, feedback: verdict.feedback });
      }
      if (verdict.verdict === 'approved') {
        db.prepare("UPDATE subtasks SET status = 'approved' WHERE id = ?").run(st.id);
        emitMissionEvent(missionId, 'subtask_status', `${st.title} — approved`, { subtaskId: st.id, status: 'approved' });
      } else {
        db.prepare("UPDATE subtasks SET status = 'blocked' WHERE id = ?").run(st.id);
        blockMission(missionId, `Subtask "${st.title}" failed review. You can override the verdict.`);
        return;
      }
    }

    // ---- Phase 5 — Complete & Learn ----
    db.prepare("UPDATE missions SET phase = 'complete', updated_at = datetime('now') WHERE id = ?").run(missionId);
    emitMissionEvent(missionId, 'phase', 'Phase 5 — Complete & learn: writing artifacts, storing patterns');
    const written = writeMissionArtifacts(missionId);
    if (written > 0) {
      emitMissionEvent(missionId, 'artifacts_written', `${written} artifact(s) written to artifacts/mission-${missionId}/`, { count: written });
    }
    const knowledgeId = await distillMission(missionId);
    if (knowledgeId) {
      emitMissionEvent(missionId, 'knowledge_stored', 'Pattern distilled into the Knowledge Library', { knowledgeId });
    }
    db.prepare("UPDATE missions SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(missionId);
    emitMissionEvent(missionId, 'mission_status', 'Mission completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE missions SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(message, missionId);
    emitMissionEvent(missionId, 'error', message);
  } finally {
    running.delete(missionId);
  }
}

function blockMission(missionId: number, reason: string): void {
  db.prepare("UPDATE missions SET status = 'blocked', error = ?, updated_at = datetime('now') WHERE id = ?").run(reason, missionId);
  emitMissionEvent(missionId, 'mission_status', `Blocked — ${reason}`);
}

// ---- User gate overrides ----

export function approvePlan(missionId: number): void {
  const plan = latestPlan(missionId);
  if (plan) setPlanStatus(plan.id, 'approved');
  db.prepare("INSERT INTO reviews (mission_id, subtask_id, reviewer, verdict, feedback, overridden_by_user) VALUES (?, NULL, 'user', 'approved', '', 1)").run(missionId);
  emitMissionEvent(missionId, 'user_override', 'User approved the plan');
  resumeMission(missionId);
}

export async function revisePlan(missionId: number, feedback: string): Promise<void> {
  const mission = missionRow(missionId);
  await createPlan(missionId, mission.request, feedback || 'User requested revision.');
  emitMissionEvent(missionId, 'user_override', 'User requested a plan revision', { feedback });
  db.prepare("UPDATE missions SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(missionId);
  resumeMission(missionId);
}

export function approveSubtask(missionId: number, subtaskId: number): void {
  const st = getSubtaskRow(subtaskId);
  db.prepare("UPDATE subtasks SET status = 'approved' WHERE id = ?").run(subtaskId);
  db.prepare("INSERT INTO reviews (mission_id, subtask_id, reviewer, verdict, feedback, overridden_by_user) VALUES (?, ?, 'user', 'approved', '', 1)").run(missionId, subtaskId);
  emitMissionEvent(missionId, 'user_override', `User approved "${st?.title ?? `subtask ${subtaskId}`}"`, { subtaskId });
  resumeMission(missionId);
}

export async function disapproveSubtask(missionId: number, subtaskId: number, feedback: string): Promise<void> {
  const st = getSubtaskRow(subtaskId);
  if (!st) throw new Error(`Subtask ${subtaskId} not found.`);
  db.prepare("UPDATE subtasks SET status = 'rework', rework_count = rework_count + 1 WHERE id = ?").run(subtaskId);
  db.prepare("INSERT INTO reviews (mission_id, subtask_id, reviewer, verdict, feedback, overridden_by_user) VALUES (?, ?, 'user', 'disapproved', ?, 1)").run(missionId, subtaskId, feedback);
  emitMissionEvent(missionId, 'user_override', `User sent "${st.title}" back with feedback`, { subtaskId, feedback });
  await executeSubtask(missionId, { ...st, status: 'rework', rework_count: st.rework_count } as SubtaskRow, feedback);
  db.prepare("UPDATE missions SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(missionId);
  resumeMission(missionId);
}