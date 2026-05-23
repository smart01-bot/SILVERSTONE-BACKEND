import db from '../config/database.js';
import { ROLES, NETWORKS } from '../utils/constants.js';

const createAgent = async (username, email, phone, networks, agentPhoneNumbers, role, passwordHash) => {
  if (!ROLES.includes(role)) {
    return Promise.reject({ status: 400, message: 'Invalid role' });
  }
  const existingAgent = await db.oneOrNone('SELECT * FROM agents WHERE phone = $1', [phone]);
  if (existingAgent) {
    return Promise.reject({ status: 409, message: 'Phone number already registered' });
  }
  const existingAgentEmail = await db.oneOrNone('SELECT * FROM agents WHERE email = $1', [email]);
  if (existingAgentEmail) {
    return Promise.reject({ status: 409, message: 'Email already registered' });
  }
  return db.one(
    'INSERT INTO agents (username, email, phone, networks, agentPhoneNumbers, role, passwordHash) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email, phone, networks, agentPhoneNumbers, role, createdAt',
    [username, email, phone, networks, agentPhoneNumbers, role, passwordHash]
  );
};

const getAgentByPhone = async (phone) => {
  return db.oneOrNone('SELECT * FROM agents WHERE phone = $1', [phone]);
};

const getAgentByName = async (username) => {
  return db.oneOrNone('SELECT * FROM agents WHERE name = $1', [username]);
}

const getAgentByEmail = async (email) => {
  return db.oneOrNone('SELECT * FROM agents WHERE email = $1', [email]);
};

const getAgent = async (id) => {
  return db.oneOrNone('SELECT * FROM agents WHERE id = $1', [id]);
};

const getAllAgents = async () => {
  return db.manyOrNone('SELECT * FROM agents');
};

const updateAgentData = async (id, username, email, phone, networks, agentPhoneNumbers, role, passwordHash) => {
  const updates = [];
  const values = [id];
  let index = 2;

  if (username) {
    updates.push(`username = $${index}`);
    values.push(username);
    index++;
  }
  if (email) {
    updates.push(`email = $${index}`);
    values.push(email);
    index++;
  }
  if (phone) {
    updates.push(`phone = $${index}`);
    values.push(phone);
    index++;
  }
  if (networks) {
    updates.push(`networks = $${index}`);
    values.push(networks);
    index++;
  }
  if (agentPhoneNumbers) {
    updates.push(`agentPhoneNumbers = $${index}`);
    values.push(agentPhoneNumbers);
    index++;
  }
  if (role) {
    updates.push(`role = $${index}`);
    values.push(role);
    index++;
  }
  if (passwordHash) {
    updates.push(`password_hash = $${index}`);
    values.push(passwordHash);
    index++;
  }

  if (updates.length === 0) {
    return Promise.reject({ status: 400, message: 'No fields to update' });
  }

  const query = `UPDATE agents SET ${updates.join(', ')} WHERE id = $1 RETURNING *`;
  return db.one(query, values);
};

const deleteAgent = async (id) => {
  return db.none('DELETE FROM agents WHERE id = $1', [id]);
};

const getAgentRequestsData = async (id) => {
  return db.manyOrNone('SELECT * FROM requests WHERE sub_agent_id = $1', [id]);
};

const getAgentTransactionsData = async (id) => {
  return db.manyOrNone(
    'SELECT t.* FROM transactions t JOIN requests r ON t.request_id = r.id WHERE r.sub_agent_id = $1',
    [id]
  );
};

export { createAgent, getAgentByPhone, getAgentByName, getAgentByEmail, getAgent, getAllAgents, updateAgentData, deleteAgent, getAgentRequestsData, getAgentTransactionsData };