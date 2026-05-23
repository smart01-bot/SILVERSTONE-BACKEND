import db from '../config/database.js';

const createTransaction = async (requestId, amount, subagent_name, source_network, destination_network, destination_phoneNumber, source_phoneNumber, status) => {
  return db.one(
    'INSERT INTO transactions (request_id, amount, subagent_name, source_network, destination_network, destination_phoneNumber, source_phoneNumber, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [requestId, amount, subagent_name, source_network, destination_network, destination_phoneNumber, source_phoneNumber, status]
  );
};

const getTransactionById = async (id) => {
  return db.oneOrNone('SELECT * FROM transactions WHERE id = $1', [id]);
};

const getTransactionByRequestId = async (requestId) => {
  return db.oneOrNone('SELECT * FROM transactions WHERE request_id = $1', [requestId]);
}; 

const getAllTransactions = async () => {
  return db.manyOrNone('SELECT * FROM transactions');
};

const updateTransaction = async (id, amount, source_network, destination_network, destination_phoneNumber, source_phoneNumber, status) => {
  console.log("updated")
  const updates = [];
  const values = [id];
  let index = 2;

  if (amount) {
    updates.push(`amount = $${index}`);
    values.push(amount);
    index++;
  }
  if (source_network) {
    updates.push(`source_network = $${index}`);
    values.push(source_network);
    index++;
  }
  if (destination_network) {
    updates.push(`destination_network = $${index}`);
    values.push(destination_network);
    index++;
  }
  if (destination_phoneNumber) {
    updates.push(`destination_phoneNumber = $${index}`);
    values.push(destination_phoneNumber);
    index++;
  }
  if (source_phoneNumber) {
    updates.push(`source_phoneNumber = $${index}`);
    values.push(source_phoneNumber);
    index++;
  }
  if (status) {
    updates.push(`status = $${index}`);
    values.push(status);
    index++;
  }

  if (updates.length === 0) {
    return Promise.reject({ status: 400, message: 'No fields to update' });
  }

  const query = `UPDATE transactions SET ${updates.join(', ')} WHERE id = $1 RETURNING *`;
  return db.one(query, values);
};

const deleteTransaction = async (id) => {
  return db.none('DELETE FROM transactions WHERE id = $1', [id]);
};

export { createTransaction, getTransactionById, getAllTransactions, updateTransaction, deleteTransaction, getTransactionByRequestId };