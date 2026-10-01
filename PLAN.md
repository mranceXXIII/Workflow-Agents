# IT Ops Command Center — Build Plan

> An AI Assistant for an IT Operations Support Specialist. Web-based and Telegram-triggerable. Multi-agent system with a planning-first Team Leader, mandatory agent documentation, leader review with approve/disapprove gates, and a self-growing Knowledge Library that future-proofs task handling.

- **Date:** 2026-10-01
- **Status:** Approved plan — ready for implementation
- **Project home:** `E:\sideQuest\AI Assistant Workflow`

---

## 1. Vision

You are an IT Operations Support Specialist. Your daily work spans user access management, ticketing, email handling, development, updates, system maintenance, data uploads, automation, customer support, and documentation (including Power BI dashboards and reports).

This project builds a single AI control center that:

1. **Handles every task at the click of a button** — a Task Grid with your task domains, or just type what you want done in chat or Telegram and the team does it.
2. **Stores the patterns of your tasks** — a Knowledge Library that remembers how you work, so it understands requests and resolves them from accumulated knowledge.
3. **Records and documents changes and new tasks** — new task types are captured as they appear, so the system stays future-proof: a task it has never seen is handled from the closest stored knowledge, then the new pattern is stored for next time.
4. **Plans before doing** — every request goes through analysis and a documented plan first, checked against the stored knowledge.
5. **Reviews before executing** — the Team Leader reads each agent's documentation and approves or disapproves before any actual work proceeds.

---

## 2. Source resources (workspace mapping)

The design is grounded in three resources that already exist in `E:\sideQuest`:

| Resource | Location | How it is used |
|---|---|---|
| **agent-spec** (Linux Foundation agentic-AI standard) | `E:\sideQuest\agent-spec` | Governance skeleton: `.agents/skills/<skill-name>/SKILL.md` format (YAML frontmatter with `name:`/`description:`, `Role / Authority` header), source-of-truth hierarchy, compliance-checker behavior for auditing documentation |
| **ruflo agent skills** | `E:\sideQuest\ruflo\.agents\skills` | Behavioral patterns for the team leader and agents: `agent-hierarchical-coordinator` (queen-led task decomposition + capability-based assignment), `agent-goal-planner` (GOAP: state assessment → plan → execute → replan), `agent-adaptive-coordinator` (pattern recognition, adaptive routing), `memory-management` + `reasoningbank-agentdb` (pattern store / semantic search / trajectory tracking / verdict judgment), `hive-mind` (approval consensus) |
| **apple-design SKILL.md** | `E:\sideQuest\skills\skills\apple-design\SKILL.md` | The entire UI: translucent materials (`backdrop-filter`), critically damped springs, instant `:active` feedback, SF system font with size-specific tracking, reduced-motion / reduced-transparency support, the eight design principles |

## 3. The Mission Pipeline (five phases)

Every request — from a Task Grid click, a chat message, or a Telegram command — becomes a **Mission** that runs through the same pipeline:

```
┌──────────────────────────────────────────────────────────────┐
│ 1. PLAN        Team Leader analyzes the request, searches    │
│                the Knowledge Library for stored task         │
│                patterns, writes a plan document              │
│                     ↓                                        │
│ 2. BREAKDOWN   Team Leader decomposes the plan into          │
│    & ASSIGN    sub-tasks, creates/spawns agents matched      │
│                by skill (capability scoring: skill fit →     │
│                performance history → workload)               │
│                     ↓                                        │
│ 3. EXECUTE     Each agent performs its assignment WITH       │
│    (w/ DOCS)   mandatory documentation written as it works:  │
│                actions, decisions, artifacts, confidence     │
│                     ↓                                        │
│ 4. REVIEW      Team Leader reads each agent's documentation, │
│    & GATE      checks it against the Knowledge Library,      │
│                APPROVES or DISAPPROVES each deliverable.     │
│                Disapproved → agent revises. The user may     │
│                also override any verdict.                    │
│                     ↓                                        │
│ 5. COMPLETE    Approved work produces ready-to-run           │
│    & LEARN     artifacts. Outcomes, new patterns, and new    │
│                task types are stored back into the           │
│                Knowledge Library (future-proofing).          │
└──────────────────────────────────────────────────────────────┘
```

