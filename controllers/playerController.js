const mongoose = require('mongoose');
const Player = require('../models/Player');
const { escapeRegex } = require('../utils/escapeRegex');
const { ApiFootballError } = require('../services/apiFootballService');

const VALID_POSITIONS = new Set(['Attacker', 'Midfielder', 'Defender', 'Goalkeeper']);
const MAX_IMAGE_CHARS = 2_800_000;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const EARTH_RADIUS_KM = 6378.1;

function parsePositiveInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function parseLimit(v) {
  const n = parsePositiveInt(v, DEFAULT_LIMIT);
  return Math.min(n, MAX_LIMIT);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function listPlayers(req, res, next) {
  try {
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = parseLimit(req.query.limit);
    const skip = (page - 1) * limit;

    /** @type {import('mongoose').FilterQuery<typeof Player>} */
    const filter = {};
    if (req.query.team != null && String(req.query.team).trim() !== '') {
      const t = String(req.query.team).trim();
      filter.team = new RegExp(escapeRegex(t), 'i');
    }
    if (req.query.position != null && String(req.query.position).trim() !== '') {
      const p = String(req.query.position).trim();
      filter.position = new RegExp(escapeRegex(p), 'i');
    }

    const [total, items] = await Promise.all([
      Player.countDocuments(filter),
      Player.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    ]);

    return res.json({
      data: items,
      page,
      limit,
      total,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function searchPlayers(req, res, next) {
  try {
    const q = req.query.q != null ? String(req.query.q).trim() : '';
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = parseLimit(req.query.limit);
    const skip = (page - 1) * limit;

    const filter = { name: new RegExp(escapeRegex(q), 'i') };
    const [total, items] = await Promise.all([
      Player.countDocuments(filter),
      Player.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    ]);

    return res.json({
      data: items,
      page,
      limit,
      total,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getPlayerById(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid player id' });
    }
    const player = await Player.findById(id).lean();
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    return res.json(player);
  } catch (err) {
    return next(err);
  }
}

function roundCoord(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function nearbyPlayers(req, res, next) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    let radiusKm = Number(req.query.radiusKm);
    if (!Number.isFinite(radiusKm)) {
      const distanceMeters = Number(req.query.distance);
      if (Number.isFinite(distanceMeters) && distanceMeters > 0) {
        radiusKm = distanceMeters / 1000;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) {
      return res.status(400).json({
        error: 'lat, lng, and radiusKm (or distance in meters) must be finite numbers',
      });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'lat or lng out of range' });
    }
    if (radiusKm <= 0 || radiusKm > 5000) {
      return res.status(400).json({ error: 'radiusKm must be between 0 and 5000' });
    }

    const radiusRad = radiusKm / EARTH_RADIUS_KM;
    const players = await Player.find({
      location: {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusRad],
        },
      },
    })
      .sort({ name: 1 })
      .lean();

    /** @type {Map<string, { name: string, location: { type: 'Point', coordinates: [number, number] } }} */
    const stadiumMap = new Map();
    for (const p of players) {
      const name = p.venueName || p.team || 'Unknown venue';
      if (!p.location?.coordinates || p.location.coordinates.length !== 2) continue;
      const [plng, plat] = p.location.coordinates;
      const key = `${name}|${roundCoord(plng, 5)}|${roundCoord(plat, 5)}`;
      if (!stadiumMap.has(key)) {
        stadiumMap.set(key, {
          name,
          location: {
            type: 'Point',
            coordinates: [plng, plat],
          },
        });
      }
    }

    return res.json({
      players,
      stadiums: [...stadiumMap.values()],
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * @param {unknown} image
 * @returns {string|undefined}
 */
function normalizeBase64Image(image) {
  if (image == null || image === '') return undefined;
  const s = String(image).trim();
  if (!s) return undefined;
  if (s.length > MAX_IMAGE_CHARS) {
    return null;
  }
  if (s.startsWith('data:image/')) return s;
  if (/^[A-Za-z0-9+/=]+$/.test(s)) {
    return `data:image/jpeg;base64,${s}`;
  }
  return undefined;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ resolveTeamStadiumContext: (p: { leagueId: number, teamId: number, season: number }) => Promise<{ teamName: string, leagueName: string, venueName: string, location: object }> }} apiFootballService
 */
async function createPlayer(req, res, next, apiFootballService) {
  try {
    const { name, position, leagueId, teamId, season, image } = req.body || {};
    const trimmedName = name != null ? String(name).trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!VALID_POSITIONS.has(position)) {
      return res.status(400).json({
        error: 'position must be one of: Attacker, Midfielder, Defender, Goalkeeper',
      });
    }
    const lid = Number(leagueId);
    const tid = Number(teamId);
    const seasonNum = Number(season);
    if (!Number.isFinite(lid) || !Number.isFinite(tid) || !Number.isFinite(seasonNum)) {
      return res.status(400).json({ error: 'leagueId, teamId, and season must be numbers' });
    }

    const normalizedImage = normalizeBase64Image(image);
    if (image != null && image !== '' && normalizedImage == null) {
      return res.status(400).json({ error: 'image must be a valid base64 photo under 2MB' });
    }

    const ctx = await apiFootballService.resolveTeamStadiumContext({
      leagueId: lid,
      teamId: tid,
      season: seasonNum,
    });

    let location = ctx.location;
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const hasDeviceCoords =
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;
    if (!location && hasDeviceCoords) {
      location = { type: 'Point', coordinates: [lng, lat] };
    }
    if (!location) {
      return res.status(422).json({
        error:
          'Could not resolve stadium coordinates for this team. Enable location on your device and try again.',
      });
    }

    const { teamName, leagueName, venueName } = ctx;

    const duplicate = await Player.findOne({
      name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i'),
      team: new RegExp(`^${escapeRegex(teamName)}$`, 'i'),
    }).lean();
    if (duplicate) {
      return res.status(409).json({ error: 'A player with this name already exists on this team' });
    }

    const doc = {
      name: trimmedName,
      position,
      team: teamName,
      league: leagueName,
      venueName,
      location,
      registrationDate: new Date(),
    };
    if (normalizedImage) {
      doc.image = normalizedImage;
    }

    const created = await Player.create(doc);
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof ApiFootballError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A player with this name already exists on this team' });
    }
    return next(err);
  }
}

module.exports = {
  listPlayers,
  searchPlayers,
  getPlayerById,
  nearbyPlayers,
  createPlayer,
};
