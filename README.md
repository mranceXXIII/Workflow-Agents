# IT Ops Command Center

An AI assistant for an IT Operations Support Specialist. You ask — in the web UI or via Telegram — and your request becomes a **mission**: the Team Leader plans it, breaks it down, assigns specialized agents by skill, every agent documents as it works, the leader approves or disapproves each deliverable, and what the team learns is stored into a Knowledge Library so the next similar request starts from accumulated knowledge instead of zero.

## The mission pipeline

```
1 PLAN        Team Leader analyzes the request, searches the Knowledge
              Library, writes a plan document
2 BREAKDOWN   Sub-tasks assigned to agents by capability fit
3 EXECUTE     Agents work — and document every action as they go
4 REVIEW      Leader reads the documentation, approves/disapproves;
              user may override any verdict
5 COMPLETE    Approved artifacts written; patterns stored in the
              Knowledge Library
```

## Build status

| Step | What | Status |
|---|---|---|
| 1 | Governance scaffold: `AGENTS.md`, `.agents/rules.md`, 8 agent `SKILL.md` files | Done |
| 2 | Backend core: SQLite, NVIDIA NIM adapter (+ dry-run mock), agent registry, Knowledge Store, Mission Runner, REST + SSE | Done |
| 3 | Telegram bot (zero-dependency long-polling, wired to the mission pipeline) | Done |
| 4 | Web UI (Vite + React, Apple-design) | Planned |
| 5 | Knowledge Library seed playbooks | Planned |
| 6 | End-to-end validation | Ongoing |

## How to use

### Prerequisites

