import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { db, seedAgent } from './support/services.js';

it('logs in an existing phone/PIN agent and does not expose hashes or NIN', async () => {
  const agent = await seedAgent();
  const login = await request(app).post('/api/auth/login').send({ phone_number: agent.phone_number, pin: '123456' });
  expect(login.status).toBe(200);
  expect(login.body.agent).not.toHaveProperty('pin_hash');
  expect(login.body.agent).not.toHaveProperty('agent_nin');
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
  expect(me.status).toBe(200);
  expect(me.body.agent.id).toBe(agent.id);
});

it('rejects email/password login instead of querying nonexistent columns', async () => {
  const response = await request(app).post('/api/auth/login').send({ email: 'fixture@example.test', password: 'fixture-password' });
  expect(response.status).toBe(400);
});
it('does not echo submitted PIN values in validation failures', async () => {
  const response = await request(app).post('/api/auth/login').send({ phone_number: 'fixture', pin: 'sensitive-test-value' });
  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).not.toContain('sensitive-test-value');
});
it('rejects wrong PINs and unsupported hash formats without changing credentials', async () => {
  const agent = await seedAgent();
  expect((await request(app).post('/api/auth/login').send({ phone_number: agent.phone_number, pin: '999999' })).status).toBe(401);
  await db.none('UPDATE public.agents SET pin_hash=$1 WHERE id=$2', ['unsupported-hash', agent.id]);
  expect((await request(app).post('/api/auth/login').send({ phone_number: agent.phone_number, pin: '123456' })).status).toBe(401);
});
it('denies suspended agents and rechecks status on existing tokens', async () => {
  const agent = await seedAgent();
  const response = await request(app).post('/api/auth/login').send({ phone_number: agent.phone_number, pin: '123456' });
  await db.none("UPDATE public.agents SET status='suspended' WHERE id=$1", [agent.id]);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${response.body.token}`)).status).toBe(401);
});
it('rejects legacy/reset-purpose tokens', async () => {
  const agent = await seedAgent();
  const token = jwt.sign({ id: agent.id, purpose: 'reset' }, process.env.JWT_SECRET);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
});
it('does not create accounts or issue reset credentials through unimplemented flows', async () => {
  expect((await request(app).post('/api/auth/register').send({ role: 'main-agent' })).status).toBe(503);
  const response = await request(app).post('/api/auth/forgot-password').send({ phone: 'fixture' });
  expect(response.status).toBe(503);
  expect(response.body).not.toHaveProperty('resetToken');
});
