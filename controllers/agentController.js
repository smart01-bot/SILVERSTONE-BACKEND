import { check, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import db from '../config/database.js';
import {
  getAgentRequestsData, getAgentTransactionsData,
  updateAgentData, getAgent,
} from '../models/agent.js';
import { ROLES, NETWORKS } from '../utils/constants.js';

const getAgentHandler = async (req, res, next) => {
  try {
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const agent = await getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { passwordhash, ...safe } = agent;
    res.status(200).json(safe);
  } catch (error) {
    next(error);
  }
};

const getAllAgents = async (req, res, next) => {
  try {
    const agents = await db.manyOrNone(
      'SELECT id, username, name, email, phone, networks, agentphonenumbers, role, status, pin_set, createdat FROM agents'
    );
    res.status(200).json(agents);
  } catch (error) {
    next(error);
  }
};

const updateAgent = async (req, res, next) => {
  try {
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { password, ...rest } = req.body;

    const fields = { ...rest };
    if (password) fields.passwordhash = await bcrypt.hash(password, 10);

    // Map camelCase from client to snake_case DB columns
    const camelToSnake = {
      agentPhoneNumbers: 'agentphonenumbers',
      businessName:      'business_name',
      businessLocation:  'business_location',
      floatCapacity:     'float_capacity',
      regNo:             'reg_no',
      tinCertUrl:        'tin_cert_url',
      licenceCertUrl:    'licence_cert_url',
      selfieVerified:    'selfie_verified',
      pinSet:            'pin_set',
    };
    for (const [camel, snake] of Object.entries(camelToSnake)) {
      if (fields[camel] !== undefined) {
        fields[snake] = fields[camel];
        delete fields[camel];
      }
    }

    const updated = await updateAgentData(id, fields);
    const { passwordhash, ...safe } = updated;
    res.status(200).json(safe);
  } catch (error) {
    next(error);
  }
};

const deleteAgent = async (req, res, next) => {
  try {
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const agent = await db.oneOrNone('SELECT id FROM agents WHERE id = $1', [req.params.id]);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    await db.none('DELETE FROM agents WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const getAgentData = async (req, res, next) => {
  try {
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const requests     = await getAgentRequestsData(id);
    const transactions = await getAgentTransactionsData(id);

    const totalRequestsAmount = (await db.one(
      'SELECT COALESCE(SUM(amount), 0) as total FROM requests WHERE sub_agent_id = $1', [id]
    )).total;

    const totalTransactionsAmount = (await db.one(
      'SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t JOIN requests r ON t.request_id = r.id WHERE r.sub_agent_id = $1', [id]
    )).total;

    res.status(200).json({
      requests,
      totalRequestsAmount:    parseFloat(totalRequestsAmount),
      transactions,
      totalTransactionsAmount: parseFloat(totalTransactionsAmount),
    });
  } catch (error) {
    next(error);
  }
};

const getAgentRequests = async (req, res, next) => {
  try {
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const requests = await getAgentRequestsData(req.params.id);
    res.status(200).json(requests);
  } catch (error) {
    next(error);
  }
};

const getAgentTransactions = async (req, res, next) => {
  try {
    await check('id').isUUID().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const transactions = await getAgentTransactionsData(req.params.id);
    res.status(200).json(transactions);
  } catch (error) {
    next(error);
  }
};

export {
  getAgentHandler as getAgent,
  getAllAgents, updateAgent, deleteAgent,
  getAgentRequests, getAgentTransactions, getAgentData,
};