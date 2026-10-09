import { createRequest, deleteRequestData, getAllRequestsData, getRequestById, updateRequestData } from '../models/request.js';
import { addToQueue, getQueuePosition } from '../services/queueService.js';
import { check, validationResult } from 'express-validator';
import { NETWORKS, REQUEST_STATUSES } from '../utils/constants.js';

const submitRequest = async (req, res, next) => {
  try {
    // Derived from the verified JWT, never from client input -- a sub-agent
    // must not be able to submit a request tagged under a different agent's ID.
    const subAgentId = req.user.id;
    const { subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency = false } = req.body;

    await Promise.all([
      check('subagent_name').isString().notEmpty().run(req),
      check('requested_network').isString().isIn(NETWORKS).run(req),
      check('source_network').optional().isString().isIn(NETWORKS).run(req),
      check('requested_phoneNumber').isString().notEmpty().run(req),
      check('source_phoneNumber').optional().isString().run(req),
      check('amount').isFloat({ min: 0 }).run(req),
      check('urgency').isBoolean().run(req),
    ]);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const request = await createRequest(subAgentId, subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency);
    const priorityScore = Date.now() + (urgency ? 1000000 : 0);
    await addToQueue(request.id, priorityScore);
    const position = await getQueuePosition(request.id);

    res.status(201).json({ request, queuePosition: position });
  } catch (error) {
    next(error);
  }
};

const getSingleRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const request = await getRequestById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    res.status(200).json([request]);
  } catch (error) {
    next(error);
  }
};

const getAllRequests = async (req, res, next) => {
  try {
    const requests = await getAllRequestsData();
    res.status(200).json(requests);
  } catch (error) {
    next(error);
  }
};

const updateRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency, status } = req.body;

    await Promise.all([
      check('id').isUUID().run(req),
      check('subagent_name').optional().isString().notEmpty().run(req),
      check('requested_network').optional().isString().isIn(NETWORKS).run(req),
      check('source_network').optional().isString().isIn(NETWORKS).run(req),
      check('requested_phoneNumber').optional().isString().run(req),
      check('source_phoneNumber').optional().isString().run(req),
      check('amount').optional().isFloat({ min: 0 }).run(req),
      check('urgency').optional().isBoolean().run(req),
      check('status').optional().isIn(REQUEST_STATUSES).run(req),
    ]);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updatedRequest = await updateRequestData(id, subagent_name, requested_network, source_network, requested_phoneNumber, source_phoneNumber, amount, urgency, status);

    res.status(200).json([updatedRequest]);
  } catch (error) {
    next(error);
  }
};

const deleteRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    await deleteRequestData(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export { submitRequest, getSingleRequest, getAllRequests, updateRequest, deleteRequest };