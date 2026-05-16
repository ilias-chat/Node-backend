require('dotenv').config();

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../app');
const User = require('../models/User');
const Player = require('../models/Player');

function mockVerify(claims = { uid: 'firebase-test-players-1', email: 'p1@test.com' }) {
  return async (token) => {
    if (token === 'bad-token') {
      throw new Error('invalid');
    }
    return claims;
  };
}

const londonPoint = { type: 'Point', coordinates: [-0.1278, 51.5074] };

function mockApiFootballService() {
  return {
    async fetchLeaguesForSeason(season) {
      return [
        {
          id: 39,
          name: 'Test League',
          logo: 'https://example.com/league.png',
          country: 'England',
        },
      ];
    },
    async fetchTeamsForLeague(leagueId, season) {
      if (leagueId !== 39) return [];
      return [
        { id: 33, name: 'Test FC', logo: 'https://example.com/team.png' },
      ];
    },
    async buildImportPayloads() {
      return {
        players: [
          {
            name: 'Import Alpha',
            team: 'Test FC',
            league: 'Test League',
            image: 'https://example.com/a.png',
            externalId: 910001,
            position: 'Attacker',
            stats: { goals: { total: 5 } },
            venueName: 'Test Arena',
            location: londonPoint,
          },
          {
            name: 'Import Beta',
            team: 'Test FC',
            league: 'Test League',
            externalId: 910002,
            position: 'Midfielder',
            stats: {},
            venueName: 'Test Arena',
            location: londonPoint,
          },
        ],
        teamName: 'Test FC',
        leagueName: 'Test League',
        venueName: 'Test Arena',
      };
    },
  };
}

describe('Players API — nearby validation (no database)', () => {
  test('GET /api/players/nearby without lat/lng returns 400', async () => {
    const app = createApp({ verifyIdToken: mockVerify() });
    await request(app).get('/api/players/nearby').query({ radiusKm: 50 }).expect(400);
  });

  test('GET /api/players/nearby accepts distance in meters as radius alias', async () => {
    const app = createApp({ verifyIdToken: mockVerify() });
    const Player = require('../models/Player');
    const originalFind = Player.find;
    Player.find = () => ({
      sort: () => ({
        lean: async () => [],
      }),
    });
    try {
      const res = await request(app)
        .get('/api/players/nearby')
        .query({ lat: 51.5, lng: -0.12, distance: 50_000 })
        .expect(200);
      assert.deepEqual(res.body, { players: [], stadiums: [] });
    } finally {
      Player.find = originalFind;
    }
  });
});

const mongoDescribe = process.env.MONGO_URI ? describe : describe.skip;

