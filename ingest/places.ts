/** Place-name cleanup so the same town spelled two ways geocodes once. */

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "United States", "u.s.a.": "United States", "us": "United States", "u.s.": "United States",
  "united states of america": "United States", "america": "United States",
  "deutschland": "Germany", "preussen": "Prussia", "preußen": "Prussia",
  "norge": "Norway", "sverige": "Sweden", "danmark": "Denmark",
  "england, uk": "England", "uk": "United Kingdom",
};

export function normalizePlace(raw: string): string {
  const parts = raw
    .split(",")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((p) => {
      const lower = p.toLowerCase();
      if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
      if (/^[A-Z]{2}$/.test(p) && US_STATES[p]) return US_STATES[p];
      return p;
    });
  // Ancestry often appends a redundant "USA" after a state; keep it as "United States" for the geocoder.
  return parts.join(", ");
}

/** Successively coarser queries to try when the full place doesn't geocode ("Town, County, State" → "County, State"). */
export function geocodeFallbacks(normalized: string): string[] {
  const parts = normalized.split(", ");
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join(", "));
  if (parts.length === 1) out.push(normalized);
  return out;
}
