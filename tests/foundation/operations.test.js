import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { embeddedDatabase } from '../../scripts/embedded.js';
import { migrate } from '../../foundation/migrate.js';
import { seedSynthetic, syntheticPassword } from '../../scripts/fixtures.js';
import { seedExchangeFixtures } from '../../scripts/exchange-fixtures.js';
import { createApp } from '../../foundation/app.js';
import { claimExchangeJob, finishExchangeJob } from '../../foundation/exchanges.js';
import { syntheticEvidenceHarness } from '../../scripts/synthetic-provider-evidence.js';

test('disposable embedded snapshot restores uncertainty, evidence, fencing, replay and scoped reads', async t => {
  let db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  const f = await seedSynthetic(db), accounts = await seedExchangeFixtures(db, f);
  const secret = 'operations-synthetic-only-secret-32-characters';
  let app = createApp({db, secret, rateLimit:1000});
  const login = async who => {
    const r = await request(app).post('/api/v1/auth/login').send({email:f[who].email,password:syntheticPassword});
    assert.equal(r.status,200);
    assert.equal(r.headers['cache-control'],'no-store');
    return r.body.data.accessToken;
  };
  const sub = await login('sub'), main = await login('main');
  const call = (token, method, path, body, key=randomUUID()) => request(app)[method]('/api/v1'+path)
    .set('Authorization',`Bearer ${token}`).set('Idempotency-Key',key).send(body);
  const payload = {sourceAccountId:accounts.sub.vodacom,destinationAccountId:accounts.sub.airtel,amountTzs:'100',currency:'TZS'};
  const key = randomUUID();
  const create = async (k=randomUUID()) => {
    const r = await call(sub,'post','/requests',payload,k); assert.equal(r.status,201); return r.body.data;
  };
  const accept = async row => { assert.equal((await call(main,'post',`/requests/${row.id}/accept`,{expectedVersion:1})).status,200); };
  const unknown = await create(key); await accept(unknown);
  const h = syntheticEvidenceHarness(db), attempt = await h.prepare(await claimExchangeJob(db));
  const event = await h.receive({provider:'synthetic_fixture',scope:'embedded_test',eventKey:randomUUID(),reference:attempt.reference,
    requestId:attempt.request_id,legId:attempt.leg_id,amountTzs:String(attempt.amount_tzs),currency:attempt.currency,
    networkCode:attempt.network_code,fromAccountId:attempt.from_account_id,toAccountId:attempt.to_account_id,status:'confirmed'});
  await h.apply(event);
  const recoverable = await create(); await accept(recoverable);
  const stale = await claimExchangeJob(db);
  // Explicit synthetic expiry; no real clock/process-restart claim.
  await db.query("UPDATE ss_v1.exchange_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[stale.id]);
  const tables = ['transfer_requests','transaction_legs','exchange_reservations','exchange_capacity','exchange_history','exchange_commands','exchange_jobs',
    'provider_attempts','provider_event_inbox','provider_event_results','provider_evidence_state','provider_evidence_effects','schema_migrations'];
  const capture = async () => {
    const result = {};
    for (const table of tables) result[table] = (await db.query(`SELECT row_to_json(t)::text AS value FROM ss_v1.${table} t ORDER BY row_to_json(t)::text`)).rows;
    return result;
  };
  const before = await capture(), snapshot = await db.snapshot();
  assert.ok(snapshot.size > 0);
  await db.close();
  db = await embeddedDatabase({snapshot});
  assert.deepEqual(await capture(),before);
  await migrate(db); // Checksum verification, no altered migrations.
  app = createApp({db,secret,rateLimit:1000});
  const read = await call(sub,'get',`/requests/${unknown.id}`);
  assert.equal(read.status,200); assert.equal(read.headers['cache-control'],'no-store');
  assert.equal(read.body.data.status,'needs_attention');
  assert.equal(read.body.data.reservation.status,'held');
  assert.equal(read.body.data.providerEvidence[0].actualSettlementVerified,false);
  assert.equal(read.body.data.providerEvidence[0].reconciliationRequired,true);
  assert.equal((await create(key)).id,unknown.id);
  const recovered = await claimExchangeJob(db);
  assert.equal(recovered.requestId,recoverable.id);
  assert.notEqual(recovered.claimToken,stale.claimToken);
  await assert.rejects(finishExchangeJob(db,stale),{code:'STALE_CLAIM'});
  await finishExchangeJob(db,recovered);
  assert.equal(await claimExchangeJob(db),null); // Unknown work never requeued.
  await syntheticEvidenceHarness(db).apply(event);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ss_v1.provider_evidence_effects')).rows[0].n,1);
  assert.equal((await db.query('SELECT held_tzs::text AS n FROM ss_v1.exchange_capacity WHERE account_id=$1',[accounts.main.airtel])).rows[0].n,'200');
  const outsider = await login('other-main');
  assert.equal((await call(outsider,'get',`/requests/${unknown.id}`)).status,404);
  assert.equal((await call(outsider,'get','/requests')).body.data.some(r=>r.id===unknown.id),false);
  assert.equal((await call(main,'get','/audit-events')).status,404); // No global audit capability.
  for (const name of ['claimToken','payloadHash','passwordHash','refreshToken','inbox'])
    assert.equal(JSON.stringify(read.body.data).includes(`"${name}"`),false);
  await db.query("UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",[f.sub.id]);
  assert.equal((await call(sub,'get',`/requests/${unknown.id}`)).status,403);
  assert.equal((await call(main,'post',`/requests/${unknown.id}/cancel`,{expectedVersion:2})).status,403);
  assert.equal((await db.query('SELECT status FROM ss_v1.exchange_reservations WHERE request_id=$1',[unknown.id])).rows[0].status,'held');
});
