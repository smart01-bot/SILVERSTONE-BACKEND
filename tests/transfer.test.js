import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import app from '../index.js';
import db from '../config/database.js';
import redis from '../config/redis.js';
import { createAgent } from '../models/agent.js';
import { createRequest } from '../models/request.js';
import { processTransfer } from '../services/transferService.js';
import bcrypt from 'bcrypt';

const request = supertest(createServer(app));

describe('Transfer Processing', () => {
  let token;
  let agentId;

  beforeAll(async () => {
    await db.none('DELETE FROM transactions');
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    const agent = await createAgent(
      'transferagent', 'Test Agent', 'transferagent@example.com', '1234567890',
      ['Vodacom'], [], 'main-agent', await bcrypt.hash('password', 10),
      null, null, null, null, null, null, 0, null, null, false
    );
    agentId = agent.id;
    token = jwt.sign({ id: agent.id, role: 'main-agent' }, process.env.JWT_SECRET, { expiresIn: '1h' });
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
      const requestData = await createRequest(agentId, 'Test Agent', 'Vodacom', 'Vodacom', '1234567890', '0987654321', 100000, false);
      const response = await request.post('/api/transfers/process')
        .set('Authorization', `Bearer ${token}`)
        .send({ requestId: requestData.id });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      const transaction = await db.oneOrNone('SELECT * FROM transactions WHERE request_id = $1', [requestData.id]);
      expect(transaction).toBeDefined();
    });

    it('should process cross-network transfer', async () => {
      const requestData = await createRequest(agentId, 'Test Agent', 'Vodacom', 'Airtel', '1234567890', '0987654321', 100000, false);
      const response = await request.post('/api/transfers/process')
        .set('Authorization', `Bearer ${token}`)
        .send({ requestId: requestData.id });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('awaiting_confirmation');
    });

    it('should fail with a request ID that does not exist', async () => {
      // Must be a well-formed UUID -- the route validates format with isUUID()
      // before the controller ever looks the row up, so a non-UUID value like
      // 999 would 400 on validation rather than exercise the "not found" path.
      const response = await request.post('/api/transfers/process')
        .set('Authorization', `Bearer ${token}`)
        .send({ requestId: '00000000-0000-0000-0000-000000000000' });
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Request not found');
    });
  });

  describe('processTransfer', () => {
    it('should handle same-network transfer', async () => {
      const requestData = await createRequest(agentId, 'Test Agent', 'Vodacom', 'Vodacom', '1234567890', '0987654321', 100000, false);
      const result = await processTransfer(requestData.id);
      expect(result.status).toBe('completed');
    });
  });
});