### Phase details

**Phase 1 — Plan.** GOAP-style state assessment: what is true now, what should be true, the gap between them. The Team Leader performs semantic search over the Knowledge Library (embedding similarity) and cites which stored patterns the plan builds on. The plan is a structured Markdown document with: goal, analysis, knowledge matches, sub-task breakdown preview, risks, and confidence. Plan status lifecycle: `draft → in_review → approved | revised`.

**Phase 2 — Breakdown & Assignment.** Modeled on the ruflo `hierarchical-coordinator`: the leader filters agents by capability match, scores by performance history, balances current workload, then assigns. Each sub-task gets: title, description, acceptance criteria, assigned agent, dependencies, and status (`pending → in_progress → in_review → approved | rework → done`).

**Phase 3 — Agent execution with mandatory documentation.** Documentation is not optional or after-the-fact: every agent appends to its mission documentation as it works — each action taken, each decision and why, each artifact produced, and a stated confidence level (per agent-spec output policy). This documentation is exactly what the leader reviews in Phase 4.

**Phase 4 — Leader review gate.** Modeled on ruflo `hive-mind` consensus + agent-spec compliance checking: the leader reads each agent's documentation, verifies the output against the Knowledge Library (does it match known-good patterns? does it violate any?), and issues a verdict per deliverable: `approved` or `disapproved` with feedback. Disapproved deliverables return to the responsible agent for revision, then re-review. The user can override any verdict. Only approved deliverables proceed.

**Phase 5 — Complete & learn.** Approved work is executed as artifact generation (see §11 Assumptions). The Knowledge Librarian then distills the mission into reusable patterns (modeled on `reasoningbank-agentdb`): trajectory (steps taken + outcome), the pattern itself, and confidence — so the next similar request starts from this knowledge instead of zero.

## 4. Agent roster

Eight agents, each defined as an agent-spec compliant `SKILL.md` (YAML frontmatter + `Role / Authority` header), stored in `.agents/skills/` and loaded by the backend at startup. New agents can be created by the Team Leader at runtime when a task type doesn't fit any existing agent (recorded as a new task type in the Knowledge Library).

| Agent | Covers | Source pattern |
|---|---|---|
| **Team Leader** (Mission Control) | planning, breakdown, assignment, review/approve | `hierarchical-coordinator` + `goal-planner` (GOAP) |
| **Access Management** | User Access Creation, Modification, Monitoring | capability-based worker |
| **Ticketing** | Ticketing, ticket updates, triage | capability-based worker |
| **Email & Comms** | Email, Email Handling, Customer Support | capability-based worker |
| **Dev & Automation** | Development, Updates, Automation | capability-based worker |
| **Data & Reporting** | Uploading Data, Documentation, Power BI dashboards/reports | capability-based worker |
| **System Maintenance** | System Maintenance, Updates, Monitoring | capability-based worker |
| **Knowledge Librarian** | stores/curates task patterns, records new task types | `memory-management` + `reasoningbank-agentdb` |

Every agent always documents while working (Phase 3 duty). The Team Leader additionally reviews (Phase 4 duty).

---

## 5. System architecture

