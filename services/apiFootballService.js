/**
 * API-Football (api-sports) v3 client and import helpers.
 * @see https://www.api-football.com/documentation-v3
 */

const DEFAULT_BASE = 'https://v3.football.api-sports.io';

class ApiFootballError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode=502]
   */
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'ApiFootballError';
    this.statusCode = statusCode;
  }
}

/**
 * Parse a latitude or longitude from API-Football (often strings, sometimes empty).
 * @param {unknown} v
 * @param {'lat' | 'lng'} kind
 * @returns {number|null}
 */
function parseGeoCoord(v, kind) {
  if (v == null) return null;
  const raw = typeof v === 'string' ? v.trim() : v;
  if (raw === '' || raw === 'null' || raw === 'undefined') return null;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  if (kind === 'lat' && (n < -90 || n > 90)) return null;
  if (kind === 'lng' && (n < -180 || n > 180)) return null;
  return n;
}

/**
 * @param {Record<string, unknown>} o venue-like object from /teams or /venues
 * @returns {{ lat: number, lng: number } | null}
 */
function extractVenueCoords(o) {
  if (!o || typeof o !== 'object') return null;
  const lat = parseGeoCoord(o.lat ?? o.latitude, 'lat');
  const lng = parseGeoCoord(o.lng ?? o.longitude ?? o.lon, 'lng');
  if (lat != null && lng != null) {
    return { lat, lng };
  }
  const c = o.coordinates;
  if (Array.isArray(c) && c.length >= 2) {
    const lng2 = parseGeoCoord(c[0], 'lng');
    const lat2 = parseGeoCoord(c[1], 'lat');
    if (lat2 != null && lng2 != null) return { lat: lat2, lng: lng2 };
  }
  return null;
}

/**
 * @param {{ apiKey?: string, baseUrl?: string, fetch?: typeof fetch }} [cfg]
 */
/**
 * Map one API-Football `/players` response row to a Mongo import document.
 * API-Football exposes headshots on `player.photo` (https URL).
 * @param {unknown} row
 * @param {string} teamName
 * @param {string} leagueName
 * @param {string} venueName
 * @param {{ type: 'Point', coordinates: [number, number] }} location
 */
/**
 * @param {unknown} url
 * @returns {string|undefined}
 */
function normalizeLogoUrl(url) {
  if (url == null) return undefined;
  const s = String(url).trim();
  if (!s || s === 'null') return undefined;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return undefined;
}

/**
 * Curated top competitions (API-Football league ids), display order.
 * @see https://www.api-football.com/documentation-v3
 */
const TOP_LEAGUE_IDS = [
  39, // Premier League
  140, // La Liga
  135, // Serie A
  78, // Bundesliga
  61, // Ligue 1
  2, // UEFA Champions League
  3, // UEFA Europa League
  88, // Eredivisie
  94, // Primeira Liga
  40, // Championship
];

/**
 * Keep only top leagues, in curated order (max 10).
 * @param {{ id: number, name: string, logo?: string, country?: string, type?: string }[]} leagues
 */
function filterTopLeagues(leagues) {
  const byId = new Map(leagues.map((l) => [l.id, l]));
  const result = [];
  for (const id of TOP_LEAGUE_IDS) {
    const league = byId.get(id);
    if (league) result.push(league);
  }
  return result;
}

/**
 * @param {unknown[]} rows
 * @returns {{ id: number, name: string, logo?: string, country?: string, type?: string }[]}
 */
function mapLeagueRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    const league = row?.league;
    if (!league?.id) continue;
    const id = Number(league.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    const name = league.name ? String(league.name) : `League ${id}`;
    const logo =
      normalizeLogoUrl(league.logo) ?? normalizeLogoUrl(row?.country?.flag);
    const country = row?.country?.name ? String(row.country.name) : undefined;
    seen.set(id, {
      id,
      name,
      logo,
      country,
      type: league.type ? String(league.type) : undefined,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {unknown[]} rows
 * @returns {{ id: number, name: string, logo?: string }[]}
 */
function mapTeamRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    const team = row?.team;
    if (!team?.id) continue;
    const id = Number(team.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.set(id, {
      id,
      name: team.name ? String(team.name) : `Team ${id}`,
      logo: normalizeLogoUrl(team.logo),
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mapImportPlayerRow(row, teamName, leagueName, venueName, location) {
  const p = row?.player;
  if (!p || p.id == null) return null;
  const externalId = Number(p.id);
  if (!Number.isFinite(externalId)) return null;

  const stats = row?.statistics != null ? row.statistics : undefined;
  let position;
  if (Array.isArray(row?.statistics) && row.statistics[0]?.games?.position != null) {
    position = String(row.statistics[0].games.position);
  } else if (p.position != null) {
    position = String(p.position);
  } else {
    position = 'Unknown';
  }

  const name = p.name ? String(p.name) : `Player ${externalId}`;
  const image = p.photo ? String(p.photo).trim() : undefined;

  return {
    name,
    team: teamName,
    league: leagueName,
    image: image || undefined,
    externalId,
    position,
    stats,
    venueName,
    location,
  };
}

/** @type {Map<string, { at: number, data: object }>} */
const importPayloadCache = new Map();
const IMPORT_PAYLOAD_CACHE_TTL_MS = 5 * 60 * 1000;

function importPayloadCacheKey(leagueId, teamId, season) {
  return `${leagueId}:${teamId}:${season}`;
}

function createApiFootballService(cfg = {}) {
  const apiKey = cfg.apiKey ?? process.env.API_FOOTBALL_KEY;
  const baseUrl = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const fetchImpl = cfg.fetch ?? globalThis.fetch;
  const cacheTtlMs = cfg.importCacheTtlMs ?? IMPORT_PAYLOAD_CACHE_TTL_MS;

  if (!apiKey) {
    throw new Error('API_FOOTBALL_KEY is not set');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available; pass fetch in options');
  }

  /**
   * @param {string} path
   * @param {Record<string, string | number>} [query]
   */
  async function request(path, query = {}) {
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { 'x-apisports-key': apiKey },
    });
    if (!res.ok) {
      const status = res.status >= 400 && res.status < 600 ? res.status : 502;
      const hint =
        status === 429
          ? 'API-Football rate limit reached. Wait a minute and try again, or avoid reloading the squad list before import.'
          : undefined;
      const message = hint ? `API-Football HTTP ${status}. ${hint}` : `API-Football HTTP ${res.status}`;
      throw new ApiFootballError(message, status);
    }
    /** @type {{ errors?: { message?: string }[], paging?: { current?: number, total?: number }, response?: unknown }} */
    const data = await res.json();
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const msg = data.errors.map((e) => e?.message || String(e)).join('; ');
      throw new ApiFootballError(msg || 'API-Football returned errors', 422);
    }
    return data;
  }

  /**
   * @param {number} teamId
   * @param {number} leagueId
   * @param {number} season
   */
  async function assertLeagueBelongsToTeam(teamId, leagueId, season) {
    const data = await request('/leagues', { team: teamId, season });
    const rows = Array.isArray(data.response) ? data.response : [];
    const ok = rows.some((row) => {
      const lid = row?.league?.id;
      return Number(lid) === Number(leagueId);
    });
    if (!ok) {
      throw new ApiFootballError(
        `League ${leagueId} is not associated with team ${teamId} for season ${season}`,
        422
      );
    }
    const match = rows.find((row) => Number(row?.league?.id) === Number(leagueId));
    const leagueName = match?.league?.name ? String(match.league.name) : `League ${leagueId}`;
    return { leagueName };
  }

  /**
   * @param {number} teamId
   */
  async function fetchTeam(teamId) {
    const data = await request('/teams', { id: teamId });
    const row = Array.isArray(data.response) ? data.response[0] : null;
    if (!row?.team) {
      throw new ApiFootballError(`Team ${teamId} not found`, 404);
    }
    const venue = row.venue && typeof row.venue === 'object' ? row.venue : {};
    const team = row.team && typeof row.team === 'object' ? row.team : {};
    const venueId = venue.id != null ? Number(venue.id) : null;
    const venueName = venue.name ? String(venue.name) : team.name ? String(team.name) : '';
    const teamName = team.name ? String(team.name) : `Team ${teamId}`;
    const embeddedCoords = extractVenueCoords(/** @type {Record<string, unknown>} */ (venue));
    const city = venue.city != null ? String(venue.city) : team.city != null ? String(team.city) : '';
    const country = team.country != null ? String(team.country) : '';
    return {
      teamName,
      venueId: venueId != null && Number.isFinite(venueId) ? venueId : null,
      venueName: venueName || teamName,
      embeddedCoords,
      geocodeHint: { city, country },
    };
  }

  /**
   * @param {number} venueId
   * @returns {{ lng: number, lat: number, venueName: string }}
   */
  async function fetchVenuePoint(venueId) {
    const data = await request('/venues', { id: venueId });
    const row = Array.isArray(data.response) ? data.response[0] : null;
    const coords = row && typeof row === 'object' ? extractVenueCoords(/** @type {Record<string, unknown>} */ (row)) : null;
    if (!coords) {
      throw new ApiFootballError(`Venue ${venueId} has no coordinates`, 422);
    }
    const name = row?.name ? String(row.name) : '';
    return {
      lng: coords.lng,
      lat: coords.lat,
      venueName: name,
    };
  }

  /**
   * Fallback when API-Football omits venue coordinates (common on some tiers/venues).
   * Uses OpenStreetMap Nominatim (one request per import). Respect their usage policy.
   * @param {{ city: string, country: string }} hint
   * @param {string} venueName
   */
  async function geocodeVenueNominatim(hint, venueName) {
    const parts = [venueName, hint.city, hint.country].filter((s) => s && String(s).trim());
    const q = parts.join(', ').trim();
    if (!q) {
      throw new ApiFootballError('Cannot geocode venue: missing name and location hint', 422);
    }
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', q);

    const res = await fetchImpl(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TRWM-backend/1.0 (venue geocode fallback; https://github.com/)',
      },
    });
    if (!res.ok) {
      throw new ApiFootballError(`Geocoding HTTP ${res.status}`, 502);
    }
    /** @type {{ lat?: string, lon?: string }[]} */
    const arr = await res.json();
    const first = Array.isArray(arr) ? arr[0] : null;
    const lat = first?.lat != null ? parseGeoCoord(first.lat, 'lat') : null;
    const lng = first?.lon != null ? parseGeoCoord(first.lon, 'lng') : null;
    if (lat == null || lng == null) {
      throw new ApiFootballError(
        `Venue coordinates unavailable from API-Football and geocoding found no match for: ${q}`,
        422
      );
    }
    return { lat, lng, venueName };
  }

  /**
   * @param {number} teamId
   * @param {number} season
   * @returns {Promise<unknown[]>}
   */
  async function fetchAllPlayersPages(teamId, season) {
    const all = [];
    let page = 1;
    let totalPages = 1;
    for (;;) {
      const data = await request('/players', { team: teamId, season, page });
      const chunk = Array.isArray(data.response) ? data.response : [];
      all.push(...chunk);
      totalPages = data.paging?.total ?? 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return all;
  }

  /**
   * Resolve league/team names and stadium GeoJSON for imports and manual player create.
   * @param {{ leagueId: number, teamId: number, season: number }} params
   */
  async function resolveTeamStadiumContext(params) {
    const leagueId = Number(params.leagueId);
    const teamId = Number(params.teamId);
    const season = Number(params.season);
    if (![leagueId, teamId, season].every((n) => Number.isFinite(n))) {
      throw new ApiFootballError('leagueId, teamId, and season must be finite numbers', 400);
    }

    const { leagueName } = await assertLeagueBelongsToTeam(teamId, leagueId, season);
    const teamRow = await fetchTeam(teamId);
    let venueLabel = teamRow.venueName;
    let coords = teamRow.embeddedCoords;
    if (!coords && teamRow.venueId != null && Number.isFinite(teamRow.venueId)) {
      try {
        const pt = await fetchVenuePoint(teamRow.venueId);
        coords = { lat: pt.lat, lng: pt.lng };
        if (pt.venueName) venueLabel = pt.venueName;
      } catch (err) {
        const missingCoords =
          err instanceof ApiFootballError &&
          err.statusCode === 422 &&
          /no coordinates/i.test(err.message);
        if (!missingCoords) {
          throw err;
        }
        const geo = await geocodeVenueNominatim(teamRow.geocodeHint, teamRow.venueName);
        coords = { lat: geo.lat, lng: geo.lng };
      }
    }

    const location = coords
      ? { type: 'Point', coordinates: [coords.lng, coords.lat] }
      : null;
    return {
      teamName: teamRow.teamName,
      leagueName,
      venueName: venueLabel,
      location,
    };
  }

  /**
   * @param {{ leagueId: number, teamId: number, season: number }} params
   */
  async function buildImportPayloads(params) {
    const leagueId = Number(params.leagueId);
    const teamId = Number(params.teamId);
    const season = Number(params.season);
    const cacheKey = importPayloadCacheKey(leagueId, teamId, season);
    const cached = importPayloadCache.get(cacheKey);
    if (cached && Date.now() - cached.at < cacheTtlMs) {
      return cached.data;
    }

    const ctx = await resolveTeamStadiumContext(params);
    if (!ctx.location) {
      throw new ApiFootballError(
        'Could not resolve stadium coordinates (no coords on team venue, and no venue id for /venues or geocode)',
        422
      );
    }
    const { teamName, leagueName, venueName, location } = ctx;

    const rawPlayers = await fetchAllPlayersPages(teamId, season);
    const players = [];
    for (const row of rawPlayers) {
      const doc = mapImportPlayerRow(row, teamName, leagueName, venueName, location);
      if (doc) players.push(doc);
    }

    const result = { players, teamName, leagueName, venueName };
    importPayloadCache.set(cacheKey, { at: Date.now(), data: result });
    return result;
  }

  /**
   * @param {number} season
   */
  async function fetchLeaguesForSeason(season) {
    const seasonNum = Number(season);
    if (!Number.isFinite(seasonNum)) {
      throw new ApiFootballError('season must be a finite number', 400);
    }
    const data = await request('/leagues', { season: seasonNum });
    const rows = Array.isArray(data.response) ? data.response : [];
    return filterTopLeagues(mapLeagueRows(rows));
  }

  /**
   * @param {number} leagueId
   * @param {number} season
   */
  async function fetchTeamsForLeague(leagueId, season) {
    const lid = Number(leagueId);
    const seasonNum = Number(season);
    if (!Number.isFinite(lid) || !Number.isFinite(seasonNum)) {
      throw new ApiFootballError('leagueId and season must be finite numbers', 400);
    }
    const data = await request('/teams', { league: lid, season: seasonNum });
    const rows = Array.isArray(data.response) ? data.response : [];
    return mapTeamRows(rows);
  }

  return {
    request,
    assertLeagueBelongsToTeam,
    fetchTeam,
    fetchVenuePoint,
    fetchAllPlayersPages,
    buildImportPayloads,
    resolveTeamStadiumContext,
    fetchLeaguesForSeason,
    fetchTeamsForLeague,
  };
}

let defaultService;

function getApiFootballService() {
  if (!defaultService) {
    defaultService = createApiFootballService();
  }
  return defaultService;
}

module.exports = {
  createApiFootballService,
  getApiFootballService,
  mapImportPlayerRow,
  mapLeagueRows,
  filterTopLeagues,
  TOP_LEAGUE_IDS,
  mapTeamRows,
  ApiFootballError,
};
