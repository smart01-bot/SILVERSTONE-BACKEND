import supertest from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import app from '../src/index.js';
import db from '../src/config/database.js';
import redis from '../src/config/redis.js';
import { createAgent, getAgentByPhone } from '../src/models/agent.js';

const request = supertest(createServer(app));

describe('Authentication', () => {
  beforeAll(async () => {
    await db.none('DELETE FROM agents');
    await redis.flushAll();
  });

  afterAll(async () => {
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    await redis.quit();
    await db.$pool.end();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new agent', async () => {
      const response = await request.post('/api/auth/register').send({
        name: 'Test Agent',
        phone: '1234567890',
        network: 'Vodacom',
        role: 'sub-agent',
        password: 'securepassword',
      });
      expect(response.status).toBe(201);
      expect(response.body.agent).toHaveProperty('id');
      expect(response.body.agent.phone).toBe('1234567890');
      expect(response.body).toHaveProperty('token');
    });

    it('should fail with duplicate phone', async () => {
      await createAgent('Test Agent', '1234567890', 'Vodacom', 'sub-agent', await bcrypt.hash('password', 10));
      const response = await request.post('/api/auth/register').send({
        name: 'Another Agent',
        phone: '1234567890',
        network: 'Vodacom',
        role: 'sub-agent',
        password: 'securepassword',
      });
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error'); // Update error handling for specific messages if needed
    });

    it('should fail with invalid role', async () => {
      const response = await request.post('/api/auth/register').send({
        name: 'Test Agent',
        phone: '9876543210',
        network: 'Vodacom',
        role: 'invalid',
        password: 'securepassword',
      });
      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await db.none('DELETE FROM agents');
      await createAgent('Test Agent', '1234567890', 'Vodacom', 'sub-agent', await bcrypt.hash('securepassword', 10));
    });

    it('should login with valid credentials', async () => {
      const response = await request.post('/api/auth/login').send({
        phone: '1234567890',
        password: 'securepassword',
      });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      const decoded = jwt.verify(response.body.token, process.env.JWT_SECRET);
      expect(decoded).toHaveProperty('id');
    });

    it('should fail with invalid credentials', async () => {
      const response = await request.post('/api/auth/login').send({
        phone: '1234567890',
        password: 'wrongpassword',
      });
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should fail with missing credentials', async () => {
      const response = await request.post('/api/auth/login').send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Phone and password required');
    });
  });
});