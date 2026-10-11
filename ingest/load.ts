import type { DB } from "../core/db.js";
import { GEDCOM_TABLES } from "../core/db.js";
import { type GedNode, child, childValue, children, toJson } from "./gedcom/parse.js";
import { normalizeDate } from "./gedcom/dates.js";
import { normalizePlace } from "./places.js";

const EVENT_TAGS = new Set([
  "BIRT", "CHR", "BAPM", "DEAT", "BURI", "CREM", "ADOP", "CONF", "FCOM", "BARM", "BASM",
  "MARR", "MARB", "MARL", "MARC", "ENGA", "DIV", "DIVF", "ANUL",
  "RESI", "OCCU", "EDUC", "RELI", "NATU", "IMMI", "EMIG", "CENS", "PROB", "WILL", "GRAD", "RETI",
  "EVEN", "FACT", "MILI", "_MILT", "_MILTID", "TITL", "NATI", "DSCR", "PROP", "ARVL", "DPRT",
]);
/** Record-level tags that are structure, not life events. */
const STRUCTURAL = new Set([
  "NAME", "SEX", "FAMC", "FAMS", "SOUR", "OBJE", "NOTE", "HUSB", "WIFE", "CHIL", "RIN", "CHAN",
  "REFN", "RFN", "AFN", "_UID", "UID", "SUBM", "NCHI",
]);
export const DEATH_TAGS = new Set(["DEAT", "BURI", "CREM", "PROB"]);

export interface ParsedName { given: string | null; surname: string | null; full: string }

export function parseName(node: GedNode | undefined): ParsedName {
  if (!node) return { given: null, surname: null, full: "(unknown)" };
  const m = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(node.value);
  const given = (childValue(node, "GIVN") ?? (m ? m[1] : node.value)).trim() || null;
  const surname = (childValue(node, "SURN") ?? (m ? m[2] : "")).trim() || null;
  const suffix = m ? m[3].trim() : "";
  const full = [given, surname, suffix].filter(Boolean).join(" ") || "(unknown)";
  return { given, surname, full };
}

export interface LoadStats { people: number; families: number; events: number; places: number; sources: number; media: number; customTags: number }

