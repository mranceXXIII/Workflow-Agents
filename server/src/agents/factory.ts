import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, one } from '../db.js';

const here = dirname(fileURLToPath(import.meta.url));
// server/src/agents -> project root is three levels up
const skillsDir = join(here, '..', '..', '..', '.agents', 'skills');

export interface NewAgentSpec {
  slug?: string;
  name: string;
  description: string;
  role: string;
  capabilities: string[];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Create a new specialized agent for a new task type (Team Leader §6): writes an
 * agent-spec compliant SKILL.md into .agents/skills/<slug>/ and registers the
 * agent in the DB. Returns the agent id.
 */
export function createAgent(spec: NewAgentSpec): number {
  const slug = spec.slug && spec.slug.trim() ? slugify(spec.slug) : slugify(spec.name);
  if (!slug) throw new Error('Agent name produced an empty slug.');
  const dir = join(skillsDir, slug);
  mkdirSync(dir, { recursive: true });

  const md = [
    '---',
    `name: ${slug}`,
    'description: >-',
    `  ${spec.description}`,
    '---',
    '',
    `# ${spec.name}`,
    '',
    '## Role / Authority',
    '',
    `- **Role:** ${spec.role}`,
    '- **Authority:** Executes assigned sub-tasks (Phase 3) with mandatory documentation. Cannot approve its own work (Phase 4 belongs to the Team Leader).',
    '',
    '## 1. Capabilities',
    '',
    ...spec.capabilities.map((c) => `- ${c}`),
    '',
    '## 2. When invoked',
    '',
    'Assigned by the Team Leader when a sub-task matches these capabilities.',
    '',
    '## 3. How to work',
    '',
    '1. Match the Knowledge Library pattern; follow it; document deviations.',
    '2. Produce the deliverable with documentation in the mandated format (`.agents/rules.md` §4).',
    '3. Hand the trajectory to the knowledge-librarian.',
    '',
    '## 4. Artifacts produced',
    '',
    '- Deliverables per the assigned sub-task.',
    '',
    '## 5. Documentation duty (always)',
    '',
    'Append entries per `.agents/rules.md` §4 (Action, Decision, Artifact, Confidence).',
    '',
    '## 6. Knowledge protocol',
    '',
    '1. **Before:** search for matching patterns.',
    '2. **During:** document deviations.',
    '3. **After:** hand the trajectory to the knowledge-librarian.',
    '',
    '## 7. Safety & boundaries',
    '',
    '- No destructive action without explicit user confirmation.',
    '- No credentials in documentation.',
    ''
  ].join('\n');

  writeFileSync(join(dir, 'SKILL.md'), md, 'utf8');

  const existing = one<{ id: number }>(
    db.prepare('SELECT id FROM agents WHERE slug = ?').get(slug)
  );
  if (existing) return existing.id;
  const res = db
    .prepare(
      'INSERT INTO agents (slug, name, role, capabilities, system_prompt, doc_duty, review_duty) VALUES (?, ?, ?, ?, ?, 1, 0)'
    )
    .run(slug, spec.name, spec.role, JSON.stringify(spec.capabilities), md);
  return Number(res.lastInsertRowid);
}
