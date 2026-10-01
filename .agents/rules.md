# Universal Agent Rules (.agents/rules.md)

## Role / Authority

- **Role:** Tool-agnostic rules that bind every agent operating in this workspace.
- **Authority:** Governing layer under `AGENTS.md`; defines the mission pipeline, documentation duty, knowledge protocol, and safety boundaries. Does not define per-agent behavior (that belongs to each skill).

## 1. Governance reference

Any agent reading this workspace must adhere to:

1. `AGENTS.md` at root.
2. This file (`.agents/rules.md`).
3. `PLAN.md` (project context).
4. Its own skill: `.agents/skills/<skill-name>/SKILL.md`.

## 2. The five-phase pipeline (binding)

1. **Plan** — analyze the request, search the Knowledge Library, write a plan document.
2. **Breakdown & Assign** — decompose into sub-tasks with acceptance criteria; assign by capability fit.
3. **Execute (with docs)** — perform the work; document as you go.
4. **Review & Gate** — leader reads the documentation; verdict per deliverable; user may override.
5. **Complete & Learn** — finalize approved artifacts; distill patterns into the Knowledge Library.

Phase order is mandatory. No agent may skip Phase 1 or the Phase 4 gate.

## 3. Documentation duty (always)

While working, every agent appends entries to its mission documentation covering all four:

- **Action** — what was done.
- **Decision** — what was chosen and why (including rejected alternatives when material).
- **Artifact** — what was produced (path or content reference).
- **Confidence** — High / Medium / Low, with what was and wasn't verified.

## 4. Documentation format

Append entries in this structure:

```markdown
### [agent-name] — <step title>
- **Action:** ...
- **Decision:** ...
- **Artifact:** ...
- **Confidence:** High|Medium|Low — <what was verified, what was not>
```

## 5. Confidence levels

- **High** — verified directly (checked against a known-good pattern, tested, or confirmed against source data).
- **Medium** — consistent with stored knowledge but not directly verified in this environment.
- **Low** — assumption or first-of-its-kind; must be stated explicitly and flagged for review.

## 6. Knowledge protocol

1. **Before working:** search the Knowledge Library for matching patterns; cite them in the plan and in documentation.
2. **During work:** if the work deviates from a cited pattern, document why.
3. **After completing:** hand the mission trajectory to the knowledge-librarian for distillation (store pattern, confidence, outcome).

## 7. Safety & boundaries

- No destructive or irreversible action without explicit user confirmation.
- Never request or store credentials in documentation; keys are runtime-only.
- Generated access artifacts follow least privilege.
- Never silently assume a fact that affects security, data loss, or user-facing communication — flag it.
- Unknown task type → record it as new in the Knowledge Library; do not silently improvise beyond the plan.

## 8. Verdict protocol (Team Leader only)

- Verdicts are `approved` or `disapproved` with feedback, per deliverable.
- Check documentation against: (a) completeness of actions/decisions/artifacts/confidence, (b) consistency with cited knowledge patterns, (c) safety boundaries (§7).
- Disapproved → sub-task returns to the responsible agent with specific, actionable feedback.
- The user may override any verdict; overrides are recorded.
