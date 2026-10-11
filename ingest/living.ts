import type { DB } from "../core/db.js";
import { DEATH_TAGS } from "./load.js";

const BIRTH_TAGS = ["BIRT", "CHR", "BAPM"];
const PARENT_GAP = 27;

/**
 * Living = no death evidence and born after the cutoff. When a birth year is
 * missing it's estimated from parents, children, or spouses; if nothing can be
 * estimated the person is treated as living, so privacy fails safe.
 */
export function markLiving(db: DB, cutoffYear: number): void {
  const people = db.prepare(`SELECT id FROM people`).all() as { id: string }[];
  const birth = new Map<string, number>();
  const birthFromBirt = new Set<string>();
  const dead = new Set<string>();

  for (const row of db.prepare(`SELECT person_id, tag, value, date_sort FROM events WHERE person_id IS NOT NULL`).all() as
    { person_id: string; tag: string; value: string | null; date_sort: string | null }[]) {
    if (DEATH_TAGS.has(row.tag)) dead.add(row.person_id);
    const y = row.date_sort ? Number(row.date_sort.slice(0, 4)) : null;
    if (y && BIRTH_TAGS.includes(row.tag)) {
      // A BIRT date beats a christening date; within the same kind keep the earliest.
      const isBirt = row.tag === "BIRT";
      const prev = birth.get(row.person_id);
      const hadBirt = birthFromBirt.has(row.person_id);
      if (prev === undefined || (isBirt && !hadBirt) || (isBirt === hadBirt && y < prev)) {
        birth.set(row.person_id, y);
        if (isBirt) birthFromBirt.add(row.person_id);
      }
    }
  }

  const deathYears = new Map<string, number>();
  for (const row of db.prepare(`SELECT person_id, MIN(date_sort) AS d FROM events WHERE tag = 'DEAT' AND date_sort IS NOT NULL GROUP BY person_id`).all() as
    { person_id: string; d: string }[]) deathYears.set(row.person_id, Number(row.d.slice(0, 4)));

  // Relationship edges for estimation.
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const f of db.prepare(`SELECT f.husband_id h, f.wife_id w, fc.child_id c FROM families f LEFT JOIN family_children fc ON fc.family_id = f.id`).all() as
    { h: string | null; w: string | null; c: string | null }[]) {
    for (const p of [f.h, f.w]) {
      if (p && f.c) { push(parentsOf, f.c, p); push(childrenOf, p, f.c); }
    }
  }
  for (const f of db.prepare(`SELECT husband_id h, wife_id w FROM families WHERE husband_id IS NOT NULL AND wife_id IS NOT NULL`).all() as { h: string; w: string }[]) {
    push(spousesOf, f.h, f.w); push(spousesOf, f.w, f.h);
  }

  const estimate = new Map<string, number>(birth);
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const { id } of people) {
      if (estimate.has(id)) continue;
      const guesses: number[] = [];
      for (const p of parentsOf.get(id) ?? []) if (estimate.has(p)) guesses.push(estimate.get(p)! + PARENT_GAP);
      for (const c of childrenOf.get(id) ?? []) if (estimate.has(c)) guesses.push(estimate.get(c)! - PARENT_GAP);
      for (const s of spousesOf.get(id) ?? []) if (birth.has(s)) guesses.push(birth.get(s)!);
      if (guesses.length) {
        estimate.set(id, Math.round(guesses.reduce((a, b) => a + b, 0) / guesses.length));
        changed = true;
      }
    }
    if (!changed) break;
  }

  const update = db.prepare(`UPDATE people SET birth_year = ?, death_year = ?, estimated_birth_year = ?, has_death_evidence = ?, is_living = ?, living_reason = ? WHERE id = ?`);
  db.transaction(() => {
    for (const { id } of people) {
      const by = birth.get(id) ?? null;
      const est = by === null ? (estimate.get(id) ?? null) : null;
      const hasDeath = dead.has(id);
      let living = false;
      let reason: string;
      if (hasDeath) reason = "has death/burial record";
      else if (by !== null) { living = by > cutoffYear; reason = `born ${by}, no death record`; }
      else if (est !== null) { living = est > cutoffYear; reason = `birth estimated ~${est} from relatives, no death record`; }
      else { living = true; reason = "no dates at all; treated as living to be safe"; }
      update.run(by, deathYears.get(id) ?? null, est, hasDeath ? 1 : 0, living ? 1 : 0, reason, id);
    }
  })();
}
