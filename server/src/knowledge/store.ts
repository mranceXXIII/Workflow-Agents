import { db, one, many } from '../db.js';
import { chatAuto, embedAuto, extractJson } from '../llm/nim.js';

export interface KnowledgeMatch {
  id: number;
  title: string;
  content_md: string;
  domain: string;
  tags: string[];
  confidence: number;
  score: number;
  usage_count: number;
  success_count: number;
}

interface KnowledgeRow {
  id: number;
  title: string;
  content_md: string;
  domain: string;
  tags: string;
  embedding: string;
  source_mission_id: number | null;
  usage_count: number;
  success_count: number;
  confidence: number;
  created_at: string;
  last_used: string | null;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export function similarityThreshold(): number {
  const row = one<{ value: string }>(
    db.prepare("SELECT value FROM settings WHERE key = 'knowledge_similarity_threshold'").get()
  );
  const t = row ? parseFloat(row.value) : NaN;
  return Number.isFinite(t) ? t : 0.35;
}

export async function searchKnowledge(query: string, limit = 5): Promise<KnowledgeMatch[]> {
  const q = await embedAuto(query, 'query');
  const rows = many<KnowledgeRow>(db.prepare('SELECT * FROM knowledge').all());
  const scored = rows
    .map((r) => {
      let emb: number[] = [];
      try {
        emb = JSON.parse(r.embedding) as number[];
      } catch {
        emb = [];
      }
      return { row: r, score: cosine(q, emb) };
    })
    .filter((s) => s.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const matches: KnowledgeMatch[] = [];
  for (const s of scored) {
    db.prepare('UPDATE knowledge SET usage_count = usage_count + 1, last_used = datetime(?) WHERE id = ?').run(
      new Date().toISOString(),
      s.row.id
    );
    let tags: string[] = [];
    try {
      tags = JSON.parse(s.row.tags) as string[];
    } catch {
      tags = [];
    }
    matches.push({
      id: s.row.id,
      title: s.row.title,
      content_md: s.row.content_md,
      domain: s.row.domain,
      tags,
      confidence: s.row.confidence,
      score: s.score,
      usage_count: s.row.usage_count + 1,
      success_count: s.row.success_count
    });
  }
  return matches;
}

export async function addKnowledge(input: {
  title: string;
  content_md: string;
  domain?: string;
  tags?: string[];
  source_mission_id?: number | null;
  confidence?: number;
  success_count?: number;
}): Promise<number> {
  const emb = await embedAuto(`${input.title}\n${input.content_md}`, 'passage');
  const res = db
    .prepare(
      `INSERT INTO knowledge (title, content_md, domain, tags, embedding, source_mission_id, confidence, success_count, last_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      input.title,
      input.content_md,
      input.domain ?? '',
      JSON.stringify(input.tags ?? []),
      JSON.stringify(emb),
      input.source_mission_id ?? null,
      input.confidence ?? 0.5,
      input.success_count ?? 0
    );
  return Number(res.lastInsertRowid);
}

/** Re-embed every knowledge entry with the current model (call after switching models). */
export async function reembedAll(): Promise<number> {
  const rows = many<{ id: number; title: string; content_md: string }>(
    db.prepare('SELECT id, title, content_md FROM knowledge').all()
  );
  let n = 0;
  for (const r of rows) {
    const emb = await embedAuto(`${r.title}\n${r.content_md}`, 'passage');
    db.prepare('UPDATE knowledge SET embedding = ? WHERE id = ?').run(JSON.stringify(emb), r.id);
    n++;
  }
  return n;
}

/**
 * Phase 5 — distill a completed mission into a reusable knowledge pattern
 * (modeled on reasoningbank: trajectory → pattern → level + confidence).
 * Returns the knowledge id, or null when the mission does not exist.
 */
export async function distillMission(missionId: number): Promise<number | null> {
  const mission = one<{ id: number; request: string; status: string }>(
    db.prepare('SELECT id, request, status FROM missions WHERE id = ?').get(missionId)
  );
  if (!mission) return null;

  const subs = many<{ title: string; status: string; result_md: string }>(
    db.prepare('SELECT title, status, result_md FROM subtasks WHERE mission_id = ? ORDER BY id').all(missionId)
  );
  const docs = many<{ type: string; title: string }>(
    db.prepare('SELECT type, title FROM documents WHERE mission_id = ? ORDER BY id').all(missionId)
  );
  const trajectory = [
    `Request: ${mission.request}`,
    'Subtasks:',
    ...subs.map((s) => `- ${s.title} (${s.status})`),
    `Documents produced: ${docs.map((d) => d.type).join(', ') || 'none'}`
  ].join('\n');

  const prompt = [
    '[[TASK:DISTILL]]',
    `[[REQUEST]]${mission.request}[[/REQUEST]]`,
    '[[TRAJECTORY]]',
    trajectory,
    '[[/TRAJECTORY]]',
    '',
    'Distill this completed mission into one reusable knowledge pattern. Reply with ONLY JSON:',
    '{"title": "...", "content_md": "... markdown with **Trigger:** / **Approach:** / **Gotchas:** ...", "level": "concrete" | "pattern" | "principle", "confidence": 0.0-1.0}'
  ].join('\n');

  const raw = await chatAuto([
    { role: 'system', content: 'You are the Knowledge Librarian distilling completed missions into reusable patterns. Reply with ONLY valid JSON, no markdown fences.' },
    { role: 'user', content: prompt }
  ]);

  const parsed = extractJson(raw) as { title?: string; content_md?: string; level?: string; confidence?: number } | null;
  const level = parsed?.level && ['concrete', 'pattern', 'principle'].includes(parsed.level) ? parsed.level : 'pattern';
  const title = parsed?.title || `Pattern: ${mission.request.slice(0, 60)}`;
  const contentMd =
    parsed?.content_md ||
    `**Trigger:** When you need to: ${mission.request}\n\n**Approach:**\n${subs.map((s) => `- ${s.title}`).join('\n') || '- (see mission)'}\n\n**Gotchas:** Distilled from mission trajectory.`;
  const success = mission.status === 'completed' ? 1 : 0;

  return await addKnowledge({
    title,
    content_md: contentMd,
    domain: 'mission',
    tags: ['distilled', `level:${level}`],
    source_mission_id: missionId,
    confidence: typeof parsed?.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.6,
    success_count: success
  }).then(async (id) => {
    // Consolidate near-duplicates created by re-distillation (Librarian §5)
    await consolidateKnowledge();
    return id;
  });
}

export function knowledgeStats(): { total: number; domains: number; avg_confidence: number } {
  const rows = many<{ domain: string; confidence: number }>(
    db.prepare('SELECT domain, confidence FROM knowledge').all()
  );
  const domains = new Set(rows.map((r) => r.domain));
  const avg = rows.length ? rows.reduce((s, r) => s + r.confidence, 0) / rows.length : 0;
  return { total: rows.length, domains: domains.size, avg_confidence: Math.round(avg * 100) / 100 };
}

/**
 * Consolidation (Knowledge Librarian §5): merge near-duplicate patterns
 * (cosine similarity > 0.92) — keep the older entry, combine usage/success
 * counts, remove the duplicate. Returns the number of merges.
 */
export async function consolidateKnowledge(): Promise<number> {
  const rows = many<KnowledgeRow>(db.prepare('SELECT * FROM knowledge ORDER BY id').all());
  const items = rows.map((r) => {
    let emb: number[] = [];
    try {
      emb = JSON.parse(r.embedding) as number[];
    } catch {
      emb = [];
    }
    return { row: r, emb };
  });
  let merged = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.row.id < 0 || b.row.id < 0 || a.row.id === b.row.id) continue;
      if (!a.emb.length || a.emb.length !== b.emb.length) continue;
      if (cosine(a.emb, b.emb) <= 0.92) continue;
      const keep = a.row.id < b.row.id ? a.row : b.row;
      const drop = a.row.id < b.row.id ? b.row : a.row;
      db.prepare('UPDATE knowledge SET usage_count = usage_count + ?, success_count = success_count + ? WHERE id = ?').run(
        drop.usage_count,
        drop.success_count,
        keep.id
      );
      db.prepare('DELETE FROM knowledge WHERE id = ?').run(drop.id);
      items[j] = { row: { ...b.row, id: -1 }, emb: [] };
      merged++;
    }
  }
  return merged;
}
