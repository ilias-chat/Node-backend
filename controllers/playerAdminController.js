const mongoose = require('mongoose');
const Player = require('../models/Player');
const { ApiFootballError } = require('../services/apiFootballService');

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

module.exports = { importPlayers, deletePlayer, listLeagues, listTeams, listSquadPlayers };
