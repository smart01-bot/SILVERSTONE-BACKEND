import supertest from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import app from '../index.js';
import db from '../config/database.js';
import redis from '../config/redis.js';
import { createAgent } from '../models/agent.js';

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
        username: 'testagent',
        name: 'Test Agent',
        email: 'testagent@example.com',
        phone: '1234567890',
        password: 'securepassword',
        role: 'sub-agent',
        networks: ['Vodacom'],
      });
      expect(response.status).toBe(201);
      expect(response.body.agent).toHaveProperty('id');
      expect(response.body.agent.phone).toBe('1234567890');
      expect(response.body).toHaveProperty('token');
    });

    it('should fail with duplicate phone', async () => {
      await createAgent(
        'existingagent', 'Existing Agent', 'existingagent@example.com', '1234567890',
        ['Vodacom'], [], 'sub-agent', await bcrypt.hash('password', 10),
        null, null, null, null, null, null, 0, null, null, false
      );
      const response = await request.post('/api/auth/register').send({
        username: 'anotheragent',
        name: 'Another Agent',
        email: 'anotheragent@example.com',
        phone: '1234567890',
        password: 'securepassword',
        role: 'sub-agent',
        networks: ['Vodacom'],
      });
      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Phone number already registered');
    });

    it('should fail with invalid role', async () => {
      const response = await request.post('/api/auth/register').send({
        username: 'testagent2',
        name: 'Test Agent',
        email: 'testagent2@example.com',
        phone: '9876543210',
        password: 'securepassword',
        role: 'invalid',
        networks: ['Vodacom'],
      });
      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await db.none('DELETE FROM agents');
      await createAgent(
        'loginagent', 'Test Agent', 'loginagent@example.com', '1234567890',
        ['Vodacom'], [], 'sub-agent', await bcrypt.hash('securepassword', 10),
        null, null, null, null, null, null, 0, null, null, false
      );
    });

    it('should login with valid credentials', async () => {
      const response = await request.post('/api/auth/login').send({
        email: 'loginagent@example.com',
        password: 'securepassword',
      });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      const decoded = jwt.verify(response.body.token, process.env.JWT_SECRET);
      expect(decoded).toHaveProperty('id');
    });

    it('should fail with invalid credentials', async () => {
      const response = await request.post('/api/auth/login').send({
        email: 'loginagent@example.com',
        password: 'wrongpassword',
      });
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should fail with missing credentials', async () => {
      const response = await request.post('/api/auth/login').send({});
      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });
});