import redis from '../src/config/redis.js';
import { addToQueue, getQueuePosition, getNextRequest } from '../src/services/queueService.js';
import { createRequest } from '../src/models/request.js';
import db from '../config/database.js';
import { createAgent } from '../src/models/agent.js';
import bcrypt from 'bcrypt';

describe('Queue Management', () => {
  beforeAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    await createAgent('Test Agent', '1234567890', 'Vodacom', 'sub-agent', await bcrypt.hash('password', 10));
  });

  afterAll(async () => {
    await db.none('DELETE FROM requests');
    await db.none('DELETE FROM agents');
    await redis.flushAll();
    await redis.quit();
    await db.$pool.end();
  });

  it('should add request to queue and retrieve position', async () => {
    const request = await createRequest(1, 'Vodacom', 'Tigo', 100000, true);
    await addToQueue(request.id, Date.now() + 1000000);
    const position = await getQueuePosition(request.id);
    expect(position).toBe(1);
  });

  it('should prioritize urgent requests', async () => {
    const request1 = await createRequest(1, 'Vodacom', 'Tigo', 100000, false);
    const request2 = await createRequest(1, 'Vodacom', 'Tigo', 200000, true);
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