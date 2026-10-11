import type { DB } from "../core/db.js";
import type { FamilyConfig, LineConfig } from "../core/config.js";

export interface Parents { father: string | null; mother: string | null }

export function parentsOf(db: DB, personId: string): Parents {
  // Prefer a birth family over adoptive/step when there are several.
  const rows = db.prepare(`
    SELECT f.husband_id AS father, f.wife_id AS mother, fc.pedigree AS pedi
    FROM family_children fc JOIN families f ON f.id = fc.family_id
    WHERE fc.child_id = ?`).all(personId) as { father: string | null; mother: string | null; pedi: string | null }[];
  if (!rows.length) return { father: null, mother: null };
  const rank = (p: string | null) => (!p || /birth|natural/i.test(p) ? 0 : 1);
  rows.sort((a, b) => rank(a.pedi) - rank(b.pedi));
  return { father: rows[0].father, mother: rows[0].mother };
}

export class NeedsSelfError extends Error {
  constructor(public candidates: { id: string; name: string; birthYear: number | null }[]) {
    super("Couldn't tell which person is you. Set \"self\" in family.config.json (or pass --self @I123@).");
  }
}

/**
 * Finds "you". Uses config.self when set; otherwise accepts a single obvious
 * candidate (the youngest person whose both parents are in the tree and who
 * has no recorded children). Anything else is ambiguous and we ask.
 */
export function resolveSelf(db: DB, config: FamilyConfig, override?: string): string {
  const explicit = override ?? config.self;
  if (explicit) {
    const row = db.prepare(`SELECT id FROM people WHERE id = ?`).get(explicit);
    if (!row) throw new Error(`"self" is ${explicit}, but no such person is in the GEDCOM`);
    return explicit;
  }
  const candidates = db.prepare(`
    SELECT p.id, p.full_name AS name, COALESCE(p.birth_year, p.estimated_birth_year) AS birthYear
    FROM people p
    WHERE EXISTS (
      SELECT 1 FROM family_children fc JOIN families f ON f.id = fc.family_id
      WHERE fc.child_id = p.id AND f.husband_id IS NOT NULL AND f.wife_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM families f JOIN family_children fc ON fc.family_id = f.id
      WHERE f.husband_id = p.id OR f.wife_id = p.id)
    ORDER BY birthYear DESC NULLS LAST
    LIMIT 8`).all() as { id: string; name: string; birthYear: number | null }[];
  if (candidates.length === 1) return candidates[0].id;
  throw new NeedsSelfError(candidates);
}

export function lineRootId(db: DB, line: LineConfig, selfId: string): string {
  if ("person" in line.root) return line.root.person;
  const parents = parentsOf(db, selfId);
  const id = line.root.parentOfSelf === "mother" ? parents.mother : parents.father;
  if (!id) throw new Error(`Line "${line.id}": you (${selfId}) have no ${line.root.parentOfSelf} in the tree`);
  return id;
}

/** Generation of `personId` above `selfId` (parent = 1), or null if not a direct ancestor. */
function generationAboveSelf(db: DB, selfId: string, personId: string): number | null {
  let frontier = [selfId];
  for (let gen = 1; gen < 40 && frontier.length; gen++) {
    const next: string[] = [];
    for (const id of frontier) {
      const p = parentsOf(db, id);
      for (const x of [p.father, p.mother]) if (x) next.push(x);
    }
    if (next.includes(personId)) return gen;
    frontier = next;
  }
  return null;
}

/**
 * Recomputes line membership: every direct ancestor of each line's root,
 * numbered ahnentafel-style (root = 1, father = 2n, mother = 2n + 1).
 */
export function buildLines(db: DB, config: FamilyConfig, selfId: string): void {
  db.transaction(() => {
    db.exec(`DELETE FROM line_members; DELETE FROM lines;`);
    const insertLine = db.prepare(`INSERT INTO lines (id, label, root_person_id) VALUES (?, ?, ?)`);
    const insertMember = db.prepare(`INSERT INTO line_members (line_id, person_id, ahnentafel, generation) VALUES (?, ?, ?, ?)`);

    for (const line of config.lines) {
      const rootId = lineRootId(db, line, selfId);
      insertLine.run(line.id, line.label, rootId);
      const rootGen = generationAboveSelf(db, selfId, rootId) ?? 1;

      const queue: [string, number][] = [[rootId, 1]];
      while (queue.length) {
        const [id, ahn] = queue.shift()!;
        const depth = Math.floor(Math.log2(ahn));
        insertMember.run(line.id, id, ahn, rootGen + depth);
        if (depth >= 40) continue; // guards against cyclic (corrupt) parent links
        const { father, mother } = parentsOf(db, id);
        if (father) queue.push([father, ahn * 2]);
        if (mother) queue.push([mother, ahn * 2 + 1]);
      }
    }
  })();
}
