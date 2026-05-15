# TRWM Backend

REST API for the **TRWM** project: football player data backed by **MongoDB**, identity via **Firebase Authentication**, optional squad imports from **API-Football (API-Sports)**, and a small **social layer** (comments and ratings on players). The service is designed to run locally, in **Docker**, and on **Google Cloud Run**.

---

## What it does

- **Users**: Sync Firebase users into MongoDB, expose profile and role (`user` / `admin`), and protect admin-only user management.
- **Players**: List, search, and fetch player documents (including persisted stats and stadium GeoJSON). **Nearby** queries use MongoDB geospatial indexes (authenticated).
- **Admin**: Import a full squad for a given league, team, and season from API-Football; delete players from the local database.
- **Comments**: Authenticated users add text + rating + location; public read; delete own comment or admin moderation.

Interactive documentation is served at **`/api/docs`** (Swagger UI).

---

## Technologies

| Area | Choice |
|------|--------|
| Runtime | **Node.js** ≥ 18 (Dockerfile uses **20** Alpine) |
| HTTP | **Express** 4.x |
| Database | **MongoDB** via **Mongoose** 8.x |
| Auth | **Firebase Admin SDK** — verifies **ID tokens** (`Authorization: Bearer <JWT>`) |
| External football data | **API-Football v3** (`https://v3.football.api-sports.io`, header `x-apisports-key`) |
| Geocoding fallback | **OpenStreetMap Nominatim** (only when API-Football returns a venue without coordinates) |
| API docs | **swagger-jsdoc** + **swagger-ui-express** (OpenAPI 3.0.3) |
| Tests | **Node.js test runner** + **supertest** |
| Container | **Docker** (multi-stage-friendly single-stage image) |
| CI | **GitHub Actions** — install, test, Docker build |
| CD | **GitHub Actions** — Docker Hub push + **Google Cloud Run** deploy |

---

## Repository layout

```text
TRWM-backend/
├── app.js                 # Express app factory (Swagger, routes, error handler)
├── server.js              # Entry: dotenv, listen on PORT, then Mongo connect
├── config/
│   ├── database.js        # Mongoose connect (MONGO_URI)
│   ├── firebase.js        # Firebase Admin init + verifyIdToken
│   └── swagger.js         # OpenAPI spec (tags, schemas, scanned route files)
├── middleware/
│   └── authMiddleware.js  # verifyFirebaseToken, loadMongoUser, requireAdmin
├── models/
│   ├── User.js            # firebaseUID, email, role, profile fields
│   └── Player.js          # Player + nested comments + 2dsphere indexes
├── controllers/
│   ├── userController.js
│   ├── playerController.js
│   ├── playerAdminController.js
│   └── playerCommentController.js
├── routes/
│   ├── index.js           # Mounts /api/users, /api/admin, /api/players
│   ├── userRoutes.js
│   ├── adminRoutes.js
│   └── playerRoutes.js    # Route order: /search, /nearby, /:id/comments, …, /
├── services/
│   └── apiFootballService.js   # HTTP client, import mapping, venue / geocode fallback
├── utils/
│   └── escapeRegex.js     # Safe substring filters for Mongo regex queries
├── scripts/
│   ├── run-tests.js       # Discovers tests/**/*.test.js for `npm test`
│   └── write-cloudrun-env.js   # Builds cloudrun-env.json for CD (env vars → JSON)
├── tests/                 # Integration + model tests (see Testing)
├── .github/workflows/
│   ├── ci.yml             # npm ci + npm test (+ optional docker build)
│   └── cd.yml             # Docker push + Cloud Run deploy
├── Dockerfile
├── package.json
└── .env.example           # Template only — copy to `.env` and fill real values
```

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No | HTTP port (default **3000**). Cloud Run sets `PORT` automatically. |
| `MONGO_URI` | **Yes** | MongoDB connection string (Atlas or self-hosted). |
| `API_FOOTBALL_KEY` | For real import | API-Sports key; sent as `x-apisports-key`. Without it, admin import returns **503** when the route resolves the live service. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Yes** (typical) | One-line JSON for Firebase Admin **service account** (or use ADC locally via `GOOGLE_APPLICATION_CREDENTIALS`). |
| `NODE_ENV` | No | Set to `development` for extra auth hints in some error paths. |
| `AUTH_VERBOSE` | No | If `1`, may append diagnostic hints on auth failures (avoid in production). |

Copy **`.env.example`** to **`.env`** and set values locally. **Never commit `.env`** or real secrets.

For **Cloud Run**, CD writes **`cloudrun-env.json`** via [`scripts/write-cloudrun-env.js`](scripts/write-cloudrun-env.js) from GitHub **Secrets** (see [`.github/workflows/cd.yml`](.github/workflows/cd.yml)): `MONGO_URI`, optional `FIREBASE_SERVICE_ACCOUNT_JSON`, optional `API_FOOTBALL_KEY`.

---

## HTTP API summary

Base URL is the host root; JSON bodies use `Content-Type: application/json`.

