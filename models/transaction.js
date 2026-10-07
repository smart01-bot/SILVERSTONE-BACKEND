import db from '../config/database.js';
import { requestScope } from './request.js';
export const getAllTransactions = user => db.manyOrNone(
  `SELECT t.* FROM public.transaction_legs t JOIN public.transfer_requests r ON r.id = t.request_id WHERE ${requestScope(user, 'r.')} ORDER BY t.created_at DESC LIMIT 200`, [user.id]);
export const getTransactionById = (id, user) => db.oneOrNone(
  `SELECT t.* FROM public.transaction_legs t JOIN public.transfer_requests r ON r.id = t.request_id WHERE t.id = $2 AND ${requestScope(user, 'r.')}`, [user.id, id]);
