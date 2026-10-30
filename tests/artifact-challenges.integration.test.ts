import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildArtifacts, loadChallengePackages, type ChallengePackage } from '../src/catalog/packages.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { DrizzleChallengeContentRepository } from '../src/db/challenge-content-repository.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleScoringRepository } from '../src/db/scoring-repository.js';
import { submissions, users } from '../src/db/schema.js';
import { LocalArtifactStore } from '../src/services/artifact-store.js';
import { deriveArtifactFlag } from '../src/services/instance-flags.js';
import { SubmissionService } from '../src/services/submissions.js';
import { dropDisposableDatabase, signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const SECRET = 'artifact-test-flag-secret-with-enough-bytes';
const SLUG = 'caesars-memo';

describeDatabase('artifact challenges', () => {
  const databaseName = `artifact_challenges_${randomUUID().replaceAll('-', '')}`;
  let owner: Pool;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let store: string;
  let lab: ChallengePackage;
  let flag: string;
  let webLabId: string;
  let createdDatabase = false;

  async function newPlayer(): Promise<{ id: string; headers: { authorization: string } }> {
    const id = randomUUID();
    await database.db.insert(users).values({
      id, email: `artifact-${id}@example.test`, passwordHash: 'test-only-placeholder-hash', emailVerifiedAt: new Date(),
    });
    const token = await signToken('submissions:write profile:read', { subject: id });
    return { id, headers: { authorization: `Bearer ${token}` } };
  }
  const submit = (headers: { authorization: string }, payload: object) =>
    app.inject({ method: 'POST', url: '/v1/submissions', headers, payload });

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    owner = new Pool({ connectionString: testDatabaseUrl });
    await owner.query(`create database "${databaseName}"`);
    createdDatabase = true;
    const url = new URL(testDatabaseUrl);
    url.pathname = `/${databaseName}`;
    database = createDatabase(url.href);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db, undefined, { publishLabs: true });
    const packages = await loadChallengePackages();
    const found = packages.find(({ slug }) => slug === SLUG);
    const web = packages.find(({ kind }) => kind === 'web');
    if (!found || !web) throw new Error('Packages are missing');
    lab = found;
    webLabId = web.id;
    flag = deriveArtifactFlag(SECRET, { challengeId: lab.id, version: lab.definitionVersion });
    store = await mkdtemp(join(tmpdir(), 'artifact-store-'));
    await buildArtifacts(lab, flag, join(store, SLUG, `v${lab.definitionVersion}`));
    const content = new DrizzleChallengeContentRepository(database.db);
    app = await buildApp({ ...testConfig, LOCAL_DEV_TEST: true }, {
      sessionAuthorizer: { validateServiceSession: async () => ({ allowedScopes: ['submissions:write', 'profile:read'] }) },
      challengeContent: content,
      artifacts: new LocalArtifactStore(store),
      submissions: new SubmissionService(
        new DrizzleScoringRepository(database.db),
        { findOwnedInstance: async () => null },
        { derive: () => 'unused', verify: () => false },
        undefined,
        { findArtifactChallenge: (id) => content.findArtifactChallenge(id), flagSecret: SECRET },
      ),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
    if (createdDatabase) await dropDisposableDatabase(owner, databaseName, /^artifact_challenges_[0-9a-f]{32}$/u);
    await owner?.end();
    if (store) await rm(store, { recursive: true, force: true });
  });

  it('records a download-only solve with no instance, once', async () => {
    const player = await newPlayer();
    expect((await submit(player.headers, { challengeId: lab.id, flag: 'CTF{v1_wrong}' })).json()).toMatchObject({ correct: false, points: 0 });
    expect((await submit(player.headers, { challengeId: lab.id, flag })).json()).toMatchObject({ correct: true, points: 100 });
    expect((await submit(player.headers, { challengeId: lab.id, flag })).json()).toMatchObject({ correct: true, points: 0 });
    const rows = await database.db.select().from(submissions).where(eq(submissions.userId, player.id));
    expect(rows).toHaveLength(3);
    expect(rows.every(({ instanceId }) => instanceId === null)).toBe(true);
  });

  it('applies hint costs to artifact awards', async () => {
    const player = await newPlayer();
    await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/1/unlock`, headers: player.headers });
    expect((await submit(player.headers, { challengeId: lab.id, flag })).json()).toMatchObject({ correct: true, points: 90 });
  });

  it('refuses a flag with no instance for anything but an artifact challenge', async () => {
    const player = await newPlayer();
    expect((await submit(player.headers, { challengeId: webLabId, flag })).statusCode).toBe(404);
    expect((await submit(player.headers, { challengeId: randomUUID(), flag })).statusCode).toBe(404);
    const rows = await database.db.select().from(submissions).where(eq(submissions.userId, player.id));
    expect(rows).toHaveLength(0);
  });

  it('refuses an instance id on an artifact challenge', async () => {
    const player = await newPlayer();
    expect((await submit(player.headers, { challengeId: lab.id, instanceId: randomUUID(), flag })).statusCode).toBe(404);
  });

  it('lists files publicly, without any flag, and only for artifact challenges', async () => {
    const response = await app.inject(`/v1/challenges/${SLUG}/content`);
    expect(response.json().artifacts).toEqual([expect.objectContaining({ filename: 'memo.txt' })]);
    expect(response.body).not.toContain(flag);
    expect((await app.inject('/v1/challenges/invoice-peek/content')).json().artifacts).toEqual([]);
  });

  it('serves a file only to a signed-in player, as a forced attachment', async () => {
    const url = `/v1/challenges/${SLUG}/artifacts/memo.txt`;
    expect((await app.inject(url)).statusCode).toBe(401);
    const { headers } = await newPlayer();
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toBe('attachment; filename="memo.txt"');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload.equals(await readFile(join(store, SLUG, 'v1/memo.txt')))).toBe(true);
  });

  it('refuses unknown files, traversal and the manifest itself', async () => {
    const { headers } = await newPlayer();
    for (const name of ['nope.txt', 'manifest.json']) {
      expect((await app.inject({ url: `/v1/challenges/${SLUG}/artifacts/${name}`, headers })).statusCode).toBe(404);
    }
    expect((await app.inject({ url: `/v1/challenges/${SLUG}/artifacts/..%2F..%2Fsecret`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/v1/challenges/invoice-peek/artifacts/memo.txt', headers })).statusCode).toBe(404);
  });

  it('refuses to serve a file that fails its checksum', async () => {
    const { headers } = await newPlayer();
    const path = join(store, SLUG, 'v1/memo.txt');
    const original = await readFile(path);
    await writeFile(path, 'tampered');
    expect((await app.inject({ url: `/v1/challenges/${SLUG}/artifacts/memo.txt`, headers })).statusCode).toBe(500);
    await writeFile(path, original);
  });
});
