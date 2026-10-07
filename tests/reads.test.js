import request from 'supertest';
import app from '../app.js';
import { db, seedAgent, seedNetworks } from './support/services.js';

it('serves assigned-agent, dashboard and analytics reads without nonexistent-column queries', async () => {
  const main = await seedAgent({ role: 'main-agent' }); const sub = await seedAgent(); const unrelated = await seedAgent();
  const { from, to } = await seedNetworks();
  await db.none('INSERT INTO public.transfer_requests (sub_agent_id, main_agent_id, amount, origin_network_id,origin_account_identifier,destination_network_id,destination_account_identifier) VALUES ($1,$2,100,$3,$4,$5,$6)', [sub.id, main.id, from.id, 'origin', to.id, 'dest']);
  const result = await request(app).post('/api/auth/login').send({ phone_number: main.phone_number, pin: '123456' });
  const token = `Bearer ${result.body.token}`;
  const agents = await request(app).get('/api/agents').set('Authorization', token);
  expect(agents.status).toBe(200);
  expect(agents.body.map(a => a.id).sort()).toEqual([main.id, sub.id].sort());
  expect(JSON.stringify(agents.body)).not.toContain('pin_hash');
  for (const path of [`/api/agents/${sub.id}`, `/api/agents/${sub.id}/data`, `/api/analytics/agent/${sub.id}`, '/api/analytics/time-based?period=daily', '/api/dashboard/revenue-metrics']) {
    expect((await request(app).get(path).set('Authorization', token)).status).toBe(200);
  }
  expect((await request(app).get(`/api/agents/${unrelated.id}`).set('Authorization', token)).status).toBe(404);
  expect((await request(app).get('/api/dashboard/revenue-metrics').set('Authorization', token)).body.summary.totalRevenue).toBeNull();
});