```
┌───────────────────────────┐        ┌──────────────────────────────┐
│  Web UI (Vite + React)    │  HTTP  │  Backend (Node + Express)    │
│  Apple-design workspace   │◄──────►│  ┌────────────────────────┐  │
│  • Sidebar / Task Grid    │  REST  │  │ Mission Runner         │  │
│  • Chat + Timeline        │  +SSE  │  │ (5-phase pipeline)     │  │
│  • Mission detail panel   │        │  └───────┬────────────────┘  │
│  • Approve / Disapprove   │        │  ┌───────▼────────────────┐  │
└───────────────────────────┘        │  │ NVIDIA NIM adapter     │  │
                                     │  │ (OpenAI-compatible)    │  │
┌───────────────────────────┐        │  └───────┬────────────────┘  │
│  Telegram Bot (grammY)    │◄──────►│  ┌───────▼────────────────┐  │
│  /new /status /approve    │        │  │ Knowledge Store        │  │
└───────────────────────────┘        │  │ embeddings + cosine    │  │
                                     │  └───────┬────────────────┘  │
                                     │  ┌───────▼────────────────┐  │
        integrate.api.nvidia.com     │  │ SQLite (state + docs)  │  │
        ◄────────────────────────────┤  └────────────────────────┘  │
                                     └──────────────────────────────┘
```

- **Mission Runner** orchestrates the five phases, calls the LLM through the NIM adapter, persists every artifact, and emits events over SSE for live UI updates.
- **NIM adapter** is OpenAI-compatible (`POST https://integrate.api.nvidia.com/v1/chat/completions`, `Authorization: Bearer nvapi-…`), with a configurable model and a **dry-run mock mode** so the whole pipeline is testable without a key.
- **Knowledge Store** stores patterns with NIM embeddings and does cosine-similarity search in-process (no external vector DB server needed).

## 6. Data model (SQLite)

| Table | Columns | Purpose |
|---|---|---|
| `missions` | id, title, request, source (`web`\|`telegram`\|`task_grid`), task_domain, phase, status, created_at, updated_at | One row per mission |
| `plans` | id, mission_id, content_md, knowledge_used (json), confidence, status (`draft`/`in_review`/`approved`/`revised`) | Phase 1 output |
| `subtasks` | id, mission_id, plan_id, title, description, acceptance_criteria, assigned_agent_id, depends_on, status, result_md | Phase 2–4 units of work |
| `agents` | id, slug, name, role, capabilities (json), system_prompt, doc_duty (bool), review_duty (bool), performance (json), created_at | Agent roster; mirrors `.agents/skills/` |
| `documents` | id, mission_id, agent_id, type (`plan`/`agent_doc`/`review`/`artifact`), title, content_md, created_at | Everything the agents document |
| `reviews` | id, mission_id, subtask_id, reviewer, verdict (`approved`/`disapproved`), feedback, overridden_by_user (bool), created_at | Phase 4 gate record |
| `knowledge` | id, title, content_md, domain, tags (json), embedding (json), source_mission_id, usage_count, success_count, confidence, created_at, last_used | The Knowledge Library |
| `settings` | key, value | NIM API key, model, Telegram token, mode (`live`\|`dry_run`) |
| `events` | id, mission_id, kind, summary, payload (json), created_at | Mission timeline (drives the UI) |

---

## 7. Knowledge Library design

Modeled on ruflo `memory-management` + `reasoningbank-agentdb`:

- **Store patterns** — after every completed mission, the Knowledge Librarian distills: trajectory (steps + outcome), the reusable pattern, and a confidence score. Successful missions raise confidence; failed ones are recorded with the lesson learned.
- **Semantic retrieval** — every new request is embedded (NIM embeddings API) and matched against stored knowledge via cosine similarity; top matches are injected into the Team Leader's planning context with citations.
- **Hierarchical knowledge** — three abstraction levels: concrete (a specific case), pattern (a category of cases), principle (a general rule).
- **New-task recording** — when a request matches no stored pattern above a similarity threshold, it is recorded as a **new task type**; the Team Leader may spawn a new specialized agent for it. Next time, it matches.
- **Curation** — usage/success counters, confidence distribution, export/backup to JSON, consolidation of near-duplicate patterns.
- **Seed data** — starter IT-ops playbooks ship on day one: access-creation SOP, access-modification SOP, ticketing SOP, email templates, customer-support response patterns, Power BI report checklist, system maintenance checklists, data-upload runbook.

