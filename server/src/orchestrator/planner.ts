import { db, one } from '../db.js';
import { chatAuto, extractJson } from '../llm/nim.js';
import { searchKnowledge, similarityThreshold } from '../knowledge/store.js';
import { allAgents } from '../agents/registry.js';

export interface SubtaskSpec {
  title: string;
  description: string;
  acceptance_criteria: string;
  suggested_agent?: string;
  capabilities?: string[];
}

export interface PlanResult {
  title: string;
  goal: string;
  analysis: string;
  knowledge_used: string[];
  risks: string;
  confidence: string;
  subtasks: SubtaskSpec[];
}

export interface PlanPersisted {
  planId: number;
  plan: PlanResult;
  contentMd: string;
}

interface PlanRow {
  id: number;
  mission_id: number;
  content_md: string;
  knowledge_used: string;
  confidence: string;
  status: string;
}

function normalizeSubtask(s: Partial<SubtaskSpec>, index: number): SubtaskSpec {
  return {
    title: s.title || `Sub-task ${index + 1}`,
    description: s.description || '',
    acceptance_criteria: s.acceptance_criteria || 'Deliverable documented with actions, decisions, artifacts, confidence.',
    suggested_agent: s.suggested_agent || '',
    capabilities: Array.isArray(s.capabilities) ? s.capabilities.map(String) : []
  };
}

function fallbackPlan(request: string): PlanResult {
  return {
    title: `Mission: ${request.slice(0, 60)}`,
    goal: `Complete the request: ${request}`,
    analysis: 'LLM plan could not be parsed; fallback plan produced.',
    knowledge_used: [],
    risks: 'Plan produced by fallback — review carefully.',
    confidence: 'Low',
    subtasks: [normalizeSubtask({ title: 'Analyze and produce the deliverable', description: request }, 0)]
  };
}

export function renderPlanMd(p: PlanResult): string {
  return [
    `# ${p.title}`,
    '',
    '## Goal',
    p.goal,
    '',
    '## Analysis',
    p.analysis,
    '',
    '## Knowledge used',
    p.knowledge_used.map((k) => `- ${k}`).join('\n') || '- (none cited)',
    '',
    '## Sub-task breakdown preview',
    p.subtasks.map((s, i) => `${i + 1}. ${s.title} — ${s.suggested_agent || 'unassigned'}`).join('\n'),
    '',
    '## Risks',
    p.risks || '- (none stated)',
    '',
    '## Confidence',
    p.confidence,
    ''
  ].join('\n');
}

/**
 * Phase 1 — create the plan document (GOAP-style state assessment + knowledge
 * retrieval + citation). Persists the plan and returns it.
 */
export async function createPlan(missionId: number, request: string, reviseFeedback?: string): Promise<PlanPersisted> {
  const matches = await searchKnowledge(request, 5);
  const threshold = similarityThreshold();
  const known = matches.filter((m) => m.score >= threshold);

  const agentRoster = allAgents()
    .map((a) => `- ${a.slug}: ${a.role || a.name}`)
    .join('\n');
  const knowledgeBlock = known.length
    ? known.map((m) => `- [score ${m.score.toFixed(2)}] ${m.title}: ${m.content_md.slice(0, 400)}`).join('\n')
    : '(no stored pattern matches — treat as a NEW task type: plan conservatively and record it after completion)';

  const user = [
    '[[TASK:PLAN]]',
    `[[REQUEST]]${request}[[/REQUEST]]`,
    '[[KNOWLEDGE]]',
    knowledgeBlock,
    '[[/KNOWLEDGE]]',
    '[[AGENTS]]',
    agentRoster,
    '[[/AGENTS]]',
    ...(reviseFeedback ? [`[[REVIEW_FEEDBACK]]${reviseFeedback}[[/REVIEW_FEEDBACK]]`] : []),
    '',
    'Produce ONLY JSON with keys: title, goal, analysis, knowledge_used (array of cited pattern titles; empty if new task type), risks (string), confidence ("High"|"Medium"|"Low"), subtasks (array of {title, description, acceptance_criteria, suggested_agent (one of the agent slugs above), capabilities (array of strings)}). No markdown fences.'
  ].join('\n');

  const raw = await chatAuto([
    {
      role: 'system',
      content:
        'You are the Team Leader (Mission Control) of an IT operations agent team. Phase 1 duty: analyze the request, build the plan on stored knowledge, cite what you used, flag risks. Reply with ONLY valid JSON, no markdown fences.'
    },
    { role: 'user', content: user }
  ]);

  const parsed = extractJson(raw) as Partial<PlanResult> | null;
  const knownTitles = known.map((k) => k.title);
  const citedTitles = parsed && Array.isArray(parsed.knowledge_used) ? parsed.knowledge_used.map(String) : [];
  const knowledge_used = Array.from(new Set([...knownTitles, ...citedTitles]));
  const plan: PlanResult =
    parsed && typeof parsed.goal === 'string' && parsed.goal
      ? {
          title: parsed.title || `Mission: ${request.slice(0, 60)}`,
          goal: parsed.goal,
          analysis: parsed.analysis || '',
          knowledge_used,
          risks: typeof parsed.risks === 'string' ? parsed.risks : parsed.risks ? JSON.stringify(parsed.risks) : '',
          confidence: parsed.confidence || 'Medium',
          subtasks:
            Array.isArray(parsed.subtasks) && parsed.subtasks.length
              ? parsed.subtasks.map((s, i) => normalizeSubtask(s as Partial<SubtaskSpec>, i))
              : [normalizeSubtask({ title: 'Analyze and produce the deliverable', description: request }, 0)]
        }
      : fallbackPlan(request);

  const contentMd = renderPlanMd(plan);
  const res = db
    .prepare(
      "INSERT INTO plans (mission_id, content_md, knowledge_used, subtasks_json, confidence, status) VALUES (?, ?, ?, ?, ?, 'in_review')"
    )
    .run(missionId, contentMd, JSON.stringify(plan.knowledge_used), JSON.stringify(plan.subtasks), plan.confidence);
  const planId = Number(res.lastInsertRowid);

  db.prepare("INSERT INTO documents (mission_id, agent_id, type, title, content_md) VALUES (?, NULL, 'plan', ?, ?)").run(
    missionId,
    plan.title,
    contentMd
  );

  return { planId, plan, contentMd };
}

export function latestPlan(missionId: number): PlanRow | undefined {
  return one<PlanRow>(db.prepare('SELECT * FROM plans WHERE mission_id = ? ORDER BY id DESC').get(missionId));
}

export function setPlanStatus(planId: number, status: string): void {
  db.prepare('UPDATE plans SET status = ? WHERE id = ?').run(status, planId);
}

export function planKnowledgeUsed(planId: number): string[] {
  const row = one<{ knowledge_used: string }>(db.prepare('SELECT knowledge_used FROM plans WHERE id = ?').get(planId));
  try {
    return row ? (JSON.parse(row.knowledge_used) as string[]) : [];
  } catch {
    return [];
  }
}

/** Recover the plan's sub-task specs (persisted as subtasks_json) for Phase 2. */
export function planSubtasks(planId: number): SubtaskSpec[] {
  const row = one<{ subtasks_json: string }>(db.prepare('SELECT subtasks_json FROM plans WHERE id = ?').get(planId));
  if (!row) return [];
  try {
    const arr = JSON.parse(row.subtasks_json) as Partial<SubtaskSpec>[];
    if (!Array.isArray(arr) || !arr.length) return [];
    return arr.map((s, i) => normalizeSubtask(s, i));
  } catch {
    return [];
  }
}