import fs from "node:fs";
import path from "node:path";

/**
 * A "line" is one finished product: the ancestors of a single root person,
 * researched, narrated, and rendered on its own. Every stage after ingest
 * runs per line, so adding a line (a grandparent's branch, say) is a config
 * change, not a code change.
 */
export type LineRoot =
  | { parentOfSelf: "mother" | "father" }
  | { person: string }; // GEDCOM xref such as "@I123@"

export interface LineConfig {
  id: string;
  label: string;
  root: LineRoot;
  /** End-card text, e.g. "For Mom, Christmas 2026". */
  dedication: string;
  /** Where the journey ends, e.g. "Waukesha County, Wisconsin". */
  destination: string | null;
}

export interface FamilyConfig {
  gedcom: string;
  database: string;
  outputDir: string;
  /** Xref of the person the tree is "about" (you). Null means auto-detect. */
  self: string | null;
  livingCutoffYear: number;
  /** Xrefs of living people who may be named in videos. */
  allowNamedLiving: string[];
  lines: LineConfig[];
}

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export function loadConfig(file = path.join(PROJECT_ROOT, "family.config.json")): FamilyConfig {
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as FamilyConfig;
  validateConfig(config);
  return config;
}

export function validateConfig(config: FamilyConfig): void {
  if (!Array.isArray(config.lines) || config.lines.length === 0) {
    throw new Error("family.config.json: define at least one line");
  }
  const ids = new Set<string>();
  for (const line of config.lines) {
    if (!/^[a-z0-9-]+$/.test(line.id)) {
      throw new Error(`Line id "${line.id}" must be lowercase letters, digits, or dashes (it's used in file paths)`);
    }
    if (ids.has(line.id)) throw new Error(`Duplicate line id "${line.id}"`);
    ids.add(line.id);
    const root = line.root as Record<string, unknown>;
    if (!("parentOfSelf" in root) && !("person" in root)) {
      throw new Error(`Line "${line.id}": root needs "parentOfSelf" or "person"`);
    }
  }
}

/** Resolve a `--line` argument to the configured lines it names ("all" or omitted means every line). */
export function selectLines(config: FamilyConfig, arg: string | undefined): LineConfig[] {
  if (!arg || arg === "all") return config.lines;
  const wanted = arg.split(",").map((s) => s.trim());
  return wanted.map((id) => {
    const line = config.lines.find((l) => l.id === id);
    if (!line) {
      throw new Error(`Unknown line "${id}". Configured lines: ${config.lines.map((l) => l.id).join(", ")}`);
    }
    return line;
  });
}

export function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
}

/** Per-line output folder: out/<line>/<stage>. Each line's finished product lives entirely under out/<line>/. */
export function lineOutputDir(config: FamilyConfig, lineId: string, stage?: string): string {
  const dir = path.join(resolvePath(config.outputDir), lineId, stage ?? "");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
