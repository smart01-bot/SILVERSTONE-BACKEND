import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import app from '../src/index.js';
import db from '../src/config/database.js';
import redis from '../src/config/redis.js';
import { createAgent } from '../src/models/agent.js';
import { createRequest } from '../src/models/request.js';
import { processTransfer } from '../src/services/transferService.js';
import axios from 'axios';
import bcrypt from 'bcrypt';

jest.mock('axios');

const request = supertest(createServer(app));

describe('Transfer Processing', () => {
  let token;

  beforeAll(async () => {
    await db.none('DELETE FROM transactions');
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    const agent = await createAgent('Test Agent', '1234567890', 'Vodacom', 'main-agent', await bcrypt.hash('password', 10));
    token = jwt.sign({ id: agent.id, role: 'main-agent' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    axios.post.mockResolvedValue({ status: 200 });
  });

  afterAll(async () => {
    await db.none('DELETE FROM transactions');
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    await redis.quit();
    await db.$pool.end();
  });

  describe('POST /api/transfers/process', () => {
    it('should process same-network transfer', async () => {
      const requestData = await createRequest(1, 'Vodacom', 'Vodacom', 100000, false);
      const response = await request.post('/api/transfers/process')
        .set('Authorization', `Bearer ${token}`)
        .send({ requestId: requestData.id });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      const transaction = await db.oneOrNone('SELECT * FROM transactions WHERE request_id = $1', [requestData.id]);
      expect(transaction).toBeDefined();
    });

    it('should process cross-network transfer', async () => {
      const requestData = await createRequest(1, 'Vodacom', 'Tigo', 100000, false);
      const response = await request.post('/api/transfers/process')
        .set('Authorization', `Bearer ${token}`)
        .send({ requestId: requestData.id });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('awaiting_confirmation');
    });

    it('should fail with invalid request ID', async () => {
      const response = await request.post('/api/transfers/process')
        .set('Authorization', `Bearer ${token}`)
        .send({ requestId: 999 });
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('processTransfer', () => {
    it('should handle same-network transfer', async () => {
      const requestData = await createRequest(1, 'Vodacom', 'Vodacom', 100000, false);
      const result = await processTransfer(requestData.id);
      expect(result.status).toBe('completed');
    });
  });
});