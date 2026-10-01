import { db, many, one } from '../db.js';
import type { SubtaskSpec } from './planner.js';

interface AgentScoreRow {
  id: number;
  slug: string;
  name: string;
  role: string;
  capabilities: string;
  performance: string;
}

export interface Assignment {
  subtaskId: number;
  title: string;
  agentId: number;
  agentSlug: string;
  score: number;
}

/**
 * Capability-based assignment (modeled on ruflo hierarchical-coordinator):
 * capability match -> performance history -> current workload.
 */
export function scoreAgents(
  spec: SubtaskSpec,
  agents: AgentScoreRow[],
  workload: Map<number, number>
): { agentId: number; agentSlug: string; score: number }[] {
  const wanted = (spec.capabilities ?? []).map((c) => c.toLowerCase().trim()).filter(Boolean);
  const suggested = (spec.suggested_agent ?? '').toLowerCase().trim();

  return agents
    .map((a) => {
      let caps: string[] = [];
      try {
        caps = JSON.parse(a.capabilities) as string[];
      } catch {
        caps = [];
      }
      const capList = caps.map((c) => String(c).toLowerCase());

      const overlap = wanted.filter((w) =>
        capList.some((c) => c.includes(w) || w.includes(c))
      ).length;
      let score = wanted.length ? overlap / wanted.length : 0.5;

      if (suggested && a.slug.toLowerCase() === suggested) score = Math.max(score, 1);

      let perf: { approvals?: number; reworks?: number } = {};
      try {
        perf = JSON.parse(a.performance) as { approvals?: number; reworks?: number };
      } catch {
        perf = {};
      }
      const total = (perf.approvals ?? 0) + (perf.reworks ?? 0);
      if (total > 0) score += 0.1 * (((perf.approvals ?? 0) - (perf.reworks ?? 0)) / total);

      score -= 0.05 * (workload.get(a.id) ?? 0);
      return { agentId: a.id, agentSlug: a.slug, score };
    })
    .sort((x, y) => y.score - x.score);
}

/** Phase 2 — persist sub-tasks and assign the best agent per sub-task. */
export function breakdownAndAssign(missionId: number, planId: number, subtasks: SubtaskSpec[]): Assignment[] {
  const agents = many<AgentScoreRow>(db.prepare('SELECT * FROM agents').all());
  if (!agents.length) throw new Error('No agents registered — .agents/skills not found.');
  const workload = new Map<number, number>();
  const assignments: Assignment[] = [];

  for (const s of subtasks) {
    const scored = scoreAgents(s, agents, workload);
    const best = scored[0];
    const res = db
      .prepare(
        `INSERT INTO subtasks (mission_id, plan_id, title, description, acceptance_criteria, assigned_agent_id, suggested_agent, requested_capabilities, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        missionId,
        planId,
        s.title,
        s.description,
        s.acceptance_criteria,
        best.agentId,
        s.suggested_agent ?? '',
        JSON.stringify(s.capabilities ?? [])
      );
    workload.set(best.agentId, (workload.get(best.agentId) ?? 0) + 1);
    assignments.push({
      subtaskId: Number(res.lastInsertRowid),
      title: s.title,
      agentId: best.agentId,
      agentSlug: best.agentSlug,
      score: best.score
    });
  }
  return assignments;
}

export function getSubtaskRow(subtaskId: number):
  | {
      id: number;
      mission_id: number;
      plan_id: number | null;
      title: string;
      description: string;
      acceptance_criteria: string;
      assigned_agent_id: number | null;
      status: string;
      result_md: string;
      rework_count: number;
    }
  | undefined {
  return one(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId));
}
