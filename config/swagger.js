const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const rootDir = path.join(__dirname, '..');

/** @type {import('swagger-jsdoc').Options} */
const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'TRWM Backend API',
      version: require('../package.json').version,
      description:
        'REST API for TRWM. Secured user routes expect a **Firebase ID token** in `Authorization: Bearer <token>`.',
    },
    servers: [{ url: '/', description: 'Current host' }],
    tags: [
      { name: 'System', description: 'Health and root' },
      { name: 'Users', description: 'Profiles, auth exchange, admin' },
      { name: 'Players', description: 'Player discovery, comments, geo' },
      { name: 'Admin', description: 'API-Football import and moderation' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Firebase **ID token** (JWT) from the client after sign-in. Paste **only** the JWT here — Swagger adds the `Bearer ` prefix automatically. **Important:** clicking Authorize only saves this value in the browser; it does **not** call your API or Firebase. Your token is checked only when you **Execute** a request; invalid values then return 401.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Human-readable message' },
          },
          required: ['error'],
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'MongoDB document id' },
            firebaseUID: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['user', 'admin'] },
            name: { type: 'string', nullable: true },
            avatar: { type: 'string', description: 'Image URL; may be empty string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        SyncUserBody: {
          type: 'object',
          required: ['firebaseUID', 'email'],
          properties: {
            firebaseUID: {
              type: 'string',
              description: 'Must match the uid in the Firebase ID token.',
            },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            avatar: { type: 'string', description: 'Optional profile image URL' },
          },
        },
        UpdateProfileBody: {
          type: 'object',
          description: 'At least one field required.',
          properties: {
            name: { type: 'string' },
            avatar: { type: 'string', description: 'Empty string clears avatar' },
          },
        },
        PatchRoleBody: {
          type: 'object',
          required: ['role'],
          properties: {
            role: { type: 'string', enum: ['user', 'admin'] },
          },
        },
        ImportPlayersBody: {
          type: 'object',
          required: ['leagueId', 'teamId', 'season'],
          properties: {
            leagueId: { type: 'integer', description: 'API-Football league id' },
            teamId: { type: 'integer', description: 'API-Football team id' },
            season: { type: 'integer', description: 'Season year (e.g. 2023)' },
            externalIds: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Optional API-Football player ids to import; when omitted, imports the full squad',
            },
          },
        },
        AddCommentBody: {
          type: 'object',
          required: ['text', 'rating', 'lat', 'lng'],
          properties: {
            text: { type: 'string', maxLength: 1000 },
            rating: { type: 'number', minimum: 0, maximum: 5 },
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
          },
        },
      },
    },
  },
  apis: [
    path.join(rootDir, 'app.js'),
    path.join(rootDir, 'routes', 'index.js'),
    path.join(rootDir, 'routes', 'userRoutes.js'),
    path.join(rootDir, 'routes', 'adminRoutes.js'),
    path.join(rootDir, 'routes', 'playerRoutes.js'),
  ],
};

let specCache;

function buildSwaggerSpec() {
  if (!specCache) {
    specCache = swaggerJsdoc(options);
  }
  return specCache;
}

module.exports = { buildSwaggerSpec };
