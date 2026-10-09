import { getRequestById, updateRequestStatus } from '../models/request.js';
import { createTransaction, getTransactionByRequestId } from '../models/transaction.js';
import redis from '../config/redis.js';

const processTransfer = async (requestId) => {
  try {
    const existingTransaction = await getTransactionByRequestId(requestId);
    if (existingTransaction) {
      throw { status: 409, message: 'Transaction already exists for this request' };
    }

    const request = await getRequestById(requestId);
    if (!request) {
      throw { status: 404, message: 'Request not found' };
    }

    const { amount, subagent_name, source_network, requested_network, requested_phonenumber, source_phonenumber } = request;

    if (source_network === requested_network) {
      // Same-network transfer
      const transaction = await createTransaction(
        requestId,
        amount,
        subagent_name,
        source_network,
        requested_network,
        requested_phonenumber,
        source_phonenumber,
        'completed'
      );
      await updateRequestStatus(requestId, 'completed');
      await redis.zRem('float_queue', String(requestId));
      return { status: 'completed', request, transaction };
    } else {
      // Cross-network transfer (mocked API call)
      try {
        /*await axios.post('https://api.payment-provider.com/transfer', {
          amount,
          source_network,
          destination_network: requested_network,
          source_phoneNumber,
          destination_phoneNumber: requested_phoneNumber,
        });*/
        const transaction = await createTransaction(
          requestId,
          amount,
          subagent_name,
          source_network,
          requested_network,
          requested_phonenumber,
          source_phonenumber,
          'pending'
        );
        await updateRequestStatus(requestId, 'pending');
        await redis.zRem('float_queue', String(requestId));
        return { status: 'awaiting_confirmation', request, transaction };
      } catch (error) {
        throw { status: 500, message: 'Failed to process cross-network transfer' };
      }
    }
  } catch (error) {
    throw error.status ? error : { status: 500, message: 'Internal server error' };
  }
};

export { processTransfer };