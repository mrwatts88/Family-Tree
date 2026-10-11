# Family Tree documentaries

Research agent + animated documentaries built from an Ancestry GEDCOM, producing one documentary per family line.
See `PROGRESS.md` for status.

## Setup
    npm install
    cp .env.example .env            # fill in keys
    # save your Ancestry export as data/tree.ged, set "self" in family.config.json
    npm run pipeline -- ingest
    npm run pipeline -- summary --line mom

`data/`, `out/`, and `.env` are git-ignored: family data stays on your machine.

## Layout
- `core/` config, database, line-scoped queries
- `ingest/` Phase 1: GEDCOM parsing, dates, places, geocoding, living flags, line split
- `research/`, `review/`, `story/`, `video/`: Phases 2–5 (to come)
- `out/<line>/`: everything produced for one line
