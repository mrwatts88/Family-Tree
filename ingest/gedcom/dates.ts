/**
 * Normalizes GEDCOM and Ancestry-style dates ("abt 1850", "2010-2019",
 * "05/28/1960", "BET 1850 AND 1860") into a sortable range plus precision.
 */
export type DatePrecision = "day" | "month" | "year" | "decade" | "range" | "unknown";
export type DateQualifier = "exact" | "about" | "estimated" | "calculated" | "before" | "after" | "between" | "interpreted";

export interface NormalizedDate {
  raw: string;
  /** Best single point for sorting, YYYY-MM-DD. */
  sort: string | null;
  /** Earliest and latest dates the value could mean, YYYY-MM-DD. */
  min: string | null;
  max: string | null;
  precision: DatePrecision;
  qualifier: DateQualifier;
  year: number | null;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10,
  NOVEMBER: 11, DECEMBER: 12,
};

const QUALIFIERS: [RegExp, DateQualifier][] = [
  [/^(ABT|ABOUT|CIRCA|CA|C)\.?\s+/, "about"],
  [/^(EST|ESTIMATED)\.?\s+/, "estimated"],
  [/^(CAL|CALC|CALCULATED)\.?\s+/, "calculated"],
  [/^(BEF|BEFORE)\.?\s+/, "before"],
  [/^(AFT|AFTER)\.?\s+/, "after"],
  [/^INT\.?\s+/, "interpreted"],
];

interface Point { y: number; m?: number; d?: number }

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const first = (p: Point) => `${pad(p.y, 4)}-${pad(p.m ?? 1)}-${pad(p.d ?? 1)}`;
const last = (p: Point) => {
  const m = p.m ?? 12;
  return `${pad(p.y, 4)}-${pad(m)}-${pad(p.d ?? daysIn(p.y, m))}`;
};

function parsePoint(s: string): Point | null {
  s = s.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  let m: RegExpExecArray | null;

  // 05/28/1960 (Ancestry uses US month-first order)
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo)) return { y, m: mo, d };
    return null;
  }
  // 1960-05-28
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return { y: +m[1], m: +m[2], d: +m[3] };
  // 28 MAY 1960 / 28 May. 1960
  if ((m = /^(\d{1,2}) ([A-Z]+)\.? (\d{3,4})$/.exec(s)) && MONTHS[m[2]]) {
    return { y: +m[3], m: MONTHS[m[2]], d: +m[1] };
  }
  // MAY 28 1960
  if ((m = /^([A-Z]+)\.? (\d{1,2}) (\d{3,4})$/.exec(s)) && MONTHS[m[1]]) {
    return { y: +m[3], m: MONTHS[m[1]], d: +m[2] };
  }
  // MAY 1960
  if ((m = /^([A-Z]+)\.? (\d{3,4})$/.exec(s)) && MONTHS[m[1]]) return { y: +m[2], m: MONTHS[m[1]] };
  // 1960
  if ((m = /^(\d{3,4})$/.exec(s))) return { y: +m[1] };
  return null;
}

function precisionOf(p: Point): DatePrecision {
  return p.d ? "day" : p.m ? "month" : "year";
}

export function normalizeDate(raw: string | undefined | null): NormalizedDate {
  const empty: NormalizedDate = {
    raw: raw ?? "", sort: null, min: null, max: null, precision: "unknown", qualifier: "exact", year: null,
  };
  if (!raw || !raw.trim()) return empty;

  // Drop a trailing "(phrase)" and any calendar escape like @#DJULIAN@.
  let s = raw.toUpperCase().replace(/@#D[A-Z ]+@/g, "").replace(/\(.*\)$/, "").trim();
  if (!s) return empty;

  // Ranges: BET x AND y, FROM x TO y, x-y (e.g. 2010-2019).
  let rm =
    /^(?:BET|BETWEEN)\.?\s+(.+?)\s+(?:AND|&)\s+(.+)$/.exec(s) ??
    /^FROM\s+(.+?)\s+TO\s+(.+)$/.exec(s) ??
    /^(\d{3,4})\s*[-–]\s*(\d{3,4})$/.exec(s);
  if (rm) {
    const a = parsePoint(rm[1]);
    const b = parsePoint(rm[2]);
    if (a && b) {
      const min = first(a);
      const max = last(b);
      const decade = !a.m && !b.m && a.y % 10 === 0 && b.y === a.y + 9;
      return {
        raw, min, max, sort: midpoint(min, max),
        precision: decade ? "decade" : "range",
        qualifier: "between",
        year: Math.round((a.y + b.y) / 2),
      };
    }
  }
  // FROM x / TO x alone.
  s = s.replace(/^(FROM|TO)\s+/, "");

  // "1850S" decade
  const dm = /^(\d{3})0S$/.exec(s);
  if (dm) {
    const y = Number(dm[1]) * 10;
    return { raw, min: `${y}-01-01`, max: `${y + 9}-12-31`, sort: `${y + 5}-01-01`, precision: "decade", qualifier: "about", year: y + 5 };
  }

  let qualifier: DateQualifier = "exact";
  for (const [re, q] of QUALIFIERS) {
    if (re.test(s)) {
      qualifier = q;
      s = s.replace(re, "");
      break;
    }
  }

  const p = parsePoint(s);
  if (!p) return { ...empty, qualifier };
  const min = first(p);
  const max = last(p);
  const base: NormalizedDate = { raw, min, max, sort: min, precision: precisionOf(p), qualifier, year: p.y };
  if (qualifier === "before") return { ...base, min: null, sort: max };
  if (qualifier === "after") return { ...base, max: null };
  return base;
}

function midpoint(a: string, b: string): string {
  const ms = (Date.parse(a) + Date.parse(b)) / 2;
  return new Date(ms).toISOString().slice(0, 10);
}