- **Node.js 24+** — the backend uses Node's built-in `node:sqlite` module, so no database installation is needed.
- **NVIDIA API key** (`nvapi-…` from [build.nvidia.com](https://build.nvidia.com)) — only for **live mode**. **Dry-run mode works with no key at all**: a deterministic mock LLM drives the full pipeline so you can test everything first.
- *(Later)* a Telegram bot token from @BotFather.

### Run the backend

```powershell
cd "E:\sideQuest\AI Assistant Workflow\server"
npm.cmd install        # first time only
npm.cmd run dev        # starts on http://localhost:8787
```

> **Windows note:** `npm` (`npm.ps1`) is blocked by your execution policy — always use `npm.cmd`.

### Run the smoke test (validates the whole pipeline without a key)

```powershell
cd "E:\sideQuest\AI Assistant Workflow\server"
npm.cmd run smoke
```

This runs two missions in-process (in a temp database): the second mission should cite the pattern the first one stored — that is the knowledge loop working end-to-end.

### Configure live mode (NVIDIA NIM)

```powershell
# set the key + model (stored locally in the SQLite settings table, never committed).
# mode switches to "live" automatically once a key is set — dry-run needs no key.
curl.exe -X PUT http://localhost:8787/api/settings -H "Content-Type: application/json" -d "{\"nim_api_key\":\"nvapi-YOUR-KEY\",\"nim_model\":\"meta/llama-3.3-70b-instruct\"}"

# test the connection (verifies the key and lists available models)
curl.exe -X POST http://localhost:8787/api/settings/test
```

### Configure the Telegram bot

```powershell
# paste the token from @BotFather — the bot starts long-polling immediately (no restart)
curl.exe -X PUT http://localhost:8787/api/settings -H "Content-Type: application/json" -d "{\"telegram_bot_token\":\"123456:ABC-YOUR-TOKEN\"}"
```

Then in Telegram: `/start` for help, or just type what you want done — it starts a mission and pushes pipeline updates back to the chat.

### Start a mission

```powershell
curl.exe -X POST http://localhost:8787/api/missions -H "Content-Type: application/json" -d "{\"request\":\"create a mailbox for jdoe with access to the Finance shared drive\",\"source\":\"web\"}"
```

The mission runs asynchronously through all five phases. Watch it live over **SSE** at `http://localhost:8787/api/events/stream`, or poll `GET /api/missions/:id`.

### Follow a mission live (SSE)

`GET /api/missions/:id/events` is an SSE stream of every pipeline event — phases, assignments, verdicts, knowledge stored. The web UI (next build step) consumes this.

### API reference

| Method & path | Does |
|---|---|
| `GET /api/health` | Mode, model, DB path, agent count |
| `GET /api/settings` | Settings (keys masked) + knowledge stats |
| `PUT /api/settings` | Save `nim_api_key`, `nim_model`, `nim_embed_model`, `telegram_bot_token`, `knowledge_similarity_threshold` |
| `POST /api/settings/test` | Verifies NIM connectivity, lists available models |
| `GET /api/agents` | Agent roster with capabilities + performance |
| `POST /api/agents` | Create a new specialized agent (writes its SKILL.md) |
| `GET /api/missions` | List missions |
| `POST /api/missions` | Start a mission: `{"request": "...", "source": "web"}` |
| `GET /api/missions/:id` | Full detail: plan, subtasks, documents, reviews, events, knowledge |
| `GET /api/missions/:id/events` | SSE live updates for that mission |
| `POST /api/missions/:id/plan/approve` | User override: approve the plan |
| `POST /api/missions/:id/plan/revise` | User override: `{"feedback": "..."}` → replan |
| `POST /api/missions/:id/subtasks/:sid/approve` | User override: approve a subtask |
| `POST /api/missions/:id/subtasks/:sid/disapprove` | User override: `{"feedback": "..."}` → rework with your feedback |
| `GET /api/knowledge` | Knowledge Library + stats |
| `POST /api/knowledge/search` | Semantic search: `{"query": "...", "limit": 5}` |
| `POST /api/knowledge` | Add a pattern manually |
| `DELETE /api/knowledge/:id` | Delete a pattern (explicit user action) |
| `POST /api/knowledge/reembed` | Re-embed all patterns (after changing the embedding model) |
| `POST /api/knowledge/consolidate` | Merge near-duplicate patterns |
| `POST /api/knowledge/seed` | Re-seed the starter playbooks (seeded idempotently at boot) |

### The review gate in practice

- Missions run automatically: Plan → Breakdown → Execute (agents document as they work) → Review.
- In dry-run the mock always approves; in live mode the Team Leader model issues real verdicts.
- A subtask that fails review is automatically reworked once with the feedback; if it fails again, the mission **blocks** and waits for you.
- You can override any verdict — approve it, or disapprove it with feedback (the agent revises with your feedback). This works from the API above or from Telegram.

## How this setup was created

1. **Plan first** — the system was planned before building (`PLAN.md`): vision, pipeline, data model, tech stack, build order. Grounded in three sources from your workspace:
   - **agent-spec** (`E:\sideQuest\agent-spec`) — the governance skeleton: `.agents/skills/<name>/SKILL.md` format, `Role / Authority` headers, source-of-truth hierarchy.
   - **ruflo skills** (`E:\sideQuest\ruflo\.agents\skills`) — the behavioral patterns: hierarchical-coordinator (capability-scored delegation), goal-planner (GOAP planning), memory-management + reasoningbank (pattern storage, semantic retrieval, trajectory distillation).
   - **apple-design** (`E:\sideQuest\skills\skills\apple-design\SKILL.md`) — the UI standard for the web app (next build step).
2. **Governance scaffold** — `AGENTS.md`, `.agents/rules.md`, and 8 agent `SKILL.md` files, each agent-spec compliant (validated: frontmatter `name:` matches its directory, `Role / Authority` header present, documentation duty defined).
3. **Backend core** — Node 24 + Express + TypeScript; SQLite via Node's built-in `node:sqlite` (no native module build needed); NVIDIA NIM adapter (OpenAI-compatible) with a deterministic **dry-run mock** so the full pipeline runs with no API key; agent registry that loads `.agents/skills/` into the DB; Knowledge Store (embeddings + cosine similarity); the 5-phase mission runner with review gate and user overrides; REST API + SSE.
4. **Telegram bot** — zero-dependency long-polling client (built-in `fetch`), wired to the same mission pipeline and review gate.
5. **Knowledge seed** — starter IT-ops playbooks (access SOPs, ticketing, email templates, Power BI checklist, maintenance checklists), seeded idempotently at boot so day-one requests already match stored patterns.

### Where things live

| Path | What |
|---|---|
| `PLAN.md` | The approved build plan |
| `AGENTS.md` + `.agents/` | Governance + 8 agent skill definitions (the agents' system prompts) |
| `server/src/` | Backend: `db`, `llm` (NIM + mock), `orchestrator` (planner, dispatcher, reviewer, mission-runner), `agents` (registry, factory), `knowledge` store, `artifacts` writer, `telegram` bot |
| `server/data/app.db` | SQLite: missions, plans, subtasks, agents, documents, reviews, knowledge, settings, events |
| `server/artifacts/mission-N/` | Approved artifacts written to disk per mission |
| `web/` | The Apple-design UI (next build step) |

## Data & storage

- Everything is local: SQLite at `server/data/app.db` (override with the `COMMAND_CENTER_DB` env var). Backup = copy the file.
- Settings (including the NIM key and Telegram token) are stored **only** in the local database — never hard-coded, never committed (`server/.gitignore` excludes `data/`).

## Safety model

- **Human-in-the-loop:** approved work produces ready-to-run artifacts (PowerShell scripts, email drafts, runbooks, report specs) — you review and execute. Live connectors (Microsoft Graph, SMTP, Power BI API) are a deliberate later phase.
- **Least privilege** in generated access artifacts; **no credentials** in any artifact or documentation.
- **Review gate:** nothing proceeds without approval (Team Leader verdict, or your override).

## Troubleshooting

- **`npm` blocked** ("npm.ps1 cannot be loaded"): use `npm.cmd`; if the wrapper misbehaves, call npm directly: `node G:\node_modules\npm\bin\npm-cli.js <command>`.
- **Port in use:** set `PORT` before starting (`$env:PORT=8788`).
- **Dry-run vs live:** `GET /api/health` shows the mode. Dry-run needs no key; set `nim_api_key` in Settings to go live.
- **Re-running the smoke test:** `node_modules\.bin\tsx.cmd scripts\smoke.ts` — uses a temp database, never touches your real data.



