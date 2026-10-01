import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, one, many, allSettings, setSetting, DB_PATH } from './db.js';
import { syncAgentsToDb, allAgents } from './agents/registry.js';
import { createAgent } from './agents/factory.js';
import { startMission, missionEvents, approvePlan, revisePlan, approveSubtask, disapproveSubtask } from './orchestrator/mission-runner.js';
import { mode, nimModel, nimEmbedModel, listModels } from './llm/nim.js';
import { searchKnowledge, addKnowledge, reembedAll, knowledgeStats, consolidateKnowledge } from './knowledge/store.js';
import { seedKnowledge } from './seed/playbooks.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Initialize: load .agents/skills into the agent registry, seed knowledge
const synced = syncAgentsToDb();
seedKnowledge().catch(() => {});

// ---- Health & settings ----

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: mode(), model: nimModel(), embedModel: nimEmbedModel(), db: DB_PATH, agents: synced });
});

app.get('/api/settings', (_req, res) => {
  const s = { ...allSettings() };
  if (s.nim_api_key) s.nim_api_key = `${s.nim_api_key.slice(0, 8)}…`;
  if (s.telegram_bot_token) s.telegram_bot_token = '••••••••';
  res.json({ settings: s, mode: mode(), model: nimModel(), embedModel: nimEmbedModel(), knowledge: knowledgeStats() });
});

const SETTING_KEYS = ['nim_api_key', 'nim_model', 'nim_embed_model', 'telegram_bot_token', 'telegram_chat_id', 'knowledge_similarity_threshold'];

app.put('/api/settings', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let saved = 0;
  for (const [k, v] of Object.entries(body)) {
    if (!SETTING_KEYS.includes(k) || typeof v !== 'string') continue;
    setSetting(k, v.trim());
    saved++;
  }
  res.json({ ok: true, saved, mode: mode() });
});

app.post('/api/settings/test', async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ ok: true, model_count: models.length, models: models.slice(0, 300) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Agents ----

app.get('/api/agents', (_req, res) => {
  const agents = allAgents().map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    role: a.role,
    capabilities: JSON.parse(a.capabilities || '[]'),
    review_duty: !!a.review_duty,
    performance: JSON.parse(a.performance || '{}')
  }));
  res.json({ agents });
});

