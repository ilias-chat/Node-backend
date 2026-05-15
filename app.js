const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const createRootRouter = require('./routes');
const { buildSwaggerSpec } = require('./config/swagger');

function parseCorsOrigins() {
  const raw = process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGINS || '';
  if (!raw.trim()) {
    return ['http://localhost:4200', 'http://127.0.0.1:4200', 'ionic://localhost', 'capacitor://localhost'];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {{ verifyIdToken?: (token: string) => Promise<{ uid: string, email?: string }>, apiFootballService?: object }} [options] Test-only overrides (Firebase verify, API-Football service mock).
 */
function createApp(options = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const corsOrigins = parseCorsOrigins();
  app.use(
    cors({
      origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
      credentials: true,
    })
  );

  app.use(express.json());

  const swaggerSpec = buildSwaggerSpec();
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });

  /**
   * @openapi
   * /health:
   *   get:
   *     tags: [System]
   *     summary: Liveness probe
   *     responses:
   *       '200':
   *         description: Service is up
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *               example: ok
   */
  app.get('/health', (_req, res) => {
    res.status(200).type('text').send('ok');
  });

  const rootRoutes = createRootRouter(options);
  app.use('/', rootRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).type('application/json').json({ error: 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
