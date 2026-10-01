import { db, one } from '../db.js';
import { addKnowledge } from '../knowledge/store.js';

interface Playbook {
  title: string;
  domain: string;
  content_md: string;
}

/** Day-one Knowledge Library seed — starter IT-ops playbooks. */
export const PLAYBOOKS: Playbook[] = [
  {
    title: 'User Access Creation SOP',
    domain: 'access-creation',
    content_md: [
      '**Trigger:** When you need to create a user account or mailbox.',
      '',
      '**Approach:** 1. Collect the minimum fields: full name, department, job title, manager, requested access groups. 2. Apply the naming convention (firstname.lastname). 3. Verify the account does not already exist (idempotency guard). 4. Create the account with least-privilege access: only the groups the role needs. 5. Verify creation and document before/after state. 6. Attach a rollback note (disable + remove groups).',
      '',
      '**Gotchas:** Never invent identity data — missing fields go back to the requester. Shared-drive access often needs both the security group and the resource permission.'
    ].join('\n')
  },
  {
    title: 'Access Modification SOP',
    domain: 'access-modification',
    content_md: [
      '**Trigger:** When you need to change an existing user\'s access (groups, permissions, licensing).',
      '',
      '**Approach:** 1. Establish current state first: list the user\'s current groups/licenses/permissions. 2. Diff against the requested state. 3. Apply the least-privilege check: minimum access for the stated need, nothing more. 4. Produce the change artifact with before/after state. 5. Attach a rollback note (restore previous state).',
      '',
      '**Gotchas:** Never modify access without discovery first. License changes can take time to propagate — note this in the update.'
    ].join('\n')
  },
  {
    title: 'Access Review & Stale Account Check',
    domain: 'access-monitoring',
    content_md: [
      '**Trigger:** When you need to audit who has access to what, or find stale accounts.',
      '',
      '**Approach:** 1. Export current access: users, groups, resource permissions. 2. Flag anomalies: accounts disabled but still in groups, users with rights beyond their role, accounts inactive 90+ days. 3. Produce a findings report with recommended actions. 4. Recommended changes still go through the plan → review gate.',
      '',
      '**Gotchas:** Service accounts look like stale accounts — check ownership before flagging. Disable-then-review is safer than delete.'
    ].join('\n')
  },
  {
    title: 'Ticket Triage SOP',
    domain: 'ticketing',
    content_md: [
      '**Trigger:** When you need to triage a queue of tickets.',
      '',
      '**Approach:** 1. Classify each ticket: category (access, hardware, software, network, email), priority = impact × urgency. 2. Route by category to the right specialist. 3. Produce a triage table with the reasoning per ticket. 4. High-impact × high-urgency = P1, escalate immediately.',
      '',
      '**Gotchas:** Multiple users reporting the same symptom = one incident, not many tickets — link them. Missing reproduction steps go back to the requester with specific questions.'
    ].join('\n')
  },
  {
    title: 'Ticket Status Update Pattern',
    domain: 'ticketing',
    content_md: [
      '**Trigger:** When you need to update a requester on ticket progress.',
      '',
      '**Approach:** Every update states four things in plain language: what changed, current status, next step, expected time. Match the audience — requesters get outcomes, internal notes get technical detail.',
      '',
      '**Gotchas:** Never promise a timeline that was not confirmed. An update with no next step reads as stalled — always state what happens next.'
    ].join('\n')
  },
  {
    title: 'Customer Support Response Pattern',
    domain: 'customer-support',
    content_md: [
      '**Trigger:** When you need to reply to a customer support request.',
      '',
      '**Approach:** 1. Acknowledge the issue and its impact first. 2. State what is being done and what the customer should do. 3. Give the expected update time. 4. Close with a clear ask if more info is needed. Keep it plain language — no internal jargon.',
      '',
      '**Gotchas:** Facts come from the mission context — never invented; unknowns are marked "to confirm". Suspected phishing is never answered directly — flag it.'
    ].join('\n')
  },
  {
    title: 'Email Drafting Template',
    domain: 'email',
    content_md: [
      '**Trigger:** When you need to draft an email (new message, reply, or follow-up).',
      '',
      '**Approach:** 1. Subject: specific and direct (name the content, not a vague umbrella). 2. Body: purpose in the first line, context second, explicit ask/next step last. 3. Audience-appropriate tone. 4. Follow-ups reference the original thread and the outstanding ask with the deadline.',
      '',
      '**Gotchas:** Never include credentials or confidential details beyond what the message needs. Never promise unconfirmed outcomes.'
    ].join('\n')
  },
  {
    title: 'Data Upload Runbook',
    domain: 'data-upload',
    content_md: [
      '**Trigger:** When you need to upload data to a system or staging area.',
      '',
      '**Approach:** 1. Stage the file and record its source, row count, and checksum. 2. Map columns explicitly. 3. Validate BEFORE any commit: row counts, types, nulls in required fields, duplicates, business rules. 4. Upload in a reversible way (stage → validate → commit). 5. Record the outcome and attach a rollback note.',
      '',
      '**Gotchas:** Never skip validation to save time — bad uploads cost more downstream. Encoding issues (UTF-8 vs ANSI) corrupt special characters — verify after staging.'
    ].join('\n')
  },
  {
    title: 'Power BI Report Checklist',
    domain: 'power-bi',
    content_md: [
      '**Trigger:** When you need to create a Power BI report or dashboard.',
      '',
      '**Approach:** 1. Define the questions the report must answer and its audience before opening Power BI. 2. Model: confirm source tables, relationships, and granularity first. 3. One visual per question; lead page answers the top question; details one level deeper. 4. DAX measures with intent documented in the description. 5. Check hierarchy: most important number is the most obvious. 6. Set refresh guidance and document the data source.',
      '',
      '**Gotchas:** Aggregate or mask personal data unless the mission explicitly requires it. A report with 20 visuals is not simpler — decide what NOT to build.'
    ].join('\n')
  },
  {
    title: 'System Maintenance & Patch Planning',
    domain: 'system-maintenance',
    content_md: [
      '**Trigger:** When you need to plan maintenance or updates/patching.',
      '',
      '**Approach:** 1. Establish current state: versions, dependencies, maintenance windows. 2. Assess blast radius: what breaks if this fails, who is affected. 3. Order changes dependencies-first. 4. Rollback note per step; verification step after each change. 5. Hard-to-reverse updates get explicit user confirmation.',
      '',
      '**Gotchas:** Never minimize a blast radius to get approval — state it honestly. Snapshots before patching; verify backups are restorable, not just present.'
    ].join('\n')
  }
];

/** Seed the Knowledge Library with the playbooks (skip when already seeded unless forced). */
export async function seedKnowledge(force = false): Promise<number> {
  const countRow = one<{ n: number }>(db.prepare('SELECT COUNT(*) AS n FROM knowledge').get());
  const count = countRow ? countRow.n : 0;
  if (count > 0 && !force) return 0;
  let seeded = 0;
  for (const p of PLAYBOOKS) {
    const existing = one<{ id: number }>(db.prepare('SELECT id FROM knowledge WHERE title = ?').get(p.title));
    if (existing && !force) continue;
    if (existing && force) db.prepare('DELETE FROM knowledge WHERE id = ?').run(existing.id);
    await addKnowledge({
      title: p.title,
      content_md: p.content_md,
      domain: p.domain,
      tags: ['seed', 'playbook'],
      confidence: 0.8,
      success_count: 1
    });
    seeded++;
  }
  return seeded;
}