mongoDescribe('Players API — integration (requires MONGO_URI)', { concurrency: false }, () => {
  const uid = 'firebase-test-players-user';
  const adminUid = 'firebase-test-players-admin';

  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await User.deleteMany({ firebaseUID: { $in: [uid, adminUid] } });
    await Player.deleteMany({ externalId: { $in: [910001, 910002, 910003] } });
    await User.create([
      { firebaseUID: uid, email: 'playeruser@test.com', name: 'Test Player', role: 'user' },
      { firebaseUID: adminUid, email: 'playeradmin@test.com', role: 'admin' },
    ]);
  });

  after(async () => {
    await User.deleteMany({ firebaseUID: { $in: [uid, adminUid] } });
    await Player.deleteMany({ externalId: { $in: [910001, 910002, 910003] } });
    await mongoose.disconnect();
  });

  test('GET /api/admin/leagues returns league options', async () => {
    const app = createApp({
      verifyIdToken: mockVerify({ uid: adminUid, email: 'playeradmin@test.com' }),
      apiFootballService: mockApiFootballService(),
    });
    const res = await request(app)
      .get('/api/admin/leagues')
      .query({ season: 2024 })
      .set('Authorization', 'Bearer ok')
      .expect(200);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data[0].id, 39);
    assert.strictEqual(res.body.data[0].name, 'Test League');
  });

  test('GET /api/admin/teams returns team options for league', async () => {
    const app = createApp({
      verifyIdToken: mockVerify({ uid: adminUid, email: 'playeradmin@test.com' }),
      apiFootballService: mockApiFootballService(),
    });
    const res = await request(app)
      .get('/api/admin/teams')
      .query({ leagueId: 39, season: 2024 })
      .set('Authorization', 'Bearer ok')
      .expect(200);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data[0].id, 33);
  });

  test('admin import-players upserts squad', async () => {
    const app = createApp({
      verifyIdToken: mockVerify({ uid: adminUid, email: 'playeradmin@test.com' }),
      apiFootballService: mockApiFootballService(),
    });
    const res = await request(app)
      .post('/api/admin/import-players')
      .set('Authorization', 'Bearer ok')
      .send({ leagueId: 39, teamId: 33, season: 2023 })
      .expect(200);
    assert.ok(typeof res.body.inserted === 'number');
    assert.ok(typeof res.body.updated === 'number');
    assert.strictEqual(res.body.playersProcessed, 2);
    const count = await Player.countDocuments({ externalId: { $in: [910001, 910002] } });
    assert.strictEqual(count, 2);
    const withPhoto = await Player.findOne({ externalId: 910001 }).lean();
    assert.strictEqual(withPhoto?.image, 'https://example.com/a.png');
    const withoutPhoto = await Player.findOne({ externalId: 910002 }).lean();
    assert.ok(!withoutPhoto?.image);
  });

  test('non-admin cannot import', async () => {
    const app = createApp({
      verifyIdToken: mockVerify({ uid, email: 'playeruser@test.com' }),
      apiFootballService: mockApiFootballService(),
    });
    await request(app)
      .post('/api/admin/import-players')
      .set('Authorization', 'Bearer ok')
      .send({ leagueId: 39, teamId: 33, season: 2023 })
      .expect(403);
  });

  test('GET list supports team partial filter and pagination', async () => {
    const app = createApp({ verifyIdToken: mockVerify() });
    const res = await request(app).get('/api/players').query({ team: 'test', limit: 5 }).expect(200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.total >= 2);
    assert.strictEqual(res.body.limit, 5);
  });

  test('GET search requires q', async () => {
    const app = createApp({ verifyIdToken: mockVerify() });
    const res = await request(app).get('/api/players/search').expect(400);
    assert.ok(res.body.error);
  });

  test('GET search by name', async () => {
    const app = createApp({ verifyIdToken: mockVerify() });
    const res = await request(app).get('/api/players/search').query({ q: 'Import Alpha' }).expect(200);
    assert.ok(res.body.data.some((p) => p.name === 'Import Alpha'));
  });

  test('GET detail returns stats and location', async () => {
    const p = await Player.findOne({ externalId: 910001 }).lean();
    assert.ok(p);
    const app = createApp({ verifyIdToken: mockVerify() });
    const res = await request(app).get(`/api/players/${p._id}`).expect(200);
    assert.strictEqual(res.body.name, 'Import Alpha');
    assert.ok(res.body.stats);
    assert.ok(res.body.location);
  });

  test('GET nearby without Authorization is public and returns stadiums deduped', async () => {
    const app = createApp({ verifyIdToken: mockVerify({ uid, email: 'playeruser@test.com' }) });
    const res = await request(app)
      .get('/api/players/nearby')
      .query({ lat: 51.5074, lng: -0.1278, radiusKm: 500 })
      .expect(200);
    assert.ok(Array.isArray(res.body.players));
    assert.ok(Array.isArray(res.body.stadiums));
    assert.ok(res.body.players.length >= 1);
    assert.ok(res.body.stadiums.length >= 1);
  });

  test('GET nearby with token returns stadiums deduped', async () => {
    const app = createApp({ verifyIdToken: mockVerify({ uid, email: 'playeruser@test.com' }) });
    const res = await request(app)
      .get('/api/players/nearby')
      .set('Authorization', 'Bearer ok')
      .query({ lat: 51.5074, lng: -0.1278, radiusKm: 500 })
      .expect(200);
    assert.ok(Array.isArray(res.body.players));
    assert.ok(Array.isArray(res.body.stadiums));
    assert.ok(res.body.players.length >= 1);
    assert.ok(res.body.stadiums.length >= 1);
  });

  test('comments POST GET DELETE', async () => {
    const p = await Player.findOne({ externalId: 910002 });
    assert.ok(p);
    const appUser = createApp({ verifyIdToken: mockVerify({ uid, email: 'playeruser@test.com' }) });
    const postRes = await request(appUser)
      .post(`/api/players/${p._id}/comments`)
      .set('Authorization', 'Bearer ok')
      .send({ text: 'Solid season', rating: 4, lat: 51.5, lng: -0.12 })
      .expect(201);
    assert.strictEqual(postRes.body.author, uid);
    assert.strictEqual(postRes.body.authorName, 'Test Player');
    const commentId = postRes.body._id;

    const listRes = await request(appUser).get(`/api/players/${p._id}/comments`).expect(200);
    assert.ok(listRes.body.data.some((c) => String(c._id) === String(commentId)));

    await request(appUser)
      .delete(`/api/players/${p._id}/comments/${commentId}`)
      .set('Authorization', 'Bearer ok')
      .expect(204);

    const appOther = createApp({
      verifyIdToken: mockVerify({ uid: 'firebase-test-players-other', email: 'o@test.com' }),
    });
    const post2 = await request(appOther)
      .post(`/api/players/${p._id}/comments`)
      .set('Authorization', 'Bearer ok')
      .send({ text: 'Other', rating: 3, lat: 51.5, lng: -0.12 })
      .expect(201);
    const cid2 = post2.body._id;

    await request(appUser)
      .delete(`/api/players/${p._id}/comments/${cid2}`)
      .set('Authorization', 'Bearer ok')
      .expect(403);

    const appAdmin = createApp({
      verifyIdToken: mockVerify({ uid: adminUid, email: 'playeradmin@test.com' }),
    });
    await request(appAdmin)
      .delete(`/api/players/${p._id}/comments/${cid2}`)
      .set('Authorization', 'Bearer ok')
      .expect(204);

    const myComments = await request(appUser)
      .get('/api/users/me/comments')
      .set('Authorization', 'Bearer ok')
      .expect(200);
    assert.ok(Array.isArray(myComments.body.data));
    assert.ok(myComments.body.data.some((c) => c.text === 'Solid season'));
    assert.ok(myComments.body.data.every((c) => c.author === uid));
    assert.ok(myComments.body.data[0].player?.name);
  });

  test('admin deletes player by id', async () => {
    const doc = await Player.findOne({ externalId: 910001 });
    assert.ok(doc);
    const app = createApp({
      verifyIdToken: mockVerify({ uid: adminUid, email: 'playeradmin@test.com' }),
    });
    await request(app).delete(`/api/admin/players/${doc._id}`).set('Authorization', 'Bearer ok').expect(204);
    const gone = await Player.findById(doc._id);
    assert.strictEqual(gone, null);
  });
});
