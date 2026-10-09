import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import app from '../index.js';
import db from '../config/database.js';
import redis from '../config/redis.js';
import { createAgent } from '../models/agent.js';
import bcrypt from 'bcrypt';

const request = supertest(createServer(app));

describe('Float Request Submission', () => {
  let token;
  let agentId;

  beforeAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    const agent = await createAgent(
      'requestagent', 'Test Agent', 'requestagent@example.com', '1234567890',
      ['Vodacom'], [], 'sub-agent', await bcrypt.hash('password', 10),
      null, null, null, null, null, null, 0, null, null, false
    );
    agentId = agent.id;
    token = jwt.sign({ id: agent.id, role: 'sub-agent' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    await redis.quit();
    await db.$pool.end();
  });

  describe('POST /api/requests/submit', () => {
    it('should submit a valid float request', async () => {
      const response = await request.post('/api/requests/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({
          subAgentId: agentId,
          subagent_name: 'Test Agent',
          requested_network: 'Vodacom',
          source_network: 'Airtel',
          requested_phoneNumber: '1234567890',
          source_phoneNumber: '0987654321',
          amount: 100000,
          urgency: true,
        });
      expect(response.status).toBe(201);
      expect(response.body.request).toHaveProperty('id');
      expect(response.body.queuePosition).toBe(1);
    });

    it('should fail with invalid inputs', async () => {
      const response = await request.post('/api/requests/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({
          subAgentId: agentId,
          subagent_name: 'Test Agent',
          requested_network: 'Invalid',
          requested_phoneNumber: '1234567890',
          amount: -100,
          urgency: true,
        });
      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should fail with invalid token', async () => {
      const response = await request.post('/api/requests/submit')
        .set('Authorization', 'Bearer invalidtoken')
        .send({
          subAgentId: agentId,
          subagent_name: 'Test Agent',
          requested_network: 'Vodacom',
          requested_phoneNumber: '1234567890',
          amount: 100000,
          urgency: false,
        });
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid token');
    });
  });
});