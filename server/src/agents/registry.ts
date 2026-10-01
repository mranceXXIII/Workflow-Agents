import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, one, many } from '../db.js';

export interface AgentRow {
  id: number;
  slug: string;
  name: string;
  role: string;
  capabilities: string;
  system_prompt: string;
  doc_duty: number;
  review_duty: number;
  performance: string;
  created_at: string;
}

export interface AgentDef {
  slug: string;
  name: string;
  role: string;
  capabilities: string[];
  systemPrompt: string;
  docDuty: boolean;
  reviewDuty: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
// server/src/agents -> project root is three levels up
const skillsDir = join(here, '..', '..', '..', '.agents', 'skills');

function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name: '', description: '', body: raw };
  const fm = m[1];
  const body = m[2] ?? '';
  let name = '';
  let description = '';
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nm = line.match(/^name:\s*(.+)$/);
    const dmFold = line.match(/^description:\s*>-?\s*$/);
    const dmInline = line.match(/^description:\s*(.+)$/);
    if (nm) {
      name = nm[1].trim();
    } else if (dmFold) {
      const folded: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\S/.test(lines[j])) break;
        folded.push(lines[j].trim());
      }
      description = folded.join(' ').replace(/\s+/g, ' ').trim();
    } else if (dmInline) {
      description = dmInline[1].trim();
    }
  }
  return { name, description, body };
}

function parseCapabilities(body: string): string[] {
  const m = body.match(/^##\s*\d*\.?\s*Capabilities[^\n]*\n([\s\S]*?)(?=\n##\s|\n*$)/m);
  if (!m) return [];
  return m[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean);
}

function parseRole(body: string): string {
  const m = body.match(/##\s*Role\s*\/\s*Authority\s*\n([\s\S]*?)(?=\n##\s)/);
  if (!m) return '';
  const roleLine = m[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\*\*Role:\*\*/.test(l));
  return roleLine ? roleLine.replace(/^[-*]\s*\*\*Role:\*\*\s*/, '').trim() : '';
}

export function loadSkillFiles(): AgentDef[] {
  if (!existsSync(skillsDir)) return [];
  const defs: AgentDef[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const { name, body } = parseFrontmatter(raw);
    const slug = name || entry.name;
    defs.push({
      slug,
      name: name || entry.name,
      role: parseRole(body),
      capabilities: parseCapabilities(body),
      systemPrompt: raw,
      docDuty: true,
      reviewDuty: slug === 'team-leader'
    });
  }
  return defs;
}

/** Load every .agents/skills/<slug>/SKILL.md and upsert it into the DB. */
export function syncAgentsToDb(): number {
  let n = 0;
  for (const def of loadSkillFiles()) {
    const existing = one<{ id: number }>(
      db.prepare('SELECT id FROM agents WHERE slug = ?').get(def.slug)
    );
    if (existing) {
      db.prepare(
        'UPDATE agents SET name = ?, role = ?, capabilities = ?, system_prompt = ?, doc_duty = ?, review_duty = ? WHERE id = ?'
      ).run(
        def.name,
        def.role,
        JSON.stringify(def.capabilities),
        def.systemPrompt,
        def.docDuty ? 1 : 0,
        def.reviewDuty ? 1 : 0,
        existing.id
      );
    } else {
      db.prepare(
        'INSERT INTO agents (slug, name, role, capabilities, system_prompt, doc_duty, review_duty) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        def.slug,
        def.name,
        def.role,
        JSON.stringify(def.capabilities),
        def.systemPrompt,
        def.docDuty ? 1 : 0,
        def.reviewDuty ? 1 : 0
      );
    }
    n++;
  }
  return n;
}

export function allAgents(): AgentRow[] {
  return many<AgentRow>(db.prepare('SELECT * FROM agents ORDER BY id').all());
}

export function getAgentBySlug(slug: string): AgentRow | undefined {
  return one<AgentRow>(db.prepare('SELECT * FROM agents WHERE slug = ?').get(slug));
}

export function getAgentById(id: number): AgentRow | undefined {
  return one<AgentRow>(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
}
