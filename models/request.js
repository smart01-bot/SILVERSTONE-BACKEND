import db from '../config/database.js';

const createRequest = async (subAgentId, subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency) => {
  return db.one(
    'INSERT INTO requests (sub_agent_id, subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
    [subAgentId, subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency, 'pending']
  );
};

const getRequestById = async (id) => {
  return db.oneOrNone('SELECT * FROM requests WHERE id = $1', [id]);
};

const updateRequestStatus = async (id, status) => {
  return db.one(
    'UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
};

const getAllRequestsData = async () => {
  return db.manyOrNone('SELECT * FROM requests');
};

const updateRequestData = async (id, subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency, status) => {
  const updates = [];
  const values = [id];
  let index = 2;

  if (subagent_name) {
    updates.push(`subagent_name = $${index}`);
    values.push(subagent_name);
    index++;
  }
  if (requested_network) {
    updates.push(`requested_network = $${index}`);
    values.push(requested_network);
    index++;
  }
  if (source_network) {
    updates.push(`source_network = $${index}`);
    values.push(source_network);
    index++;
  }
  if (requested_phoneNumber) {
    updates.push(`requested_phoneNumber = $${index}`);
    values.push(requested_phoneNumber);
    index++;
  }
  if (source_phoneNumber) {
    updates.push(`source_phoneNumber = $${index}`);
    values.push(source_phoneNumber);
    index++;
  }
  if (amount) {
    updates.push(`amount = $${index}`);
    values.push(amount);
    index++;
  }
  if (urgency !== undefined) {
    updates.push(`urgency = $${index}`);
    values.push(urgency);
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

  const query = `UPDATE requests SET ${updates.join(', ')} WHERE id = $1 RETURNING *`;
  return db.one(query, values);
};

const deleteRequestData = async (id) => {
  return db.none('DELETE FROM requests WHERE id = $1', [id]);
};

export { createRequest, getRequestById, updateRequestStatus, getAllRequestsData, updateRequestData, deleteRequestData };