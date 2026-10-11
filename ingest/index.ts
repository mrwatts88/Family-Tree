import fs from "node:fs";
import type { DB } from "../core/db.js";
import type { FamilyConfig } from "../core/config.js";
import { resolvePath } from "../core/config.js";
import { parseGedcom } from "./gedcom/parse.js";
import { loadGedcom } from "./load.js";
import { markLiving } from "./living.js";
import { buildLines, resolveSelf } from "./lines.js";

/** Phase 1: GEDCOM → SQLite, living flags, and line membership. Safe to re-run. */
export function ingest(db: DB, config: FamilyConfig, opts: { self?: string; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const file = resolvePath(config.gedcom);
  if (!fs.existsSync(file)) throw new Error(`No GEDCOM at ${config.gedcom}. Export it from Ancestry and save it there.`);
  const stats = loadGedcom(db, parseGedcom(fs.readFileSync(file, "utf8")));
  log(`Loaded ${stats.people} people, ${stats.families} families, ${stats.events} events, ${stats.places} places, ${stats.sources} sources, ${stats.media} media, ${stats.customTags} custom tags.`);
  markLiving(db, config.livingCutoffYear);
  const selfId = resolveSelf(db, config, opts.self);
  buildLines(db, config, selfId);
  const self = db.prepare(`SELECT full_name FROM people WHERE id = ?`).get(selfId) as { full_name: string };
  log(`You: ${self.full_name} [${selfId}]. Built ${config.lines.length} line(s): ${config.lines.map((l) => l.id).join(", ")}.`);
}
