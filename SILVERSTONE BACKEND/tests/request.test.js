import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import app from '../src/index.js';
import db from '../src/config/database.js';
import redis from '../src/config/redis.js';
import { createAgent } from '../src/models/agent.js';
import { createRequest } from '../src/models/request.js';
import bcrypt from 'bcrypt';

const request = supertest(createServer(app));

describe('Float Request Submission', () => {
  let token;

  beforeAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    const agent = await createAgent('Test Agent', '1234567890', 'Vodacom', 'sub-agent', await bcrypt.hash('password', 10));
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
          subAgentId: 1,
          requestedNetwork: 'Vodacom',
          sourceNetwork: 'Tigo',
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
          subAgentId: 1,
          requestedNetwork: 'Invalid',
          amount: -100,
        });
      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should fail with invalid token', async () => {
      const response = await request.post('/api/requests/submit')
        .set('Authorization', 'Bearer invalidtoken')
        .send({
          subAgentId: 1,
          requestedNetwork: 'Vodacom',
          amount: 100000,
        });
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid token');
    });
  });
});