app.post('/api/agents', (req, res) => {
  const body = (req.body ?? {}) as { name?: string; description?: string; role?: string; capabilities?: string[]; slug?: string };
  if (!body.name || !body.description || !body.role || !Array.isArray(body.capabilities) || !body.capabilities.length) {
    res.status(400).json({ error: 'name, description, role, and capabilities are required' });
    return;
  }
  try {
    const id = createAgent({ slug: body.slug, name: body.name, description: body.description, role: body.role, capabilities: body.capabilities });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Missions ----

app.get('/api/missions', (_req, res) => {
  const missions = many(db.prepare('SELECT id, title, request, source, task_domain, phase, status, error, created_at, updated_at FROM missions ORDER BY id DESC LIMIT 100').all());
  res.json({ missions });
});

app.post('/api/missions', (req, res) => {
  const body = (req.body ?? {}) as { request?: string; source?: string; task_domain?: string };
  if (!body.request || !body.request.trim()) {
    res.status(400).json({ error: 'request is required' });
    return;
  }
  const id = startMission(body.request.trim(), body.source || 'web', body.task_domain || '');
  res.json({ id });
});

app.get('/api/missions/:id', (req, res) => {
  const id = Number(req.params.id);
  const mission = one(db.prepare('SELECT * FROM missions WHERE id = ?').get(id));
  if (!mission) {
    res.status(404).json({ error: 'mission not found' });
    return;
  }
  const plan = one(db.prepare('SELECT id, content_md, knowledge_used, subtasks_json, confidence, status, created_at FROM plans WHERE mission_id = ? ORDER BY id DESC').get(id));
  const subtasks = many(db.prepare('SELECT s.id, s.title, s.description, s.acceptance_criteria, s.status, s.result_md, s.rework_count, a.name AS agent_name, a.slug AS agent_slug FROM subtasks s LEFT JOIN agents a ON a.id = s.assigned_agent_id WHERE s.mission_id = ? ORDER BY s.id').all(id));
  const documents = many(db.prepare('SELECT id, agent_id, type, title, content_md, created_at FROM documents WHERE mission_id = ? ORDER BY id').all(id));
  const reviews = many(db.prepare('SELECT * FROM reviews WHERE mission_id = ? ORDER BY id').all(id));
  const events = many(db.prepare('SELECT kind, summary, payload, created_at FROM events WHERE mission_id = ? ORDER BY id').all(id));
  const knowledge = many(db.prepare('SELECT id, title, domain, confidence FROM knowledge WHERE source_mission_id = ?').all(id));
  res.json({ mission, plan, subtasks, documents, reviews, events, knowledge });
});

// ---- Live updates (SSE) ----

app.get('/api/missions/:id/events', (req, res) => {
  const id = Number(req.params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ kind: 'connected', missionId: id })}\n\n`);
  const off = missionEvents(id, (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
});

// ---- Knowledge Library ----

app.get('/api/knowledge', (_req, res) => {
  const knowledge = many(db.prepare('SELECT id, title, domain, tags, confidence, usage_count, success_count, source_mission_id, created_at, last_used FROM knowledge ORDER BY id DESC').all());
  res.json({ knowledge, stats: knowledgeStats() });
});

app.post('/api/knowledge/search', async (req, res) => {
  const body = (req.body ?? {}) as { query?: string; limit?: number };
  if (!body.query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }
  const matches = await searchKnowledge(body.query, body.limit ?? 5);
  res.json({ matches });
});

app.post('/api/knowledge', async (req, res) => {
  const body = (req.body ?? {}) as { title?: string; content_md?: string; domain?: string; tags?: string[] };
  if (!body.title || !body.content_md) {
    res.status(400).json({ error: 'title and content_md are required' });
    return;
  }
  const id = await addKnowledge({ title: body.title, content_md: body.content_md, domain: body.domain, tags: body.tags });
  res.json({ ok: true, id });
});

app.delete('/api/knowledge/:id', (req, res) => {
  db.prepare('DELETE FROM knowledge WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/knowledge/reembed', async (_req, res) => {
  const reembedded = await reembedAll();
  res.json({ ok: true, reembedded });
});

app.post('/api/knowledge/consolidate', async (_req, res) => {
  const merged = await consolidateKnowledge();
  res.json({ ok: true, merged, stats: knowledgeStats() });
});

app.post('/api/knowledge/seed', async (_req, res) => {
  const seeded = await seedKnowledge(true);
  res.json({ ok: true, seeded });
});

// ---- User gate overrides ----

app.post('/api/missions/:id/plan/approve', (req, res) => {
  const id = Number(req.params.id);
  if (!one(db.prepare('SELECT id FROM missions WHERE id = ?').get(id))) {
    res.status(404).json({ error: 'mission not found' });
    return;
  }
  approvePlan(id);
  res.json({ ok: true });
});

app.post('/api/missions/:id/plan/revise', (req, res) => {
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as { feedback?: string };
  if (!one(db.prepare('SELECT id FROM missions WHERE id = ?').get(id))) {
    res.status(404).json({ error: 'mission not found' });
    return;
  }
  void revisePlan(id, body.feedback || 'User requested revision.').catch((err) => {
    db.prepare("UPDATE missions SET status = 'failed', error = ? WHERE id = ?").run(err instanceof Error ? err.message : String(err), id);
  });
  res.json({ ok: true });
});

app.post('/api/missions/:id/subtasks/:sid/approve', (req, res) => {
  const id = Number(req.params.id);
  const sid = Number(req.params.sid);
  approveSubtask(id, sid);
  res.json({ ok: true });
});

app.post('/api/missions/:id/subtasks/:sid/disapprove', (req, res) => {
  const id = Number(req.params.id);
  const sid = Number(req.params.sid);
  const body = (req.body ?? {}) as { feedback?: string };
  disapproveSubtask(id, sid, body.feedback || 'User disapproved — please revise.').catch((err) => {
    db.prepare("UPDATE missions SET status = 'failed', error = ? WHERE id = ?").run(err instanceof Error ? err.message : String(err), id);
  });
  res.json({ ok: true });
});

// ---- Static web UI (serves the built web/ app) ----

const webDist = join(here, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(join(webDist, 'index.html'));
  });
}

// ---- Error handling & startup ----

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`IT Ops Command Center server on http://localhost:${PORT} (mode: ${mode()}, model: ${nimModel()}, agents: ${synced})`);
});