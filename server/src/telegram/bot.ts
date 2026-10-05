import { getSetting, setSetting, db, one, many } from '../db.js';
import { startMission, missionEvents, approvePlan, approveSubtask, disapproveSubtask } from '../orchestrator/mission-runner.js';
import { searchKnowledge } from '../knowledge/store.js';

/**
 * Telegram bot — zero-dependency long-polling client for the Telegram Bot API
 * (no webhook, public URL, or port-forwarding needed). The same mission pipeline
 * as the web UI: trigger missions, follow them, and work the review gate.
 */

const HELP = [
  'IT Ops Command Center bot',
  '',
  '/new <request>   Start a mission (e.g. "create a mailbox for jdoe")',
  '/status          Current mission phase, subtasks, blocked reason',
  '/tasks           Alias of /status',
  '/approve         Approve the pending plan (user override)',
  '/approve <id>    Approve a subtask (user override)',
  '/disapprove <id> <feedback>   Send a subtask back for revision',
  '/knowledge <query>   Search the Knowledge Library',
  '',
  'Or just type what you want done — it starts a mission.'
].join('\n');

const API = (token: string, method: string): string => `https://api.telegram.org/bot${token}/${method}`;

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

async function callApi(token: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(API(token, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

let polling = false;
let offset = 0;

export function telegramConfigured(): boolean {
  return Boolean(getSetting('telegram_bot_token'));
}

/** Start long-polling (no-op when no token is configured or already running). */
export function startTelegramBot(): void {
  const token = getSetting('telegram_bot_token');
  if (!token || polling) return;
  polling = true;
  console.log('Telegram bot polling started');
  void pollLoop(token);
}

export function stopTelegramBot(): void {
  polling = false;
}

async function pollLoop(token: string): Promise<void> {
  while (polling) {
    try {
      const updates = (await callApi(token, 'getUpdates', { offset, timeout: 25 })) as TgUpdate[];
      for (const u of updates ?? []) {
        offset = Math.max(offset, u.update_id + 1);
        if (u.message?.text) await handleCommand(token, u.message.chat.id, u.message.text.trim());
      }
    } catch (err) {
      if (!polling) return;
      console.error('Telegram poll error:', err instanceof Error ? err.message : String(err));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Forward this mission's pipeline events to the chat that started it. */
function forwardEvents(token: string, chatId: number, missionId: number): void {
  missionEvents(missionId, (evt) => {
    void callApi(token, 'sendMessage', { chat_id: chatId, text: evt.summary }).catch(() => {});
  });
}

function latestMission(): { id: number; title: string; phase: string; status: string; error: string } | undefined {
  return one(
    db.prepare('SELECT id, title, phase, status, error FROM missions ORDER BY id DESC').get()
  );
}

async function handleCommand(token: string, chatId: number, text: string): Promise<void> {
  const reply = (t: string): Promise<void> =>
    callApi(token, 'sendMessage', { chat_id: chatId, text: t }).then(() => undefined).catch(() => undefined);

  const space = text.indexOf(' ');
  const cmd = (space === -1 ? text : text.slice(0, space)).toLowerCase().replace(/@.*$/, '');
  const args = space === -1 ? '' : text.slice(space + 1).trim();

  try {
    switch (cmd) {
      case '/start':
        await reply(HELP);
        return;
      case '/new': {
        if (!args) {
          await reply('Usage: /new <what you want done>');
          return;
        }
        setSetting('telegram_chat_id', String(chatId));
        const id = startMission(args, 'telegram', '');
        forwardEvents(token, chatId, id);
        await reply(`Mission #${id} started — planning now.\nUse /status to follow it.`);
        return;
      }
      case '/tasks':
      case '/status': {
        const m = latestMission();
        if (!m) {
          await reply('No missions yet. Start one with /new <request>.');
          return;
        }
        const subs = many<{ id: number; title: string; status: string; agent_slug: string | null }>(
          db
            .prepare(
              'SELECT s.id, s.title, s.status, a.slug AS agent_slug FROM subtasks s LEFT JOIN agents a ON a.id = s.assigned_agent_id WHERE s.mission_id = ? ORDER BY s.id'
            )
            .all(m.id)
        );
        const lines = [
          `Mission #${m.id}: ${m.title}`,
          `Phase: ${m.phase} — Status: ${m.status}${m.error ? ` — ${m.error}` : ''}`,
          '',
          ...subs.map((s) => `#${s.id} [${s.status}] ${s.title} → ${s.agent_slug ?? 'unassigned'}`)
        ];
        await reply(lines.join('\n'));
        return;
      }
      case '/approve': {
        const m = latestMission();
        if (!m) {
          await reply('No missions yet.');
          return;
        }
        if (/^\d+$/.test(args)) {
          approveSubtask(m.id, Number(args));
          await reply(`Subtask #${args} approved (user override) — resuming the mission.`);
        } else {
          approvePlan(m.id);
          await reply(`Plan of mission #${m.id} approved (user override) — resuming.`);
        }
        return;
      }
      case '/disapprove': {
        const m = latestMission();
        if (!m) {
          await reply('No missions yet.');
          return;
        }
        const sp = args.indexOf(' ');
        const sid = sp === -1 ? args : args.slice(0, sp);
        const feedback = sp === -1 ? 'User disapproved — please revise.' : args.slice(sp + 1).trim();
        if (!/^\d+$/.test(sid)) {
          await reply('Usage: /disapprove <subtaskId> <feedback>');
          return;
        }
        await disapproveSubtask(m.id, Number(sid), feedback);
        await reply(`Subtask #${sid} sent back with feedback — the agent is revising.`);
        return;
      }
      case '/knowledge': {
        if (!args) {
          await reply('Usage: /knowledge <query>');
          return;
        }
        const matches = await searchKnowledge(args, 3);
        if (!matches.length) {
          await reply('No stored patterns matched.');
          return;
        }
        await reply(
          matches
            .map((k, i) => `${i + 1}. ${k.title} (score ${k.score.toFixed(2)}):\n${k.content_md.slice(0, 300)}`)
            .join('\n\n')
        );
        return;
      }
      default: {
        // Free text: the user asked for something — start a mission.
        setSetting('telegram_chat_id', String(chatId));
        const id = startMission(text, 'telegram', '');
        forwardEvents(token, chatId, id);
        await reply(`Mission #${id} started from your message — planning now.\nUse /status to follow it.`);
        return;
      }
    }
  } catch (err) {
    await reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

