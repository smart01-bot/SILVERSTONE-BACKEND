import request from 'supertest';
import app from '../app.js';
import { db, seedAgent, seedNetworks } from './support/services.js';
async function login(agent) {
  const result = await request(app).post('/api/auth/login').send({ phone_number: agent.phone_number, pin: '123456' });
  return `Bearer ${result.body.token}`;
}
it('submits against actual columns with JWT owner and the database pending_pin default', async () => {
  const agent = await seedAgent();
  const { from, to } = await seedNetworks();
  const response = await request(app).post('/api/requests/submit').set('Authorization', await login(agent)).send({
    subAgentId: 'untrusted-owner', amount: '100.50', origin_network_id: from.id,
    destination_network_id: to.id, origin_account_identifier: 'fixture-origin', destination_account_identifier: 'fixture-destination',
  });
  expect(response.status).toBe(201);
  expect(response.body.request.status).toBe('pending_pin');
  expect(response.body.request.sub_agent_id).toBe(agent.id);
  expect(response.body).not.toHaveProperty('queuePosition');
  expect(await db.manyOrNone('SELECT * FROM public.transaction_legs')).toEqual([]);
});
it('resolves legacy network names but rejects same-network or urgent submissions', async () => {
  const agent = await seedAgent(); await seedNetworks(); const authorization = await login(agent);
  const body = { source_network: 'Vodacom', requested_network: 'Vodacom', source_phoneNumber: 'fixture-source', requested_phoneNumber: 'fixture-destination', amount: 100 };
  expect((await request(app).post('/api/requests/submit').set('Authorization', authorization).send(body)).status).toBe(400);
  body.requested_network = 'Airtel'; body.urgency = true;
  expect((await request(app).post('/api/requests/submit').set('Authorization', authorization).send(body)).status).toBe(400);
});
it('limits reads to the owner or assigned main-agent', async () => {
  const owner = await seedAgent(); const other = await seedAgent(); const main = await seedAgent({ role: 'main-agent' });
  const { from, to } = await seedNetworks();
  const row = await db.one('INSERT INTO public.transfer_requests (sub_agent_id,main_agent_id,amount,origin_network_id,origin_account_identifier,destination_network_id,destination_account_identifier) VALUES ($1,$2,100,$3,$4,$5,$6) RETURNING *', [owner.id, main.id, from.id, 'origin', to.id, 'dest']);
  expect((await request(app).get(`/api/requests/${row.id}`).set('Authorization', await login(other))).status).toBe(404);
  expect((await request(app).get(`/api/requests/${row.id}`).set('Authorization', await login(main))).status).toBe(200);
  expect((await request(app).get('/api/requests').set('Authorization', await login(other))).body).toEqual([]);
});
it('prevents pending accounts from operational access', async () => {
  const agent = await seedAgent({ status: 'pending' });
  expect((await request(app).get('/api/requests').set('Authorization', await login(agent))).status).toBe(403);
});
