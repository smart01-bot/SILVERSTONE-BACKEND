import { verifyPublicSchema } from '../config/schema.js';
import { db } from './support/services.js';
it('checks the exact reviewed public column set without reading business rows', async () => {
  await expect(verifyPublicSchema(db)).resolves.toBeUndefined();
});
it('fails startup when a required table is missing', async () => {
  await expect(verifyPublicSchema({ manyOrNone: async () => [] })).rejects.toThrow('Required public schema');
});
