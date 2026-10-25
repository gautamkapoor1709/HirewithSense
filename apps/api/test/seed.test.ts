import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { seedDemo } from '../src/db/seed.js';
import { createApp, truncateAll } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createApp();
  await truncateAll();
});
afterAll(async () => app.close());

describe('demo seed', () => {
  it('creates both organizations with open jobs and ready interviews, and is idempotent', async () => {
    const first = await seedDemo(getDb());
    expect(first.map((r) => [r.organization, r.created])).toEqual([
      ['Northwind Labs', true],
      ['Sukhoi-dev', true],
    ]);
    const second = await seedDemo(getDb());
    expect(second.every((r) => !r.created)).toBe(true);

    const count = async (q: string) => Number(((await getDb().execute(sql.raw(q))).rows[0] as { c: string }).c);
    expect(await count('select count(*) c from organizations')).toBe(2);
    expect(await count('select count(*) c from users')).toBe(4);
    expect(await count("select count(*) c from jobs where status = 'open'")).toBe(2);
    expect(await count("select count(*) c from interviews where status = 'ready'")).toBe(2);
    expect(await count('select count(*) c from coding_problems')).toBe(4);
  });

  it('lets the Sukhoi-dev recruiter and candidate sign in and see their job and interview', async () => {
    const rec = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'recruiter@sukhoi-dev.hirewithsense.local', password: 'DemoPassword123!' } });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().user.organization.name).toBe('Sukhoi-dev');
    const jobs = await app.inject({ method: 'GET', url: '/api/v1/jobs', headers: { authorization: `Bearer ${rec.json().accessToken}` } });
    expect(jobs.json().items.map((j: any) => j.title)).toEqual(['Software Engineer']);

    const cand = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'candidate@sukhoi-dev.hirewithsense.local', password: 'DemoPassword123!' } });
    expect(cand.statusCode).toBe(200);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/interviews/mine', headers: { authorization: `Bearer ${cand.json().accessToken}` } });
    expect(mine.json()[0].jobTitle).toBe('Software Engineer');
    expect(mine.json()[0].status).toBe('ready');
  });
});
