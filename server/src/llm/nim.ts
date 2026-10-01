import { getSetting } from '../db.js';
import { mockChat, mockEmbed } from './mock.js';

const NIM_BASE = 'https://integrate.api.nvidia.com/v1';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type RunMode = 'live' | 'dry_run';

export function nimApiKey(): string | null {
  return getSetting('nim_api_key') || process.env.NIM_API_KEY || null;
}

export function nimModel(): string {
  return getSetting('nim_model') || process.env.NIM_MODEL || 'meta/llama-3.3-70b-instruct';
}

export function nimEmbedModel(): string {
  return getSetting('nim_embed_model') || process.env.NIM_EMBED_MODEL || 'nvidia/nv-embedqa-e5-v5';
}

/** live when an API key is configured, dry_run otherwise. */
export function mode(): RunMode {
  return nimApiKey() ? 'live' : 'dry_run';
}

/** Chat via NVIDIA NIM (OpenAI-compatible chat completions). */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const key = nimApiKey();
  if (!key) throw new Error('NVIDIA NIM API key not configured. Set it in Settings.');
  const res = await fetch(`${NIM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: nimModel(), messages, temperature: 0.3, max_tokens: 2048 })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NIM chat failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('NIM chat returned no content.');
  return content;
}

/** Embeddings via NVIDIA NIM. inputType: 'query' for searches, 'passage' for storage. */
export async function embed(text: string, inputType?: 'query' | 'passage'): Promise<number[]> {
  const key = nimApiKey();
  if (!key) throw new Error('NVIDIA NIM API key not configured.');
  const body: Record<string, unknown> = { input: text, model: nimEmbedModel() };
  if (inputType) body.input_type = inputType;
  const res = await fetch(`${NIM_BASE}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`NIM embeddings failed (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const emb = data.data?.[0]?.embedding;
  if (!emb) throw new Error('NIM embeddings returned no embedding.');
  return emb;
}

/** List available NIM models (for the Settings model picker). */
export async function listModels(): Promise<string[]> {
  const key = nimApiKey();
  if (!key) throw new Error('NVIDIA NIM API key not configured.');
  const res = await fetch(`${NIM_BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`NIM list models failed (${res.status})`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).sort();
}

/** Extract the first JSON object from an LLM reply (tolerant of prose around it). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Chat that routes to the deterministic mock in dry_run mode. */
export async function chatAuto(messages: ChatMessage[]): Promise<string> {
  if (mode() === 'dry_run') return mockChat(messages);
  return chat(messages);
}

/** Embedding that routes to the deterministic mock in dry_run mode. */
export async function embedAuto(text: string, inputType: 'query' | 'passage' = 'passage'): Promise<number[]> {
  if (mode() === 'dry_run') return mockEmbed(text);
  try {
    return await embed(text, inputType);
  } catch {
    // Some NIM embedding models reject input_type — retry without it.
    return await embed(text);
  }
}
