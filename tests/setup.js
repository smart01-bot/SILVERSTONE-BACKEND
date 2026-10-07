import { jest, beforeEach, afterAll } from '@jest/globals';
import { db, redis, resetServices } from './support/services.js';

// No environment credentials or remote services are used by this test suite.
process.env.JWT_SECRET = 'isolated-test-signing-key';
await jest.unstable_mockModule('../config/database.js', () => ({ default: db }));
await jest.unstable_mockModule('../config/redis.js', () => ({ default: redis }));
beforeEach(resetServices);
afterAll(() => db.$pool.end());
