import { processTransfer } from '../services/transferService.js';
import { getNextRequest } from '../services/queueService.js';
it('does not run the legacy transfer processor or consume Redis entries', async () => {
  await expect(processTransfer('fixture')).rejects.toMatchObject({ status: 503 });
  await expect(getNextRequest()).rejects.toMatchObject({ status: 503 });
});
