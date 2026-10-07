import request from 'supertest';
import app from '../app.js';
import { db, seedAgent, seedNetworks } from './support/services.js';

it('reads actual legs and refuses fake completion or financial mutations', async () => {
  const owner = await seedAgent(); const other = await seedAgent(); const { from, to } = await seedNetworks();
  const row = await db.one('INSERT INTO public.transfer_requests (sub_agent_id,amount,origin_network_id,origin_account_identifier,destination_network_id,destination_account_identifier) VALUES ($1,100,$2,$3,$4,$5) RETURNING *', [owner.id, from.id, 'origin', to.id, 'dest']);
  const leg = await db.one("INSERT INTO public.transaction_legs (request_id,leg_type,network_id,amount) VALUES ($1,'origin_in',$2,100) RETURNING *", [row.id, from.id]);
  const login = async agent => `Bearer ${(await request(app).post('/api/auth/login').send({ phone_number: agent.phone_number, pin: '123456' })).body.token}`;
  const token = await login(owner);
  const detail = await request(app).get(`/api/transfers/${leg.id}`).set('Authorization', token);
  expect(detail.status).toBe(200); expect(detail.body[0].leg_type).toBe('origin_in');
  expect((await request(app).get(`/api/transfers/${leg.id}`).set('Authorization', await login(other))).status).toBe(404);
  expect((await request(app).post('/api/transfers/process').set('Authorization', token).send({ requestId: row.id })).status).toBe(503);
  expect((await db.one('SELECT * FROM public.transfer_requests WHERE id=$1', [row.id])).status).toBe('pending_pin');
  expect((await db.one('SELECT * FROM public.transaction_legs WHERE id=$1', [leg.id])).confirmed_at).toBeNull();
});
