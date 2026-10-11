import type { DB } from "./db.js";

/**
 * Line-scoped read helpers. Later stages (research, story, video) should get
 * their people through these so each line's product only ever sees its own side.
 */
export interface LinePerson {
  id: string;
  name: string;
  sex: string | null;
  birthYear: number | null;
  deathYear: number | null;
  isLiving: boolean;
  generation: number;
  ahnentafel: number;
}

export function linePeople(db: DB, lineId: string, opts: { includeLiving?: boolean } = {}): LinePerson[] {
  const rows = db.prepare(`
    SELECT p.id, p.full_name AS name, p.sex, p.birth_year AS birthYear, p.death_year AS deathYear,
           p.is_living AS isLiving, MIN(m.generation) AS generation, MIN(m.ahnentafel) AS ahnentafel
    FROM line_members m JOIN people p ON p.id = m.person_id
    WHERE m.line_id = ?
    GROUP BY p.id
    ORDER BY generation, ahnentafel`).all(lineId) as (Omit<LinePerson, "isLiving"> & { isLiving: number })[];
  return rows
    .map((r) => ({ ...r, isLiving: r.isLiving === 1 }))
    .filter((r) => opts.includeLiving || !r.isLiving);
}

export interface FrontierPerson extends LinePerson {
  missing: "both" | "father" | "mother";
}

/** Ancestors in the line with at least one unknown parent. "both" is the true frontier. */
export function lineFrontier(db: DB, lineId: string): FrontierPerson[] {
  const people = linePeople(db, lineId, { includeLiving: true });
  const present = new Set(
    (db.prepare(`SELECT ahnentafel FROM line_members WHERE line_id = ?`).all(lineId) as { ahnentafel: number }[]).map((r) => r.ahnentafel),
  );
  const out: FrontierPerson[] = [];
  for (const p of people) {
    const hasFather = present.has(p.ahnentafel * 2);
    const hasMother = present.has(p.ahnentafel * 2 + 1);
    if (hasFather && hasMother) continue;
    out.push({ ...p, missing: !hasFather && !hasMother ? "both" : !hasFather ? "father" : "mother" });
  }
  return out;
}
