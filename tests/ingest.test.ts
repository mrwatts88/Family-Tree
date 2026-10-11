import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../core/db.js";
import type { FamilyConfig } from "../core/config.js";
import { selectLines } from "../core/config.js";
import { lineFrontier, linePeople } from "../core/lines.js";
import { parseGedcom } from "../ingest/gedcom/parse.js";
import { loadGedcom } from "../ingest/load.js";
import { markLiving } from "../ingest/living.js";
import { buildLines, NeedsSelfError, resolveSelf } from "../ingest/lines.js";

const ged = fs.readFileSync(path.join(import.meta.dirname, "fixtures/sample.ged"), "utf8");

const config: FamilyConfig = {
  gedcom: "", database: ":memory:", outputDir: "out", self: "@I1@", livingCutoffYear: 1925, allowNamedLiving: [],
  lines: [
    { id: "mom", label: "Mom's side", root: { parentOfSelf: "mother" }, dedication: "For Mom", destination: null },
    { id: "dad", label: "Dad's side", root: { parentOfSelf: "father" }, dedication: "For Dad", destination: null },
  ],
};

function setup(c = config) {
  const db = openDb(":memory:");
  loadGedcom(db, parseGedcom(ged));
  markLiving(db, c.livingCutoffYear);
  buildLines(db, c, resolveSelf(db, c));
  return db;
}

describe("ingest", () => {
  it("keeps custom tags and links MARR on a person to their family", () => {
    const db = setup();
    const tags = db.prepare(`SELECT path FROM custom_tags WHERE record_id = '@I4@'`).all().map((r: any) => r.path);
    expect(tags).toContain("INDI._MILT");
    expect(tags).toContain("INDI.SOUR._APID");
    const marr = db.prepare(`SELECT family_id FROM events WHERE person_id = '@I2@' AND tag = 'MARR'`).get() as any;
    expect(marr.family_id).toBe("@F1@");
    const cite = db.prepare(`SELECT apid, page FROM citations WHERE person_id = '@I4@'`).get() as any;
    expect(cite.apid).toBe("1,6224::12345");
  });

  it("re-ingests over an existing database", () => {
    const db = setup();
    loadGedcom(db, parseGedcom(ged));
    expect((db.prepare(`SELECT COUNT(*) n FROM people`).get() as any).n).toBe(10);
  });

  it("flags living people conservatively", () => {
    const db = setup();
    const living = (id: string) => (db.prepare(`SELECT is_living FROM people WHERE id = ?`).get(id) as any).is_living;
    expect(living("@I5@")).toBe(1); // born 1935, no death
    expect(living("@I6@")).toBe(0); // born 1920
    expect(living("@I4@")).toBe(0); // has death record
    expect(living("@I7@")).toBe(1); // no dates; estimated from child born ~1960
  });

  it("splits ancestors into separate lines", () => {
    const db = setup();
    const mom = linePeople(db, "mom", { includeLiving: true }).map((p) => p.id);
    const dad = linePeople(db, "dad", { includeLiving: true }).map((p) => p.id);
    expect(mom).toEqual(["@I2@", "@I4@", "@I5@", "@I8@", "@I9@"]);
    expect(dad).toEqual(["@I3@", "@I6@", "@I7@"]);
    expect(mom).not.toContain("@I1@");
    expect(mom).not.toContain("@I10@");
    // Research only ever sees the deceased.
    expect(linePeople(db, "mom").map((p) => p.id)).toEqual(["@I4@", "@I8@", "@I9@"]);
    const frontier = lineFrontier(db, "mom").filter((f) => f.missing === "both").map((f) => f.id);
    expect(frontier).toEqual(["@I5@", "@I8@", "@I9@"]);
    expect(Math.max(...linePeople(db, "mom", { includeLiving: true }).map((p) => p.generation))).toBe(3);
  });

  it("supports lines rooted at any person", () => {
    const c: FamilyConfig = {
      ...config,
      lines: [{ id: "mueller", label: "Mueller", root: { person: "@I4@" }, dedication: "", destination: null }],
    };
    const db = setup(c);
    const people = linePeople(db, "mueller", { includeLiving: true });
    expect(people.map((p) => [p.id, p.generation])).toEqual([["@I4@", 2], ["@I8@", 3], ["@I9@", 3]]);
  });

  it("asks which person is you when ambiguous", () => {
    const db = openDb(":memory:");
    loadGedcom(db, parseGedcom(ged));
    markLiving(db, 1925);
    expect(() => resolveSelf(db, { ...config, self: null })).toThrow(NeedsSelfError);
  });

  it("selects lines from --line", () => {
    expect(selectLines(config, undefined).map((l) => l.id)).toEqual(["mom", "dad"]);
    expect(selectLines(config, "dad").map((l) => l.id)).toEqual(["dad"]);
    expect(() => selectLines(config, "aunt")).toThrow(/Unknown line/);
  });
});