## 8. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React + TypeScript + Tailwind CSS + Motion** | Apple-design compliant; Motion for spring transitions |
| Backend | **Node.js v24 + Express + TypeScript** | REST + SSE; runs on your PC |
| Persistence | **SQLite** (better-sqlite3) | Zero-config, single file, easy backup |
| LLM | **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`) | OpenAI-compatible chat completions; models: Nemotron / Llama 3.x; key from build.nvidia.com |
| Embeddings | **NVIDIA NIM embeddings API** | e.g. `nvidia/nv-embedqa-e5-v5`; cosine similarity in-process |
| Telegram | **grammY** | Long-polling (no public URL/webhook needed); token from @BotFather |
| Runtime mode | `live` / `dry_run` | Dry-run uses a deterministic mock LLM so the full pipeline is testable without any key |

---

## 9. Web UI — Claude Cowork / AI Studio-style layout, Apple Design compliant

### Layout (three columns)

- **Left sidebar (translucent):** Missions list with live phase chips, one-click **Task Grid** (your 10 task domains), Knowledge Library, Agents roster, Settings.
- **Center (chat + timeline):** conversation with the Team Leader; every pipeline step appears as a timeline entry (plan written, sub-task assigned, agent documented, verdict issued, artifact ready).
- **Right panel (collapsible):** mission detail — plan document, agent assignments, **agent documentation tabs**, Approve/Disapprove review bar, knowledge matches used.

### Apple Design compliance (from `apple-design/SKILL.md`)

- **Response:** feedback on pointer-down (`:active` scale 0.97, 100ms ease-out), never only after release; no artificial latency on the input path.
- **Interruptibility:** springs animate from the live presentation value; transitions never lock out input.
- **Springs:** critically damped (`bounce: 0`, `duration: 0.3–0.4s`) by default; slight bounce only for momentum-driven gestures (flicked cards, sheet dismissals).
- **Materials & depth:** sidebar/toolbars as translucent layers (`backdrop-filter: blur(20px) saturate(180%)`) with content scrolling underneath; heavier materials for structural regions, lighter for interactive elements; dim-to-focus for the review modal, offset-without-scrim for the parallel detail panel.
- **Spatial consistency:** enter/exit along the same path; sheets/popovers anchored to their trigger (`transform-origin`).
- **Typography:** SF system font stack (`system-ui`), tight leading + negative tracking on display text, near-0 tracking on body, spacing in `rem` so layout scales with text size.
- **Reduced motion & transparency:** `prefers-reduced-motion` → cross-fades instead of springs; `prefers-reduced-transparency` → frostier/solid surfaces; `prefers-contrast: more` → defined borders.
- **Foundations:** purpose (decide what not to build), agency (user override on every verdict, undo where possible), responsibility (approvals before irreversible work), familiarity (consistent close placement), flexibility, simplicity-not-minimalism, craft, delight.
- **Feedback taxonomy:** status, completion, warning, error — exposed as phase chips and inline validation, not submit-time surprises.

## 10. Telegram bot interface

The same mission pipeline, triggered and controlled from your phone:

| Command | Does |
|---|---|
| `/start` | Welcome + quick help |
| `/new <request>` | Starts a mission ("`/new create mailbox for jdoe with access to Finance shared drive`") |
| `/status` | Current mission phase, sub-task states, pending reviews |
| `/tasks` | Lists sub-tasks for the active mission with assigned agents |
| `/approve <id>` | Approves the pending review (same gate as the web UI) |
| `/disapprove <id> <feedback>` | Sends it back for revision with your feedback |
| `/knowledge <query>` | Searches the Knowledge Library |

Long-polling via grammY — no public URL, webhook, or port-forwarding needed. The bot posts mission updates (plan written, verdicts, artifacts ready) back to the chat as they happen.

---

## 11. Project structure

```
AI Assistant Workflow/
├── PLAN.md                        # this document
├── README.md                      # run instructions
├── AGENTS.md                      # agent-spec entry point (governance hierarchy)
├── .agents/
│   ├── rules.md                   # universal agent rules (agent-spec style)
│   └── skills/
│       ├── team-leader/SKILL.md
│       ├── access-management-agent/SKILL.md
│       ├── ticketing-agent/SKILL.md
│       ├── email-comms-agent/SKILL.md
│       ├── dev-automation-agent/SKILL.md
│       ├── data-reporting-agent/SKILL.md
│       ├── system-maintenance-agent/SKILL.md
│       └── knowledge-librarian/SKILL.md
├── server/
│   ├── package.json
│   └── src/
│       ├── index.ts               # Express app, REST routes, SSE endpoint
│       ├── db.ts                  # SQLite schema + migrations
│       ├── llm/
│       │   ├── nim.ts             # NVIDIA NIM OpenAI-compatible adapter
│       │   └── mock.ts            # deterministic dry-run adapter
│       ├── orchestrator/
│       │   ├── mission-runner.ts  # 5-phase pipeline engine
│       │   ├── planner.ts         # Phase 1 (GOAP-style + knowledge retrieval)
│       │   ├── dispatcher.ts      # Phase 2 (capability-based assignment)
│       │   └── reviewer.ts        # Phase 4 (docs review + verdicts)
│       ├── agents/
│       │   ├── registry.ts        # loads .agents/skills/ + DB agents
│       │   └── factory.ts         # runtime agent creation
│       ├── knowledge/
│       │   └── store.ts           # embeddings, cosine search, distillation
│       ├── artifacts/
│       │   └── writer.ts          # writes approved artifacts to disk
│       ├── telegram/
│       │   └── bot.ts             # grammY long-polling bot
│       └── seed/
│           └── playbooks.ts       # day-one Knowledge Library seed
└── web/
    ├── package.json
    └── src/
        ├── App.tsx                # three-column layout
        ├── styles/                # Apple-design tokens, materials, reduced-motion
        ├── components/
        │   ├── Sidebar.tsx        # missions, task grid, nav
        │   ├── ChatPanel.tsx      # conversation + timeline
        │   ├── MissionPanel.tsx   # plan, agents, docs tabs, knowledge matches
        │   ├── ReviewBar.tsx      # Approve / Disapprove
        │   ├── DocViewer.tsx      # rendered Markdown documents
        │   ├── KnowledgePanel.tsx
        │   ├── AgentsPanel.tsx
        │   └── SettingsSheet.tsx  # NIM key, model picker, Telegram token, test
        └── lib/
            └── api.ts             # REST + SSE client
