# Progress

Deadline: **December 20, 2026**. Two finished products, one per line (`mom`, `dad`).

## How lines work
A *line* is the set of direct ancestors of one root person, and each line is its own finished product.
Lines are defined in `family.config.json` (`root: { parentOfSelf: "mother" }` or `root: { person: "@I123@" }`).
Ingest runs once over the whole tree. Every later stage runs per line and writes only to `out/<line>/`:

    npm run pipeline -- all --line mom     # Mom's documentary only
    npm run pipeline -- all --line dad     # Dad's documentary only
    npm run pipeline -- all                # both

Later stages should read people through `core/lines.ts` (`linePeople`, `lineFrontier`), which
excludes living people by default. Proposals, scripts, storyboards and renders carry a `line_id`.

## Done
- [x] Phase 1 ingest: GEDCOM → SQLite (people, names, families, events with raw and normalized dates + precision,
      places, sources, citations with `_APID`, media, every `_` custom tag), Ancestry MARR-on-INDI linked to the family
- [x] Date normalization (`abt`, `bef`, `bet … and …`, `2010-2019`, `05/28/1960`, `1850s`, …)
- [x] Living flag (born after 1925, no death/burial/probate record; missing births estimated from relatives; no estimate → living)
- [x] Line split with ahnentafel numbers and generations; per-line summary with frontier → `out/<line>/summary.md`
- [x] Geocoder (Nominatim, 1 req/s, SQLite cache, county/state fallbacks)

## Next
- [ ] Run Phase 1 on the real `data/tree.ged` and review the summary
- [ ] Phase 2 research agent (FamilySearch, Chronicling America, manual-lookup checklist), proposals tagged by line

## Open questions
- Which person in the tree is you? (set `self` in `family.config.json`)
- Each line's `destination` (where the journey ends), e.g. "Waukesha County, Wisconsin"
- Geocoding and research hosts (nominatim.openstreetmap.org, chroniclingamerica.loc.gov, FamilySearch) are blocked
  from the cloud session; these steps need to run on your machine or with the network policy widened.
