import type { ChatMessage } from './nim.js';

/**
 * Deterministic mock LLM for dry_run mode. The whole 5-phase pipeline runs
 * without any API key: the runner embeds [[TASK:*]] markers in its prompts and
 * the mock replies with canned, valid JSON for each pipeline step.
 */

const DIMS = 96;

/** Bag-of-words hash embedding — same text always yields the same vector, and
 *  texts sharing tokens land close together, so cosine search behaves. */
export function mockEmbed(text: string): number[] {
  const vec = new Array<number>(DIMS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    vec[h % DIMS] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function extract(prompt: string, open: string, close: string): string {
  const a = prompt.indexOf(open);
  const b = prompt.indexOf(close, a + open.length);
  if (a === -1 || b === -1) return '';
  return prompt.slice(a + open.length, b).trim();
}

interface SubtaskSpec {
  title: string;
  description: string;
  acceptance_criteria: string;
  suggested_agent: string;
  capabilities: string[];
}

function subtasksFor(request: string): SubtaskSpec[] {
  const q = request.toLowerCase();
  const subs: SubtaskSpec[] = [];
  if (/(access|account|mailbox|permission|onboard|ad |group)/.test(q)) {
    subs.push({
      title: 'Prepare access creation artifact',
      description: `Produce a ready-to-run access artifact for: ${request}`,
      acceptance_criteria: 'Artifact has an idempotency guard, a least-privilege check, and a rollback note.',
      suggested_agent: 'access-management-agent',
      capabilities: ['access creation', 'least privilege']
    });
  }
  if (/(ticket|incident|issue|outage)/.test(q)) {
    subs.push({
      title: 'Draft the ticket work',
      description: `Triage and draft ticket content for: ${request}`,
      acceptance_criteria: 'Complete ticket draft a stranger could work from; triage reasoning documented.',
      suggested_agent: 'ticketing-agent',
      capabilities: ['ticket triage', 'ticket creation']
    });
  }
  if (/(email|mail|customer|reply|respond)/.test(q)) {
    subs.push({
      title: 'Draft the email / support reply',
      description: `Draft the communication for: ${request}`,
      acceptance_criteria: 'Clear subject, concise body, explicit next step; no invented facts.',
      suggested_agent: 'email-comms-agent',
      capabilities: ['email drafting', 'customer support']
    });
  }
  if (/(script|automat|develop|code|tool|workflow)/.test(q)) {
    subs.push({
      title: 'Build the automation artifact',
      description: `Develop the script/automation for: ${request}`,
      acceptance_criteria: 'Tested or dry-run validated; error handling present; rollback note attached.',
      suggested_agent: 'dev-automation-agent',
      capabilities: ['development', 'automation']
    });
  }
  if (/(data|upload|report|dashboard|power ?bi|document)/.test(q)) {
    subs.push({
      title: 'Produce the data/reporting deliverable',
      description: `Prepare the deliverable for: ${request}`,
      acceptance_criteria: 'Runbook/validation checklist or report spec with DAX measures and refresh guidance.',
      suggested_agent: 'data-reporting-agent',
      capabilities: ['data upload', 'power bi', 'documentation']
    });
  }
  if (/(maintenance|patch|health|backup|monitor|server)/.test(q)) {
    subs.push({
      title: 'Prepare the maintenance plan',
      description: `Plan the maintenance/monitoring work for: ${request}`,
      acceptance_criteria: 'Checklist with expected results, blast-radius assessment, rollback note per step.',
      suggested_agent: 'system-maintenance-agent',
      capabilities: ['maintenance', 'monitoring']
    });
  }
  if (subs.length === 0) {
    subs.push({
      title: 'Analyze and produce the deliverable',
      description: request,
      acceptance_criteria: 'Deliverable documented with actions, decisions, artifacts, confidence.',
      suggested_agent: 'dev-automation-agent',
      capabilities: ['analysis']
    });
  }
  return subs.slice(0, 3);
}

function mockPlan(prompt: string): string {
  const request = extract(prompt, '[[REQUEST]]', '[[/REQUEST]]') || 'unspecified request';
  const plan = {
    title: `Mission: ${request.slice(0, 60)}`,
    goal: `Complete the request: ${request}`,
    analysis: 'Dry-run analysis: deterministic mock. Request mapped to specialist agents by domain keywords.',
    knowledge_used: [] as string[],
    risks: 'Dry-run mode: no live system access; all output is illustrative.',
    confidence: 'Medium',
    subtasks: subtasksFor(request)
  };
  return JSON.stringify(plan);
}

function mockExecute(prompt: string): string {
  const title = extract(prompt, '[[SUBTASK_TITLE]]', '[[/SUBTASK_TITLE]]') || 'subtask';
  const desc = extract(prompt, '[[SUBTASK_DESCRIPTION]]', '[[/SUBTASK_DESCRIPTION]]');
  const result = {
    result_md: [
      `## ${title}`,
      '',
      '**Deliverable (dry-run):**',
      '',
      desc || 'Executed the assigned sub-task against the request.',
      '',
      '1. Verified requirements against the request.',
      '2. Produced the artifact (dry-run content).',
      '3. Attached a rollback note.',
      '',
      '```text',
      '(Dry-run artifact — deterministic mock output)',
      '```'
    ].join('\n'),
    documentation_md: [
      `### [mock-agent] — ${title}`,
      '- **Action:** prepared the deliverable in dry-run mode.',
      '- **Decision:** deterministic mock used (no API key configured).',
      '- **Artifact:** deliverable stored in subtask result_md.',
      '- **Confidence:** Medium — dry-run only, not verified against live systems.'
    ].join('\n'),
    artifacts: [
      { name: 'dry-run-artifact.txt', content: `Dry-run artifact for: ${title}\n\n${desc}` }
    ]
  };
  return JSON.stringify(result);
}

function mockReview(): string {
  return JSON.stringify({
    verdict: 'approved',
    feedback: 'Dry-run: documentation complete (Action/Decision/Artifact/Confidence present).'
  });
}

function mockDistill(prompt: string): string {
  const request = extract(prompt, '[[REQUEST]]', '[[/REQUEST]]') || 'request';
  return JSON.stringify({
    title: `Pattern: ${request.slice(0, 60)}`,
    content_md: [
      `**Trigger:** When you need to: ${request}`,
      '',
      '**Approach:** 1. Analyze the request. 2. Produce the deliverable with mandatory documentation. 3. Leader review passed.',
      '',
      '**Gotchas:** Dry-run derived pattern — refine with a live mission.'
    ].join('\n'),
    level: 'pattern',
    confidence: 0.6
  });
}

export function mockChat(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]?.content ?? '';
  if (last.includes('[[TASK:PLAN]]')) return mockPlan(last);
  if (last.includes('[[TASK:EXECUTE]]')) return mockExecute(last);
  if (last.includes('[[TASK:REVIEW]]')) return mockReview();
  if (last.includes('[[TASK:REVIEW_PLAN]]')) return mockReview();
  if (last.includes('[[TASK:DISTILL]]')) return mockDistill(last);
  return 'Dry-run mock response.';
}
