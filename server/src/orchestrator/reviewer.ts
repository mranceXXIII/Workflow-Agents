import { db, one, many } from '../db.js';
import { chatAuto, extractJson } from '../llm/nim.js';
import { searchKnowledge } from '../knowledge/store.js';
import { getSubtaskRow } from './dispatcher.js';

export interface Verdict {
  verdict: 'approved' | 'disapproved';
  feedback: string;
}

function parseVerdict(raw: string, fallbackFeedback: string): Verdict {
  const parsed = extractJson(raw) as Partial<Verdict> | null;
  if (parsed && parsed.verdict === 'disapproved') {
    return { verdict: 'disapproved', feedback: parsed.feedback || fallbackFeedback };
  }
  return { verdict: 'approved', feedback: parsed?.feedback || '' };
}

/**
 * Leader self-review of the plan documentation before dispatch.
 * Persists a reviews row (subtask_id NULL) and updates the plan status.
 */
export async function reviewPlan(missionId: number, planId: number, planMd: string): Promise<Verdict> {
  const user = [
    '[[TASK:REVIEW_PLAN]]',
    'You are the Team Leader reviewing the plan documentation before dispatch. Check:',
    '1. Goal, Analysis, Knowledge used, Risks, Confidence are all present and substantive.',
    '2. Stored knowledge is cited, or the plan explicitly notes it is a new task type.',
    '3. Safety boundaries are respected (no destructive actions without confirmation, no credentials).',
    '[[PLAN]]',
    planMd,
    '[[/PLAN]]',
    'Reply ONLY JSON: {"verdict":"approved"|"disapproved","feedback":"..."}'
  ].join('\n');

  const raw = await chatAuto([
    { role: 'system', content: 'You are the Team Leader review gate. Be strict but pragmatic. Reply with ONLY valid JSON.' },
    { role: 'user', content: user }
  ]);

  const verdict = parseVerdict(raw, 'Plan needs revision.');
  db.prepare("INSERT INTO reviews (mission_id, subtask_id, reviewer, verdict, feedback) VALUES (?, NULL, 'team-leader', ?, ?)").run(
    missionId,
    verdict.verdict,
    verdict.feedback
  );
  db.prepare('UPDATE plans SET status = ? WHERE id = ?').run(verdict.verdict === 'approved' ? 'approved' : 'in_review', planId);
  return verdict;
}

/**
 * Phase 4 — the leader reads the agent's deliverable + working documentation,
 * checks it against the Knowledge Library and the acceptance criteria, and
 * issues a verdict per deliverable. Persists the review and the agent's
 * performance counter.
 */
export async function reviewSubtask(missionId: number, subtaskId: number): Promise<Verdict> {
  const st = getSubtaskRow(subtaskId);
  if (!st) throw new Error(`Subtask ${subtaskId} not found.`);
  const agent = st.assigned_agent_id
    ? one<{ slug: string; name: string }>(db.prepare('SELECT slug, name FROM agents WHERE id = ?').get(st.assigned_agent_id))
    : undefined;

  const docRow = one<{ content_md: string }>(
    db.prepare("SELECT content_md FROM documents WHERE mission_id = ? AND agent_id = ? AND type = 'agent_doc' ORDER BY id DESC").all(missionId, st.assigned_agent_id ?? -1)[0]
  );
  const knowledge = await searchKnowledge(`${st.title} ${st.description}`, 3);
  const knowledgeBlock = knowledge.length
    ? knowledge.map((k) => `- ${k.title} (score ${k.score.toFixed(2)}): ${k.content_md.slice(0, 250)}`).join('\n')
    : '(no stored pattern matches)';

  const user = [
    '[[TASK:REVIEW]]',
    `You are the Team Leader reviewing a worker agent's deliverable and its working documentation.`,
    `[[SUBTASK_TITLE]]${st.title}[[/SUBTASK_TITLE]]`,
    `[[SUBTASK_DESCRIPTION]]${st.description}[[/SUBTASK_DESCRIPTION]]`,
    `[[ACCEPTANCE_CRITERIA]]${st.acceptance_criteria}[[/ACCEPTANCE_CRITERIA]]`,
    `[[AGENT]]${agent ? `${agent.name} (${agent.slug})` : 'unknown'}[[/AGENT]]`,
    '[[WORKING_DOCUMENTATION]]',
    docRow?.content_md ?? '(missing — disapprove: documentation duty was not fulfilled)',
    '[[/WORKING_DOCUMENTATION]]',
    '[[DELIVERABLE]]',
    st.result_md || '(missing — disapprove)',
    '[[/DELIVERABLE]]',
    '[[KNOWLEDGE_LIBRARY]]',
    knowledgeBlock,
    '[[/KNOWLEDGE_LIBRARY]]',
    '',
    'Verify: (1) documentation has Action/Decision/Artifact/Confidence; (2) deliverable meets the acceptance criteria; (3) consistent with stored knowledge or deviations justified; (4) no safety violations. Reply ONLY JSON: {"verdict":"approved"|"disapproved","feedback":"..."}'
  ].join('\n');

  const raw = await chatAuto([
    { role: 'system', content: 'You are the Team Leader review gate for agent deliverables. Be strict but pragmatic. Reply with ONLY valid JSON.' },
    { role: 'user', content: user }
  ]);

  const verdict = parseVerdict(raw, 'Deliverable did not meet the acceptance criteria.');
  db.prepare('INSERT INTO reviews (mission_id, subtask_id, reviewer, verdict, feedback) VALUES (?, ?, ?, ?, ?)').run(
    missionId,
    subtaskId,
    'team-leader',
    verdict.verdict,
    verdict.feedback
  );
  if (st.assigned_agent_id) {
    const key = verdict.verdict === 'approved' ? 'approvals' : 'reworks';
    const perfRow = one<{ performance: string }>(db.prepare('SELECT performance FROM agents WHERE id = ?').get(st.assigned_agent_id));
    let perf: Record<string, number> = {};
    try {
      perf = perfRow ? (JSON.parse(perfRow.performance) as Record<string, number>) : {};
    } catch {
      perf = {};
    }
    perf[key] = (perf[key] ?? 0) + 1;
    perf['tasks_done'] = (perf['tasks_done'] ?? 0) + 1;
    db.prepare('UPDATE agents SET performance = ? WHERE id = ?').run(JSON.stringify(perf), st.assigned_agent_id);
  }
  return verdict;
}

export function reviewsForMission(missionId: number): { id: number; subtask_id: number | null; reviewer: string; verdict: string; feedback: string; overridden_by_user: number; created_at: string }[] {
  return many(db.prepare('SELECT * FROM reviews WHERE mission_id = ? ORDER BY id').all(missionId));
}
