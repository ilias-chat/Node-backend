const mongoose = require('mongoose');
const Player = require('../models/Player');
const { escapeRegex } = require('../utils/escapeRegex');
const { ApiFootballError } = require('../services/apiFootballService');

const VALID_POSITIONS = new Set(['Attacker', 'Midfielder', 'Defender', 'Goalkeeper']);
const MAX_IMAGE_CHARS = 2_800_000;

/**
 * @param {unknown} image
 * @returns {string|undefined|null}
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

/** Fields written on import upsert (`image` only when API-Football provides a photo URL). */
function buildPlayerImportSet(doc) {
  const set = {
    name: doc.name,
    team: doc.team,
    league: doc.league,
    externalId: doc.externalId,
    position: doc.position,
    stats: doc.stats,
    venueName: doc.venueName,
    location: doc.location,
  };
  if (doc.image) {
    set.image = doc.image;
  }
  return set;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ buildImportPayloads: (p: { leagueId: number, teamId: number, season: number }) => Promise<{ players: object[], teamName: string, leagueName: string, venueName: string }> }} apiFootballService
 */
async function importPlayers(req, res, next, apiFootballService) {
  try {
    const { leagueId, teamId, season, externalIds } = req.body || {};
    if (leagueId == null || teamId == null || season == null) {
      return res.status(400).json({ error: 'leagueId, teamId, and season are required' });
    }

    const { players: allPlayers, teamName, leagueName, venueName } = await apiFootballService.buildImportPayloads({
      leagueId: Number(leagueId),
      teamId: Number(teamId),
      season: Number(season),
    });

    let players = allPlayers;
    if (externalIds != null) {
      if (!Array.isArray(externalIds) || externalIds.length === 0) {
        return res.status(400).json({ error: 'externalIds must be a non-empty array of player ids' });
      }
      const idSet = new Set(externalIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
      players = allPlayers.filter((doc) => idSet.has(doc.externalId));
      if (players.length === 0) {
        return res.status(400).json({ error: 'No matching players for the given externalIds' });
      }
    }

    if (players.length === 0) {
      return res.status(200).json({
        inserted: 0,
        updated: 0,
        matched: 0,
        teamName,
        leagueName,
        venueName,
        message: 'No players returned for this squad',
      });
    }

    const ops = players.map((doc) => ({
      updateOne: {
        filter: { externalId: doc.externalId },
        update: {
          $set: buildPlayerImportSet(doc),
          $setOnInsert: { registrationDate: new Date() },
        },
        upsert: true,
      },
    }));

    const result = await Player.bulkWrite(ops, { ordered: false });
    const inserted = result.upsertedCount ?? 0;
    const updated = result.modifiedCount ?? 0;
    const matched = result.matchedCount ?? 0;

    return res.status(200).json({
      inserted,
      updated,
      matched,
      teamName,
      leagueName,
      venueName,
      playersProcessed: players.length,
    });
  } catch (err) {
    if (err instanceof ApiFootballError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ resolveTeamStadiumContext: (p: { leagueId: number, teamId: number, season: number }) => Promise<{ teamName: string, leagueName: string, venueName: string, location: object }> }} apiFootballService
 */
async function updatePlayer(req, res, next, apiFootballService) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid player id' });
    }

    const existing = await Player.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Player not found' });
    }

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

    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({ error: 'lat and lng must be valid coordinates' });
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

    const { teamName, leagueName, venueName } = ctx;
    const location = { type: 'Point', coordinates: [lng, lat] };

    const duplicate = await Player.findOne({
      _id: { $ne: id },
      name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i'),
      team: new RegExp(`^${escapeRegex(teamName)}$`, 'i'),
    }).lean();
    if (duplicate) {
      return res.status(409).json({ error: 'A player with this name already exists on this team' });
    }

    /** @type {Record<string, unknown>} */
    const update = {
      name: trimmedName,
      position,
      team: teamName,
      league: leagueName,
      venueName,
      location,
    };
    if (normalizedImage) {
      update.image = normalizedImage;
    }

    const updated = await Player.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    return res.json(updated);
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

async function deletePlayer(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid player id' });
    }
    const deleted = await Player.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Player not found' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ fetchLeaguesForSeason: (season: number) => Promise<object[]>, fetchTeamsForLeague: (leagueId: number, season: number) => Promise<object[]> }} apiFootballService
 */
async function listLeagues(req, res, next, apiFootballService) {
  try {
    const season = Number(req.query.season);
    if (!Number.isFinite(season)) {
      return res.status(400).json({ error: 'season query parameter must be a number' });
    }
    const data = await apiFootballService.fetchLeaguesForSeason(season);
    return res.json({ data });
  } catch (err) {
    if (err instanceof ApiFootballError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ fetchTeamsForLeague: (leagueId: number, season: number) => Promise<object[]> }} apiFootballService
 */
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ buildImportPayloads: (p: { leagueId: number, teamId: number, season: number }) => Promise<{ players: object[], teamName: string, leagueName: string }> }} apiFootballService
 */
async function listSquadPlayers(req, res, next, apiFootballService) {
  try {
    const leagueId = Number(req.query.leagueId);
    const teamId = Number(req.query.teamId);
    const season = Number(req.query.season);
    if (!Number.isFinite(leagueId) || !Number.isFinite(teamId) || !Number.isFinite(season)) {
      return res.status(400).json({ error: 'leagueId, teamId, and season query parameters must be numbers' });
    }
    const { players, teamName, leagueName } = await apiFootballService.buildImportPayloads({
      leagueId,
      teamId,
      season,
    });
    const data = players.map((p) => ({
      externalId: p.externalId,
      name: p.name,
      position: p.position,
      image: p.image,
    }));
    return res.json({ data, teamName, leagueName });
  } catch (err) {
    if (err instanceof ApiFootballError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {{ fetchTeamsForLeague: (leagueId: number, season: number) => Promise<object[]> }} apiFootballService
 */
async function listTeams(req, res, next, apiFootballService) {
  try {
    const leagueId = Number(req.query.leagueId);
    const season = Number(req.query.season);
    if (!Number.isFinite(leagueId) || !Number.isFinite(season)) {
      return res.status(400).json({ error: 'leagueId and season query parameters must be numbers' });
    }
    const data = await apiFootballService.fetchTeamsForLeague(leagueId, season);
    return res.json({ data });
  } catch (err) {
    if (err instanceof ApiFootballError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  importPlayers,
  updatePlayer,
  deletePlayer,
  listLeagues,
  listTeams,
  listSquadPlayers,
};
