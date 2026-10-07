import { createRequest, getAllRequestsData, getRequestById, canReadRequest, resolveNetwork } from '../models/request.js';
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const submitRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'sub-agent') return res.status(403).json({ error: 'Sub-agent access required' });
    const b = req.body;
    const origin = b.origin_network_id ?? b.source_network;
    const destination = b.destination_network_id ?? b.requested_network;
    const originAccount = b.origin_account_identifier ?? b.source_phoneNumber;
    const destinationAccount = b.destination_account_identifier ?? b.requested_phoneNumber;
    const amount = String(b.amount ?? '');
    if (![origin, destination, originAccount, destinationAccount].every(v => typeof v === 'string' && v.trim() && v.length <= 128)
      || !/^\d{1,15}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || b.urgency === true) {
      return res.status(400).json({ error: 'Provide valid networks, account identifiers and a positive amount; urgency is unsupported by this schema' });
    }
    const [from, to] = await Promise.all([resolveNetwork(origin), resolveNetwork(destination)]);
    if (!from || !to || from.id === to.id) return res.status(400).json({ error: 'Choose two different active networks' });
    const request = await createRequest(req.user.id, amount, from.id, originAccount.trim(), to.id, destinationAccount.trim());
    // The database default pending_pin is preserved. No queue/payment execution.
    res.status(201).json({ request });
  } catch (error) { next(error); }
};
export const getAllRequests = async (req, res, next) => {
  try { res.json(await getAllRequestsData(req.user)); } catch (error) { next(error); }
};
export const getSingleRequest = async (req, res, next) => {
  try {
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'Invalid request ID' });
    const request = await getRequestById(req.params.id);
    if (!canReadRequest(req.user, request)) return res.status(404).json({ error: 'Request not found' });
    res.json([request]);
  } catch (error) { next(error); }
};
export const updateRequest = (req, res) => res.status(503).json({ error: 'Request lifecycle changes require the verified transfer workflow' });
export const deleteRequest = updateRequest;
