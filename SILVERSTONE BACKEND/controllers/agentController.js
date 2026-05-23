import { check, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import db from '../config/database.js';
import { getAgentByPhone, getAgentRequestsData, getAgentTransactionsData, updateAgentData } from '../models/agent.js';
import { ROLES, NETWORKS } from '../utils/constants.js';

const getAgent = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const agent = await db.oneOrNone('SELECT id, username, email, phone, networks, agentPhoneNumbers, role, createdAt FROM agents WHERE id = $1', [id]);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    res.status(200).json({ ...agent });
  } catch (error) {
    next(error);
  }
};

const getAllAgents = async (req, res, next) => {
  try {
    const agents = await db.manyOrNone('SELECT id, username, email, phone, networks, agentPhoneNumbers, role, createdAt FROM agents');
    const agentList = [];

    for (const agent of agents) {
      agentList.push({
        ...agent
      })
    }
    res.status(200).json(agentList);
  } catch (error) {
    next(error);
  }
};

const updateAgent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, email, phone, password, networks, agentPhoneNumbers, role } = req.body;

    await Promise.all([
      check('id').isUUID().run(req),
      check('username').optional().isString().notEmpty().run(req),
      check('email').optional().isEmail().run(req),
      check('password').optional().isString().isLength({ min: 6 }).run(req),
      check('networks').optional().isArray().custom((arr) => arr.every(n => NETWORKS.includes(n))).run(req),
      check('agentPhoneNumbers').optional().isArray().custom((arr) => arr.every(p => typeof p === 'string')).run(req),
      check('role').optional().isString().run(req),
      check('username').optional().isString().notEmpty().run(req),
    ]);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    const updatedAgent = await updateAgentData(id, username, email, phone, networks, agentPhoneNumbers, role, passwordHash);

    res.status(200).json([updatedAgent]);
  } catch (error) {
    next(error);
  }
};

const deleteAgent = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const agent = await db.oneOrNone('SELECT id FROM agents WHERE id = $1', [id]);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    await db.none('DELETE FROM agents WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const getAgentData = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const requests = await getAgentRequestsData(id);

    const totalRequestsAmount = await db.one(
      'SELECT COALESCE(SUM(r.amount), 0) as total FROM requests r WHERE r.sub_agent_id = $1',
      [id]
    );

    const transactions = await getAgentTransactionsData(id);

    const totalTransactionsAmount = await db.one(
      'SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t JOIN requests r ON t.request_id = r.id WHERE r.sub_agent_id = $1',
      [id]
    );

    res.status(200).json({
      requests,
      totalRequestsAmount: parseFloat(totalRequestsAmount.total),
      transactions,
      totalTransactionsAmount: parseFloat(totalTransactionsAmount.total)
    });
  } catch (error) {
    next(error);
  }
};

const getAgentRequests = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const requests = await getAgentRequestsData(id);
    res.status(200).json(requests);
  } catch (error) {
    next(error);
  }
};

const getAgentTransactions = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const transactions = await getAgentTransactionsData(id);
    res.status(200).json(transactions);
  } catch (error) {
    next(error);
  }
};

export { getAgent, getAllAgents, updateAgent, deleteAgent, getAgentRequests, getAgentTransactions, getAgentData };