import { describe, expect, it } from "vitest";
import { normalizeDate } from "../ingest/gedcom/dates.js";

describe("normalizeDate", () => {
  it.each([
    ["abt 1850", { min: "1850-01-01", max: "1850-12-31", precision: "year", qualifier: "about", year: 1850 }],
    ["2010-2019", { min: "2010-01-01", max: "2019-12-31", precision: "decade", qualifier: "between" }],
    ["05/28/1960", { sort: "1960-05-28", precision: "day", qualifier: "exact" }],
    ["28 MAY 1960", { sort: "1960-05-28", precision: "day" }],
    ["May 1960", { min: "1960-05-01", max: "1960-05-31", precision: "month" }],
    ["BET 1880 AND 1885", { min: "1880-01-01", max: "1885-12-31", precision: "range", year: 1883 }],
    ["BEF 1900", { min: null, max: "1900-12-31", qualifier: "before" }],
    ["AFT 3 FEB 1900", { min: "1900-02-03", max: null, qualifier: "after" }],
    ["Est. 1888", { qualifier: "estimated", year: 1888 }],
    ["1850s", { min: "1850-01-01", max: "1859-12-31", precision: "decade" }],
    ["FROM 1900 TO 1910", { min: "1900-01-01", max: "1910-12-31", qualifier: "between" }],
    ["INT 1900 (about then)", { qualifier: "interpreted", year: 1900 }],
  ])("%s", (raw, expected) => {
    expect(normalizeDate(raw)).toMatchObject(expected);
  });

  it("returns unknown precision for unparseable text", () => {
    expect(normalizeDate("unknown")).toMatchObject({ precision: "unknown", sort: null });
    expect(normalizeDate("")).toMatchObject({ precision: "unknown" });
  });
});
