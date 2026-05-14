const express = require('express');
const swaggerUi = require('swagger-ui-express');
const createRootRouter = require('./routes');
const { buildSwaggerSpec } = require('./config/swagger');

/**
 * @param {{ verifyIdToken?: (token: string) => Promise<{ uid: string, email?: string }> }} [options] Test-only Firebase override.
 */
function createApp(options = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

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
