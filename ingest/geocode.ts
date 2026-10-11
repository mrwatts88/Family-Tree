import type { DB } from "../core/db.js";
import { geocodeFallbacks } from "./places.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100; // Nominatim policy: at most 1 request per second.

interface CacheRow { status: string; lat: number | null; lon: number | null }

/**
 * Geocodes every place via OpenStreetMap Nominatim, caching each query in
 * SQLite so re-runs (and re-ingests) never repeat a lookup. Falls back to
 * coarser queries (county, then state) when a small town isn't found.
 */
export async function geocodePlaces(db: DB, opts: { contact?: string; offline?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const getCache = db.prepare(`SELECT status, lat, lon FROM geocode_cache WHERE query = ?`);
  const putCache = db.prepare(`INSERT OR REPLACE INTO geocode_cache (query, status, lat, lon, display_name, fetched_at, raw) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const setPlace = db.prepare(`UPDATE places SET lat = ?, lon = ?, geocode_query = ? WHERE id = ?`);
  const places = db.prepare(`SELECT id, normalized FROM places WHERE lat IS NULL`).all() as { id: number; normalized: string }[];

  if (!opts.offline && !opts.contact) {
    throw new Error("Set GEOCODER_CONTACT in .env (an email); Nominatim requires a contact in the User-Agent.");
  }

  let lastRequest = 0;
  const lookup = async (query: string): Promise<CacheRow | null> => {
    const cached = getCache.get(query) as CacheRow | undefined;
    if (cached) return cached;
    if (opts.offline) return null;
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const url = `${NOMINATIM}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "1" })}`;
    const res = await fetch(url, { headers: { "User-Agent": `family-tree-documentary (${opts.contact})` } });
    if (!res.ok) throw new Error(`Nominatim ${res.status} for "${query}"`);
    const body = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const hit = body[0];
    const row: CacheRow = hit ? { status: "ok", lat: Number(hit.lat), lon: Number(hit.lon) } : { status: "not_found", lat: null, lon: null };
    putCache.run(query, row.status, row.lat, row.lon, hit?.display_name ?? null, new Date().toISOString(), JSON.stringify(body));
    return row;
  };

  let found = 0, missing = 0, pending = 0;
  for (const place of places) {
    let resolved = false;
    let uncached = false;
    for (const q of geocodeFallbacks(place.normalized)) {
      const r = await lookup(q);
      if (!r) { uncached = true; break; }
      if (r.status === "ok") {
        setPlace.run(r.lat, r.lon, q, place.id);
        resolved = true;
        break;
      }
    }
    if (resolved) found++;
    else if (uncached) pending++;
    else { missing++; log(`  not found: ${place.normalized}`); }
  }
  log(`Geocoded ${found} places, ${missing} not found${pending ? `, ${pending} skipped (offline, not cached)` : ""}.`);
}
