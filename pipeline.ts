import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import "dotenv/config";
import { loadConfig, lineOutputDir, resolvePath, selectLines, type FamilyConfig, type LineConfig } from "./core/config.js";
import { openDb, type DB } from "./core/db.js";
import { ingest } from "./ingest/index.js";
import { geocodePlaces } from "./ingest/geocode.js";
import { NeedsSelfError } from "./ingest/lines.js";
import { formatLineSummary, formatTreeSummary, summarizeLine } from "./ingest/summary.js";

/**
 * One entry point for every stage. "tree" stages run once over the whole
 * GEDCOM; "line" stages run once per selected line and write only under
 * out/<line>/, so `--line mom` and `--line dad` produce independent products.
 *
 *   npm run pipeline -- ingest
 *   npm run pipeline -- summary --line mom
 *   npm run pipeline -- all --line dad
 */
interface Ctx { db: DB; config: FamilyConfig; flags: Flags }
interface Flags { line?: string; self?: string; offline?: boolean }

type Stage =
  | { name: string; scope: "tree"; run: (ctx: Ctx) => Promise<void> | void }
  | { name: string; scope: "line"; run: (ctx: Ctx, line: LineConfig) => Promise<void> | void };

const STAGES: Stage[] = [
  { name: "ingest", scope: "tree", run: ({ db, config, flags }) => ingest(db, config, { self: flags.self }) },
  {
    name: "geocode", scope: "tree",
    run: ({ db, flags }) => {
      const contact = process.env.GEOCODER_CONTACT;
      if (!contact && !flags.offline) console.log("  GEOCODER_CONTACT not set in .env; using cached results only.");
      return geocodePlaces(db, { contact, offline: flags.offline || !contact });
    },
  },
  {
    name: "summary", scope: "line",
    run: ({ db, config }, line) => {
      const text = formatLineSummary(summarizeLine(db, line));
      console.log(`\n${text}`);
      fs.writeFileSync(path.join(lineOutputDir(config, line.id), "summary.md"), text + "\n");
    },
  },
  // Phases 2–5 plug in here as line stages: research, story, factcheck, storyboard, render, poster.
];

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { line: { type: "string" }, self: { type: "string" }, offline: { type: "boolean" } },
  });
  const command = positionals[0] ?? "all";
  const config = loadConfig();
  const lines = selectLines(config, values.line);
  const stages = command === "all" ? STAGES : STAGES.filter((s) => s.name === command);
  if (!stages.length) {
    throw new Error(`Unknown stage "${command}". Stages: ${STAGES.map((s) => s.name).join(", ")}, all`);
  }

  const db = openDb(resolvePath(config.database));
  const ctx: Ctx = { db, config, flags: values };
  try {
    for (const stage of stages) {
      if (stage.scope === "tree") {
        console.log(`▶ ${stage.name}`);
        await stage.run(ctx);
      } else {
        for (const line of lines) {
          console.log(`▶ ${stage.name} [${line.id}]`);
          await stage.run(ctx, line);
        }
      }
    }
    if (stages.some((s) => s.name === "summary")) console.log(`\n${formatTreeSummary(db)}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  if (err instanceof NeedsSelfError) {
    console.error(err.message);
    console.error("Likely candidates:");
    for (const c of err.candidates) console.error(`  ${c.id}  ${c.name}${c.birthYear ? ` (b. ~${c.birthYear})` : ""}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
