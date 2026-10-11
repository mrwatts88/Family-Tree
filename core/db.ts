import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;

/**
 * Tables fall into three layers:
 *  - GEDCOM layer: rebuilt from the export on every ingest (people, events, ...).
 *  - Durable layer: survives re-ingest (geocode cache, manual media links, and later candidates/approved).
 *  - Line layer: which people belong to which line, recomputed on every ingest.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  given TEXT,
  surname TEXT,
  full_name TEXT NOT NULL,
  sex TEXT,
  birth_year INTEGER,
  death_year INTEGER,
  estimated_birth_year INTEGER,
  has_death_evidence INTEGER NOT NULL DEFAULT 0,
  is_living INTEGER NOT NULL DEFAULT 0,
  living_reason TEXT,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS names (
  person_id TEXT NOT NULL REFERENCES people(id),
  given TEXT,
  surname TEXT,
  type TEXT,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  husband_id TEXT,
  wife_id TEXT,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS family_children (
  family_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  pedigree TEXT,
  PRIMARY KEY (family_id, child_id)
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY,
  raw TEXT NOT NULL UNIQUE,
  normalized TEXT NOT NULL,
  lat REAL,
  lon REAL,
  geocode_query TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  person_id TEXT,
  family_id TEXT,
  tag TEXT NOT NULL,
  type TEXT,
  value TEXT,
  date_raw TEXT,
  date_sort TEXT,
  date_min TEXT,
  date_max TEXT,
  date_precision TEXT,
  date_qualifier TEXT,
  place_id INTEGER REFERENCES places(id),
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  title TEXT,
  author TEXT,
  publication TEXT,
  repository TEXT,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS citations (
  id INTEGER PRIMARY KEY,
  source_id TEXT,
  person_id TEXT,
  family_id TEXT,
  event_id INTEGER,
  page TEXT,
  apid TEXT,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  file TEXT,
  form TEXT,
  title TEXT,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_links (
  media_id TEXT NOT NULL,
  person_id TEXT,
  family_id TEXT,
  event_id INTEGER
);
CREATE TABLE IF NOT EXISTS custom_tags (
  record_id TEXT NOT NULL,
  path TEXT NOT NULL,
  tag TEXT NOT NULL,
  value TEXT
);

-- Durable layer
CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- 'ok' | 'not_found'
  lat REAL,
  lon REAL,
  display_name TEXT,
  fetched_at TEXT NOT NULL,
  raw TEXT
);
CREATE TABLE IF NOT EXISTS manual_media_links (
  file TEXT NOT NULL,            -- path under data/media/
  person_id TEXT NOT NULL,
  caption TEXT,
  PRIMARY KEY (file, person_id)
);

-- Line layer
CREATE TABLE IF NOT EXISTS lines (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  root_person_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS line_members (
  line_id TEXT NOT NULL REFERENCES lines(id),
  person_id TEXT NOT NULL,
  ahnentafel INTEGER NOT NULL,   -- 1 = line root, 2 = root's father, 3 = root's mother, ...
  generation INTEGER NOT NULL,   -- generations above you: parent = 1, grandparent = 2
  PRIMARY KEY (line_id, ahnentafel)
);

CREATE INDEX IF NOT EXISTS events_person ON events(person_id);
CREATE INDEX IF NOT EXISTS events_family ON events(family_id);
CREATE INDEX IF NOT EXISTS family_children_child ON family_children(child_id);
CREATE INDEX IF NOT EXISTS line_members_person ON line_members(person_id);
`;

/** In delete order: rows that reference others go first. */
export const GEDCOM_TABLES = [
  "custom_tags", "media_links", "media", "citations", "sources",
  "events", "places", "family_children", "families", "names", "people",
];

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}
