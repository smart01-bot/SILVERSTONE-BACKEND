import redis from '../config/redis.js';
import { addToQueue, getQueuePosition, getNextRequest } from '../services/queueService.js';
import { createRequest } from '../models/request.js';
import db from '../config/database.js';
import { createAgent } from '../models/agent.js';
import bcrypt from 'bcrypt';

describe('Queue Management', () => {
  let agentId;

  beforeAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    const agent = await createAgent(
      'queueagent', 'Test Agent', 'queueagent@example.com', '1234567890',
      ['Vodacom'], [], 'sub-agent', await bcrypt.hash('password', 10),
      null, null, null, null, null, null, 0, null, null, false
    );
    agentId = agent.id;
  });

  // Each test starts with an empty queue -- getNextRequest pops from float_queue,
  // so leftover entries from a prior test would otherwise bleed into the next one.
  beforeEach(async () => {
    await redis.flushAll();
  });

  afterAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    await redis.quit();
    await db.$pool.end();
  });

  it('should add request to queue and retrieve position', async () => {
    const requestData = await createRequest(agentId, 'Test Agent', 'Vodacom', 'Airtel', '1234567890', '0987654321', 100000, true);
    await addToQueue(requestData.id, Date.now() + 1000000);
    const position = await getQueuePosition(requestData.id);
    expect(position).toBe(1);
  });

  it('should prioritize urgent requests', async () => {
    const request1 = await createRequest(agentId, 'Test Agent', 'Vodacom', 'Airtel', '1234567890', '0987654321', 100000, false);
    const request2 = await createRequest(agentId, 'Test Agent', 'Vodacom', 'Airtel', '1234567890', '0987654321', 200000, true);
    await addToQueue(request1.id, Date.now());
    await addToQueue(request2.id, Date.now() + 1000000);
    const nextRequest = await getNextRequest();
    expect(nextRequest.id).toBe(request2.id); // Urgent request processed first
  });

  it('should handle empty queue', async () => {
    const nextRequest = await getNextRequest();
    expect(nextRequest).toBeNull();
  });
});