### Users (`/api/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/users/sync` | Firebase JWT | Upsert Mongo user; body `firebaseUID` must match token `uid`. |
| POST | `/api/users/login` | Firebase + Mongo user | Returns stored user (e.g. role). |
| GET | `/api/users/me` | Firebase + Mongo user | Current profile. |
| PUT | `/api/users/:uid` | Firebase | Update profile (ownership rules in controller). |
| GET | `/api/users` | Admin | List users. |
| PATCH | `/api/users/:uid/role` | Admin | Change `user` / `admin`. |

### Admin (`/api/admin`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/import-players` | Admin | Body: `{ "leagueId", "teamId", "season" }` (numbers). Upserts players by `externalId`. |
| DELETE | `/api/admin/players/:id` | Admin | Delete player by MongoDB `_id`. |

### Players (`/api/players`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/players` | Public | Query: `team`, `position` (case-insensitive partial), `page`, `limit` (max 100). |
| GET | `/api/players/search` | Public | Query: **`q`** (required), `page`, `limit`. |
| GET | `/api/players/nearby` | **Firebase JWT** | Query: `lat`, `lng`, `radiusKm`. Returns `players` + deduped `stadiums`. |
| GET | `/api/players/:id` | Public | Full document including `stats`, `location`, `comments`. |
| GET | `/api/players/:id/comments` | Public | List comments. |
| POST | `/api/players/:id/comments` | Firebase JWT | Body: `text`, `rating` (0–5), `lat`, `lng` → stored as GeoJSON; `author` = Firebase `uid`. |
| DELETE | `/api/players/:id/comments/:commentId` | Firebase JWT | Owner or Mongo **admin** may delete. |

**Swagger UI**: `GET /api/docs` (same origin as the API).

**OpenAPI JSON**: `GET /api/docs.json`

**Health**: `GET /health` → plain text `ok`

---

## Authentication model

1. Client signs in with **Firebase** and obtains an **ID token** (JWT).
2. Protected routes expect: `Authorization: Bearer <idToken>`.
3. **`verifyFirebaseToken`**: validates JWT, sets `req.firebase` (`uid`, etc.).
4. **`loadMongoUser`**: loads `User` by `firebaseUID`; sets `req.mongoUser` (404 if never synced).
5. **`requireAdmin`**: ensures `req.mongoUser.role === 'admin'`.

Admin import and admin delete use the full chain **verify → loadMongoUser → requireAdmin**. Nearby uses **verify only** (no Mongo user required). Comments use **verify**; delete additionally checks ownership or admin via `User` lookup.

---

## Data model (high level)

- **User**: `firebaseUID`, `email`, `role`, optional `name` / `avatar`, timestamps.
- **Player**: `name`, `team`, `league`, `position`, `image`, `externalId` (API-Football player id, unique sparse), `stats` (mixed), `venueName`, GeoJSON **`location`** (stadium point, **2dsphere**), `registrationDate`, nested **`comments`** (each with `author` = Firebase UID, `text`, `rating`, `location`, `createdAt`).

---

## Local development

```bash
npm install
cp .env.example .env   # then edit .env with real values
npm run dev            # nodemon-style: node --watch server.js
```

- API: `http://localhost:3000` (or your `PORT`)
- Docs: `http://localhost:3000/api/docs`

The server **listens first**, then connects to MongoDB (Cloud Run–friendly startup).

---

## Testing

```bash
npm test
```

Runs all `tests/**/*.test.js` under the Node test runner. Integration suites that need MongoDB are gated on **`MONGO_URI`** (see `describe.skip` patterns in tests). CI should provide `MONGO_URI` via repository **Variables** or **Secrets** (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Tests can inject a mock **`apiFootballService`** and **`verifyIdToken`** via `createApp({ ... })` (see [`app.js`](app.js)).

---

## Docker

```bash
docker build -t trwm-backend .
docker run --rm -p 3000:3000 --env-file .env trwm-backend
```

Image runs as non-root `node` user; production dependencies only (`npm ci --omit=dev`).

---

## CI / CD (GitHub Actions)

- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): on push/PR to `main`/`master` — `npm ci`, `npm test`, optional Docker build (no push).
- **CD** ([`.github/workflows/cd.yml`](.github/workflows/cd.yml)): on push to `main`/`master` (or manual) — build and push image to **Docker Hub**, write **`cloudrun-env.json`**, deploy to **Google Cloud Run** with `env_vars_update_strategy: merge`.

Documented secrets/variables for CD are listed in the header comments of **`cd.yml`** (Docker Hub, GCP deploy key, project/region/service names, `MONGO_URI`, Firebase JSON, **`API_FOOTBALL_KEY`**).

---

## Operational notes

- **API-Football quotas**: Import performs multiple HTTP calls (leagues, team, venue, paginated players). Respect daily limits on free tiers.
- **Venue coordinates**: Import prefers coordinates from the team payload, then `/venues`, then a **single Nominatim** lookup with a descriptive `User-Agent`. Heavy or automated bulk use of Nominatim may violate their policy; for large jobs consider upgrading API-Football data or caching coordinates yourself.
- **Security**: Keep service account JSON and API keys in secrets managers (GitHub Secrets, Cloud Secret Manager, etc.). Rotate any credentials that were ever committed to git.

---

## License

`UNLICENSED` (private project) — see [`package.json`](package.json).
