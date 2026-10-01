import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, many } from '../db.js';

const here = dirname(fileURLToPath(import.meta.url));
// server/src/artifacts -> server root is two levels up
const artifactsRoot = join(here, '..', '..', 'artifacts');

function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._ -]+/g, '_').trim();
  return cleaned || 'artifact.txt';
}

/** Write every approved artifact document of a mission to disk. Returns count. */
export function writeMissionArtifacts(missionId: number): number {
  const rows = many<{ id: number; title: string; content_md: string }>(
    db
      .prepare("SELECT id, title, content_md FROM documents WHERE mission_id = ? AND type = 'artifact' ORDER BY id")
      .all(missionId)
  );
  const dir = join(artifactsRoot, `mission-${missionId}`);
  mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const r of rows) {
    const file = join(dir, safeName(r.title));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, r.content_md, 'utf8');
    count++;
  }
  return count;
}

export function artifactsRootPath(): string {
  return artifactsRoot;
}
