const express = require('express');
const playerAdminController = require('../controllers/playerAdminController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { getApiFootballService } = require('../services/apiFootballService');

/**
 * @param {{ verifyIdToken?: (token: string) => Promise<{ uid: string, email?: string }>, apiFootballService?: object }} [options]
 */
function createAdminRoutes(options = {}) {
  const { verifyFirebaseToken, loadMongoUser, requireAdmin } = createAuthMiddleware(options);

  const router = express.Router();
  const authChain = [verifyFirebaseToken, loadMongoUser];
  const adminChain = [...authChain, requireAdmin];

  function resolveApiFootballService() {
    if (options.apiFootballService) return options.apiFootballService;
    return getApiFootballService();
  }

  /**
   * @openapi
   * /api/admin/import-players:
   *   post:
   *     tags: [Admin]
   *     summary: Import squad from API-Football into MongoDB
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ImportPlayersBody'
   *     responses:
   *       '200':
   *         description: Bulk upsert summary
   *       '400':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '401':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '403':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '404':
   *         description: Team or resource not found from API
   *       '422':
   *         description: API-Football validation or venue data error
   */
  /**
   * @openapi
   * /api/admin/leagues:
   *   get:
   *     tags: [Admin]
   *     summary: List leagues for a season (API-Football)
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: season
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       '200':
   *         description: League options with id, name, logo
   */
  router.get('/leagues', ...authChain, (req, res, next) => {
    let apiFootballService;
    try {
      apiFootballService = resolveApiFootballService();
    } catch (err) {
      return res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return playerAdminController.listLeagues(req, res, next, apiFootballService);
  });

  /**
   * @openapi
   * /api/admin/teams:
   *   get:
   *     tags: [Admin]
   *     summary: List teams for a league and season (API-Football)
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: leagueId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: season
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       '200':
   *         description: Team options with id, name, logo
   */
  router.get('/teams', ...authChain, (req, res, next) => {
    let apiFootballService;
    try {
      apiFootballService = resolveApiFootballService();
    } catch (err) {
      return res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return playerAdminController.listTeams(req, res, next, apiFootballService);
  });

  router.get('/squad-players', ...authChain, (req, res, next) => {
    let apiFootballService;
    try {
      apiFootballService = resolveApiFootballService();
    } catch (err) {
      return res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return playerAdminController.listSquadPlayers(req, res, next, apiFootballService);
  });

  router.post('/import-players', ...authChain, (req, res, next) => {
    let apiFootballService;
    try {
      apiFootballService = resolveApiFootballService();
    } catch (err) {
      return res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return playerAdminController.importPlayers(req, res, next, apiFootballService);
  });

  /**
   * @openapi
   * /api/admin/players/{id}:
   *   delete:
   *     tags: [Admin]
   *     summary: Remove a player from the local database
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       '204':
   *         description: Deleted
   *       '400':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '401':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '403':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '404':
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.patch('/players/:id', ...adminChain, (req, res, next) => {
    let apiFootballService;
    try {
      apiFootballService = resolveApiFootballService();
    } catch (err) {
      return res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return playerAdminController.updatePlayer(req, res, next, apiFootballService);
  });

  router.delete('/players/:id', ...adminChain, playerAdminController.deletePlayer);

  return router;
}

module.exports = createAdminRoutes;
