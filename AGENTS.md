# AGENTS.md — IT Ops Command Center

> Tool-agnostic repository entry point for any AI agent discovering this workspace. All agents must adhere to the governance below.

## 1. Project

**IT Ops Command Center** — a web-based, Telegram-triggerable AI assistant for an IT Operations Support Specialist. User requests become **missions** that run through a five-phase pipeline operated by a Team Leader and specialized worker agents. Every agent always documents while working; the Team Leader reviews that documentation and approves or disapproves before actual execution proceeds; completed missions store learned patterns back into the Knowledge Library.

## 2. Layer model

1. **Core governance** — this file and `.agents/rules.md`. Universal, project-wide rules.
2. **Project context** — `PLAN.md`. Product definition, architecture, data model, build order.
3. **Capability skills** — `.agents/skills/<skill-name>/SKILL.md`. One skill per agent.
4. **Runtime** — `server/` (backend, orchestrator, knowledge store, Telegram) and `web/` (Apple-design UI). Runtime code implements the pipeline defined by layers 1–3.

## 3. Source of truth hierarchy

When guidance conflicts, resolve in this order:

1. **Runtime safety overrides** — hard constraints passed by the execution platform.
2. **Core governance** — this file, `.agents/rules.md`.
3. **Project context** — `PLAN.md`.
4. **Skill instructions** — `.agents/skills/<skill-name>/SKILL.md`.
5. **Shared conventions** — writing style, naming, code conventions.

## 4. The Mission Pipeline (all agents)

Every mission runs: **1 Plan → 2 Breakdown & Assign → 3 Execute (with docs) → 4 Review & Gate → 5 Complete & Learn.** See `.agents/rules.md` §2 for the binding rules and `PLAN.md` §3 for phase details.

## 5. Non-negotiable invariants

1. **Plan before doing.** No sub-task starts without a plan (Phase 1) — never improvise an unanalyzed request.
2. **Document always.** Every agent appends to its mission documentation as it works — actions, decisions, artifacts, confidence. Never written after-the-fact.
3. **Review gate.** Only approved deliverables proceed. Disapproved deliverables return to the responsible agent with feedback. The user may override any verdict.
4. **Knowledge protocol.** Check the Knowledge Library before working (cite matches); hand trajectories for distillation after completing.
5. **Safety.** No destructive or irreversible action without explicit user confirmation. Credentials/keys are runtime-only, never hard-coded, never committed, never stored in documentation.
6. **Least privilege.** Generated access artifacts must request the minimum access needed for the stated task, nothing more.

## 6. Skills (agent roster)

| Skill | Agent | Covers |
|---|---|---|
| `.agents/skills/team-leader/SKILL.md` | Team Leader (Mission Control) | planning, breakdown, assignment, review/approve, knowledge handoff |
| `.agents/skills/access-management-agent/SKILL.md` | Access Management | user access creation, modification, monitoring |
| `.agents/skills/ticketing-agent/SKILL.md` | Ticketing | ticket triage, creation, updates, escalation, resolution |
| `.agents/skills/email-comms-agent/SKILL.md` | Email & Comms | email drafting, inbox triage, customer support replies |
| `.agents/skills/dev-automation-agent/SKILL.md` | Dev & Automation | development, updates, automation scripts and workflows |
| `.agents/skills/data-reporting-agent/SKILL.md` | Data & Reporting | data uploads, documentation, Power BI reports/dashboards |
| `.agents/skills/system-maintenance-agent/SKILL.md` | System Maintenance | maintenance, updates/patching, health checks, monitoring |
| `.agents/skills/knowledge-librarian/SKILL.md` | Knowledge Librarian | pattern distillation, semantic retrieval, new task-type recording |

## 7. Agent creation standard

New agents (created by the Team Leader for new task types) must follow the agent-spec standard:

1. Directory: `.agents/skills/<skill-name>/` — entry file `SKILL.md` (uppercase).
2. YAML frontmatter with `name:` and `description:`; `name:` must match the directory name.
3. `# [Skill Name]` followed immediately by `## Role / Authority`.
4. Must define: capabilities, when invoked, how to work, artifacts produced, documentation duty (always), knowledge protocol, and safety boundaries.

## 8. Boundaries

- This repository's agents operate through the mission pipeline defined here; runtime code in `server/` and `web/` is the only place pipeline mechanics are implemented.
- Skill files in `.agents/skills/` are behavioral definitions — keep them free of runtime implementation details.
- Do not modify skill files without updating the corresponding agent in the runtime registry.