export function loadGedcom(db: DB, records: GedNode[]): LoadStats {
  const insert = {
    person: db.prepare(`INSERT INTO people (id, given, surname, full_name, sex, raw) VALUES (?, ?, ?, ?, ?, ?)`),
    name: db.prepare(`INSERT INTO names (person_id, given, surname, type, raw) VALUES (?, ?, ?, ?, ?)`),
    family: db.prepare(`INSERT INTO families (id, husband_id, wife_id, raw) VALUES (?, ?, ?, ?)`),
    famChild: db.prepare(`INSERT OR IGNORE INTO family_children (family_id, child_id, pedigree) VALUES (?, ?, ?)`),
    place: db.prepare(`INSERT INTO places (raw, normalized) VALUES (?, ?) ON CONFLICT(raw) DO UPDATE SET raw = raw RETURNING id`),
    event: db.prepare(`INSERT INTO events (person_id, family_id, tag, type, value, date_raw, date_sort, date_min, date_max,
      date_precision, date_qualifier, place_id, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    source: db.prepare(`INSERT INTO sources (id, title, author, publication, repository, raw) VALUES (?, ?, ?, ?, ?, ?)`),
    citation: db.prepare(`INSERT INTO citations (source_id, person_id, family_id, event_id, page, apid, raw) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    media: db.prepare(`INSERT OR REPLACE INTO media (id, file, form, title, raw) VALUES (?, ?, ?, ?, ?)`),
    mediaLink: db.prepare(`INSERT INTO media_links (media_id, person_id, family_id, event_id) VALUES (?, ?, ?, ?)`),
    custom: db.prepare(`INSERT INTO custom_tags (record_id, path, tag, value) VALUES (?, ?, ?, ?)`),
  };

  const stats: LoadStats = { people: 0, families: 0, events: 0, places: 0, sources: 0, media: 0, customTags: 0 };
  let inlineMedia = 0;

  const placeId = (raw: string | undefined): number | null => {
    if (!raw) return null;
    return (insert.place.get(raw, normalizePlace(raw)) as { id: number }).id;
  };

  const recordCustomTags = (recordId: string, node: GedNode, path: string) => {
    for (const c of node.children) {
      const p = `${path}.${c.tag}`;
      if (c.tag.startsWith("_")) {
        insert.custom.run(recordId, p, c.tag, c.value || null);
        stats.customTags++;
      }
      recordCustomTags(recordId, c, p);
    }
  };

  const linkMedia = (obje: GedNode, owner: { person?: string; family?: string; event?: number }) => {
    let id = obje.value.startsWith("@") ? obje.value : undefined;
    if (!id) {
      // Inline OBJE with its own FILE: give it a synthetic id.
      id = `@INLINE_M${++inlineMedia}@`;
      const file = child(obje, "FILE");
      insert.media.run(id, file?.value ?? null, childValue(file ?? obje, "FORM") ?? null, childValue(obje, "TITL") ?? childValue(file ?? obje, "TITL") ?? null, JSON.stringify(toJson(obje)));
    }
    insert.mediaLink.run(id, owner.person ?? null, owner.family ?? null, owner.event ?? null);
  };

  const addCitations = (node: GedNode, owner: { person?: string; family?: string; event?: number }) => {
    for (const s of children(node, "SOUR")) {
      insert.citation.run(
        s.value.startsWith("@") ? s.value : null,
        owner.person ?? null, owner.family ?? null, owner.event ?? null,
        childValue(s, "PAGE") ?? null,
        childValue(s, "_APID") ?? null,
        JSON.stringify(toJson(s)),
      );
    }
  };

  const addEvents = (record: GedNode, owner: { person?: string; family?: string }, famsOf?: string[]) => {
    for (const e of record.children) {
      if (STRUCTURAL.has(e.tag)) continue;
      const hasDetail = child(e, "DATE") || child(e, "PLAC");
      if (!EVENT_TAGS.has(e.tag) && !hasDetail) continue;
      const date = normalizeDate(childValue(e, "DATE"));
      // Ancestry writes MARR on the person; attach it to the family when that's unambiguous.
      const familyId = owner.family ?? (e.tag === "MARR" && famsOf?.length === 1 ? famsOf[0] : null);
      const res = insert.event.run(
        owner.person ?? null, familyId, e.tag, childValue(e, "TYPE") ?? null, e.value || null,
        date.raw || null, date.sort, date.min, date.max, date.precision, date.qualifier,
        placeId(childValue(e, "PLAC")), JSON.stringify(toJson(e)),
      );
      const eventId = Number(res.lastInsertRowid);
      stats.events++;
      addCitations(e, { ...owner, event: eventId });
      for (const o of children(e, "OBJE")) linkMedia(o, { ...owner, event: eventId });
    }
  };

  db.transaction(() => {
    for (const t of GEDCOM_TABLES) db.exec(`DELETE FROM ${t}`);

    // Media and sources first so links resolve.
    for (const r of records) {
      if (r.tag === "OBJE" && r.xref) {
        const file = child(r, "FILE");
        insert.media.run(r.xref, file?.value ?? null, childValue(file ?? r, "FORM") ?? childValue(r, "FORM") ?? null,
          childValue(file ?? r, "TITL") ?? childValue(r, "TITL") ?? null, JSON.stringify(toJson(r)));
        recordCustomTags(r.xref, r, "OBJE");
        stats.media++;
      } else if (r.tag === "SOUR" && r.xref) {
        insert.source.run(r.xref, childValue(r, "TITL") ?? null, childValue(r, "AUTH") ?? null,
          childValue(r, "PUBL") ?? null, childValue(r, "REPO") ?? null, JSON.stringify(toJson(r)));
        recordCustomTags(r.xref, r, "SOUR");
        stats.sources++;
      }
    }

    for (const r of records) {
      if (r.tag === "INDI" && r.xref) {
        const nameNodes = children(r, "NAME");
        const primary = parseName(nameNodes[0]);
        insert.person.run(r.xref, primary.given, primary.surname, primary.full, childValue(r, "SEX") ?? null, JSON.stringify(toJson(r)));
        for (const n of nameNodes) {
          const pn = parseName(n);
          insert.name.run(r.xref, pn.given, pn.surname, childValue(n, "TYPE") ?? null, n.value);
        }
        const fams = children(r, "FAMS").map((f) => f.value);
        addEvents(r, { person: r.xref }, fams);
        addCitations(r, { person: r.xref });
        for (const o of children(r, "OBJE")) linkMedia(o, { person: r.xref });
        // FAMC with pedigree (birth/adopted) is recorded via the family's CHIL list below, but some exports only have FAMC.
        for (const fc of children(r, "FAMC")) insert.famChild.run(fc.value, r.xref, childValue(fc, "PEDI") ?? null);
        recordCustomTags(r.xref, r, "INDI");
        stats.people++;
      } else if (r.tag === "FAM" && r.xref) {
        insert.family.run(r.xref, childValue(r, "HUSB") ?? null, childValue(r, "WIFE") ?? null, JSON.stringify(toJson(r)));
        for (const c of children(r, "CHIL")) insert.famChild.run(r.xref, c.value, childValue(c, "_FREL") ?? childValue(c, "_MREL") ?? null);
        addEvents(r, { family: r.xref });
        addCitations(r, { family: r.xref });
        for (const o of children(r, "OBJE")) linkMedia(o, { family: r.xref });
        recordCustomTags(r.xref, r, "FAM");
        stats.families++;
      }
    }
    stats.places = (db.prepare(`SELECT COUNT(*) AS n FROM places`).get() as { n: number }).n;
  })();

  return stats;
}
