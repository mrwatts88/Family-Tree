import type { DB } from "../core/db.js";
import type { LineConfig } from "../core/config.js";
import { lineFrontier, linePeople } from "../core/lines.js";

export interface LineSummary {
  line: LineConfig;
  rootName: string;
  people: number;
  living: number;
  deepestGeneration: number;
  frontier: { id: string; name: string; birthYear: number | null; generation: number; missing: string; place: string | null }[];
}

const birthPlace = (db: DB, id: string) =>
  (db.prepare(`SELECT pl.normalized AS place FROM events e JOIN places pl ON pl.id = e.place_id
    WHERE e.person_id = ? AND e.tag IN ('BIRT','CHR','BAPM') ORDER BY e.tag = 'BIRT' DESC LIMIT 1`).get(id) as { place: string } | undefined)?.place ?? null;

export function summarizeLine(db: DB, line: LineConfig): LineSummary {
  const all = linePeople(db, line.id, { includeLiving: true });
  const root = db.prepare(`SELECT p.full_name AS name FROM lines l JOIN people p ON p.id = l.root_person_id WHERE l.id = ?`).get(line.id) as { name: string } | undefined;
  return {
    line,
    rootName: root?.name ?? "(line not built; run ingest)",
    people: all.length,
    living: all.filter((p) => p.isLiving).length,
    deepestGeneration: all.reduce((m, p) => Math.max(m, p.generation), 0),
    frontier: lineFrontier(db, line.id).map((p) => ({
      id: p.id,
      name: p.isLiving ? "(living person)" : p.name,
      birthYear: p.isLiving ? null : p.birthYear,
      generation: p.generation,
      missing: p.missing,
      place: p.isLiving ? null : birthPlace(db, p.id),
    })),
  };
}

export function formatLineSummary(s: LineSummary): string {
  const both = s.frontier.filter((f) => f.missing === "both");
  const half = s.frontier.filter((f) => f.missing !== "both");
  const row = (f: LineSummary["frontier"][number]) =>
    `  - gen ${f.generation}  ${f.name}${f.birthYear ? ` (b. ${f.birthYear})` : ""}${f.place ? `, ${f.place}` : ""}  [${f.id}]` +
    (f.missing === "both" ? "" : `  missing ${f.missing}`);
  return [
    `## ${s.line.label} [${s.line.id}] — root: ${s.rootName}`,
    `People in line: ${s.people} (${s.living} living, excluded from research)`,
    `Deepest generation: ${s.deepestGeneration} (parent = 1, grandparent = 2, ...)`,
    `Frontier, no known parents (${both.length}):`,
    ...both.map(row),
    `One parent missing (${half.length}):`,
    ...half.map(row),
  ].join("\n");
}

export function formatTreeSummary(db: DB): string {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return [
    `# Tree summary`,
    `People: ${n(`SELECT COUNT(*) n FROM people`)} (${n(`SELECT COUNT(*) n FROM people WHERE is_living = 1`)} living)`,
    `Families: ${n(`SELECT COUNT(*) n FROM families`)}  Events: ${n(`SELECT COUNT(*) n FROM events`)}  Places: ${n(`SELECT COUNT(*) n FROM places`)} (${n(`SELECT COUNT(*) n FROM places WHERE lat IS NOT NULL`)} geocoded)`,
    `Sources: ${n(`SELECT COUNT(*) n FROM sources`)}  Citations: ${n(`SELECT COUNT(*) n FROM citations`)}  Media: ${n(`SELECT COUNT(*) n FROM media`)}  Custom tags kept: ${n(`SELECT COUNT(*) n FROM custom_tags`)}`,
    `In no line (siblings, in-laws, descendants): ${n(`SELECT COUNT(*) n FROM people WHERE id NOT IN (SELECT person_id FROM line_members)`)}`,
  ].join("\n");
}
