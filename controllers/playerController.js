const mongoose = require('mongoose');
const Player = require('../models/Player');
const { escapeRegex } = require('../utils/escapeRegex');

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

module.exports = {
  listPlayers,
  searchPlayers,
  getPlayerById,
  nearbyPlayers,
};