```

## 12. Build order (after plan approval)

1. **Governance scaffold** — `AGENTS.md` + `.agents/rules.md` + 8 agent `SKILL.md` files (agent-spec compliant: YAML frontmatter matching directory names, `Role / Authority` headers).
2. **Backend core** — SQLite schema, NIM adapter (+ mock mode), agent registry, knowledge store (embeddings + cosine search), Mission Runner with the 5-phase pipeline, REST API + SSE.
3. **Telegram bot** — grammY long-polling, mission trigger + status + approve/disapprove mirroring.
4. **Frontend** — Apple-design chat workspace: Sidebar with Task Grid, ChatPanel + timeline, MissionPanel with documentation tabs and Approve/Disapprove ReviewBar, KnowledgePanel, SettingsSheet (NIM API key, model picker, Telegram token, connection test).
5. **Knowledge seed** — starter IT-ops playbooks so day-one requests already match stored patterns.
6. **Validation** — build + run both apps; exercise a mission end-to-end (dry-run mode if no key configured yet); verify the review gate blocks unapproved work; verify knowledge is stored and retrieved on the next mission.

## 13. Validation plan

| Check | How |
|---|---|
| Backend boots, DB schema created | `npm.cmd run dev` in `server/`, hit `GET /api/health` |
| Pipeline runs without a key | Dry-run mode: start a mission, verify all 5 phases complete and produce documents |
| Review gate works | Disapprove a sub-task → verify it returns to the agent for revision; approve → verify artifact is written |
| Knowledge loop works | Complete a mission → verify pattern stored; start a similar mission → verify the plan cites the stored pattern |
| NIM live mode | Paste key in Settings → connection test → run one real mission |
| Telegram | Paste token → `/new` a mission from the phone → verify the pipeline runs and updates return to chat |
| Web build passes | `npm.cmd run build` in `web/` |
| Apple-design compliance | Review against the skill: instant press feedback, springs, translucent materials, reduced-motion fallbacks, type scale |

## 14. Assumptions & limitations (explicit)

- **Execution safety model (human-in-the-loop):** per the approval-gate requirement, approved tasks produce **ready-to-run artifacts** — PowerShell scripts, email drafts, runbooks, Power BI setup guides, documentation — that you review and execute. **Live connectors** (Microsoft Graph, SMTP/Exchange, Power BI REST API) are a deliberate Phase 2 (§17): wiring admin credentials into an app is a high-blast-radius change that deserves its own planning and review cycle.
- **Keys are runtime-only:** the NVIDIA API key and Telegram token are entered in the Settings screen and stored locally in SQLite — never hard-coded, never committed.
- **Local-first:** everything runs on your PC; SQLite is a single file you can back up. No cloud dependency except the NIM API calls.
- **Windows note:** `npm.ps1` is blocked by your execution policy, so npm is invoked as `npm.cmd` in shell commands.
- **LLM behavior depends on the chosen NIM model** — planning/review quality varies by model; the model picker in Settings lets you trade cost vs. quality per need.
- **Power BI output in Phase 1 is guidance + artifact generation** (report specs, DAX measures, setup checklists,.pbip project scaffolding guidance), not direct report publishing.

## 15. Governance (agent-spec compliance)

- `AGENTS.md` at the project root is the canonical entry point; all agent skills live at `.agents/skills/<skill-name>/SKILL.md` with exact `name:`/`description:` frontmatter and `Role / Authority` headers.
- Source-of-truth hierarchy is respected: runtime safety → core governance → project context (this PLAN.md) → skill instructions → shared conventions.
- Every agent skill defines its **documentation duty** (always document while working) and, for the leader, its **review duty** (approve/disapprove before proceeding).
- Documentation produced by agents is auditable: structured Markdown persisted in the `documents` table, reviewable in the UI and from Telegram.

## 16. What you'll need to provide

| Item | Where | When |
|---|---|---|
| NVIDIA API key (`nvapi-…`) | build.nvidia.com → "Get API Key" | Settings screen, at runtime |
| Telegram bot token | @BotFather in Telegram → `/newbot` | Settings screen, at runtime (optional — web UI works without it) |
| Model choice | Settings model picker (fetches the NIM catalog) | Any time |

## 17. Future roadmap

1. **Phase 2 — live connectors** (each behind its own plan → review → approve cycle):
   - Microsoft Graph: user creation/modification/licensing, mailbox operations
   - SMTP/Exchange: direct email sending
   - Power BI REST API: dataset refresh, report publishing
   - Ticketing system API (e.g. ServiceNow/Jira/Freshdesk): ticket create/update
2. **Scheduled missions** — recurring maintenance and monitoring runs (cron-like) with the same review gate.
3. **File uploads** — drag-and-drop data upload workflows feeding the Data & Reporting agent.
4. **Multi-user** — roles beyond the single specialist if the tool spreads to the team.

---

*This plan documents what will be built, in what order, and why. Build order begins at §12 once implementation starts.*








