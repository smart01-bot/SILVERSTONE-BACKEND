import { check, validationResult } from 'express-validator';
import db from '../config/database.js';

const getAgentAnalytics = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    await check('agentId').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const transactions = await db.manyOrNone(
      'SELECT t.* FROM transactions t JOIN requests r ON t.request_id = r.id WHERE r.sub_agent_id = $1',
      [agentId]
    );
    const totalAmount = await db.one(
      'SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t JOIN requests r ON t.request_id = r.id WHERE r.sub_agent_id = $1',
      [agentId]
    );

    res.status(200).json({ transactions, totalAmount: totalAmount.total });
  } catch (error) {
    next(error);
  }
};

const getTimeBasedAnalytics = async (req, res, next) => {
  try {
    const { period } = req.query;
    await check('period').isIn(['daily', 'weekly', 'monthly']).run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let dateFilter;
    switch (period) {
      case 'daily':
        dateFilter = "created_at >= NOW() - INTERVAL '1 day'";
        break;
      case 'weekly':
        dateFilter = "created_at >= NOW() - INTERVAL '1 week'";
        break;
      case 'monthly':
        dateFilter = "created_at >= NOW() - INTERVAL '1 month'";
        break;
    }

    const requests = await db.manyOrNone(`SELECT * FROM requests WHERE ${dateFilter}`);
    const transactions = await db.manyOrNone(`SELECT * FROM transactions WHERE ${dateFilter}`);
    
    const requestCount = requests.length;
    const transactionCount = transactions.length;
    const completedRequests = await db.one(
      `SELECT COUNT(*) as count FROM requests WHERE ${dateFilter} AND status = 'completed'`
    );
    const pendingRequests = await db.one(
      `SELECT COUNT(*) as count FROM requests WHERE ${dateFilter} AND status = 'pending'`
    );
    const completedTransaction = await db.one(
      `SELECT COUNT(*) as count FROM transactions WHERE ${dateFilter} AND status = 'completed'`
    );
    const pendingTransaction = await db.one(
      `SELECT COUNT(*) as count FROM transactions WHERE ${dateFilter} AND status = 'pending'`
    );
    const totalRequestAmount = (await db.one(
      `SELECT COALESCE(SUM(amount), 0) as total FROM requests WHERE ${dateFilter}`
    )).total;
    const totalTransactionAmount = (await db.one(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${dateFilter}`
    )).total;

    res.status(200).json({
      requests,
      transactions,
      summary: {
        requestCount,
        transactionCount,
        completedRequestCount: parseInt(completedRequests.count),
        pendingRequestCount: parseInt(pendingRequests.count),
        completedTransactionCount: parseInt(completedTransaction.count),
        pendingTransactionCount: parseInt(pendingTransaction.count),
        totalRequestAmount,
        totalTransactionAmount,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getTimeBasedRequests = async (req, res, next) => {
  try {
    const { period } = req.query;
    await check('period').isIn(['daily', 'weekly', 'monthly']).run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let dateFilter, timeRange;
    const now = new Date();
    switch (period) {
      case 'daily':
        dateFilter = "created_at >= NOW() - INTERVAL '1 day'";
        timeRange = { start: new Date(now.setHours(0, 0, 0, 0)).toISOString().split('T')[0] };
        break;
      case 'weekly':
        dateFilter = "created_at >= NOW() - INTERVAL '1 week'";
        timeRange = {
          start: new Date(now.setDate(now.getDate() - 7)).toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0]
        };
        break;
      case 'monthly':
        dateFilter = "created_at >= NOW() - INTERVAL '1 month'";
        timeRange = {
          start: new Date(now.setMonth(now.getMonth() - 1)).toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0]
        };
        break;
    }

    const requests = await db.manyOrNone(`SELECT * FROM requests WHERE ${dateFilter}`);
    const requestCount = requests.length;
    const completedRequests = await db.one(
      `SELECT COUNT(*) as count FROM requests WHERE ${dateFilter} AND status = 'completed'`
    );
    const pendingRequests = await db.one(
      `SELECT COUNT(*) as count FROM requests WHERE ${dateFilter} AND status = 'pending'`
    );
    const totalRequestAmount = (await db.one(
      `SELECT COALESCE(SUM(amount), 0) as total FROM requests WHERE ${dateFilter}`
    )).total;
    const agentCount = (await db.one(
      `SELECT COUNT(DISTINCT sub_agent_id) as count FROM requests WHERE ${dateFilter}`
    )).count;

    res.status(200).json({
      requests,
      summary: {
        requestCount,
        completedRequestCount: parseInt(completedRequests.count),
        pendingRequestCount: parseInt(pendingRequests.count),
        totalRequestAmount,
        agentCount: parseInt(agentCount),
        timeRange
      }
    });
  } catch (error) {
    next(error);
  }
};

const getTimeBasedTransactions = async (req, res, next) => {
  try {
    const { period } = req.query;
    await check('period').isIn(['daily', 'weekly', 'monthly']).run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let dateFilter, timeRange;
    const now = new Date();
    switch (period) {
      case 'daily':
        dateFilter = "created_at >= NOW() - INTERVAL '1 day'";
        timeRange = { start: new Date(now.setHours(0, 0, 0, 0)).toISOString().split('T')[0] };
        break;
      case 'weekly':
        dateFilter = "created_at >= NOW() - INTERVAL '1 week'";
        timeRange = {
          start: new Date(now.setDate(now.getDate() - 7)).toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0]
        };
        break;
      case 'monthly':
        dateFilter = "created_at >= NOW() - INTERVAL '1 month'";
        timeRange = {
          start: new Date(now.setMonth(now.getMonth() - 1)).toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0]
        };
        break;
    }

    const transactions = await db.manyOrNone(`SELECT * FROM transactions WHERE ${dateFilter}`);
    const transactionCount = transactions.length;
    const completedTransactions = await db.one(
      `SELECT COUNT(*) as count FROM transactions WHERE ${dateFilter} AND status = 'completed'`
    );
    const pendingTransactions = await db.one(
      `SELECT COUNT(*) as count FROM transactions WHERE ${dateFilter} AND status = 'pending'`
    );
    const totalTransactionAmount = (await db.one(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${dateFilter}`
    )).total;
    const agentCount = (await db.one(
      `SELECT COUNT(DISTINCT sub_agent_id) as count FROM requests WHERE ${dateFilter}`
    )).count;

    res.status(200).json({
      transactions,
      summary: {
        transactionCount,
        completedTransactionCount: parseInt(completedTransactions.count),
        pendingTransactionCount: parseInt(pendingTransactions.count),
        totalTransactionAmount,
        agentCount: parseInt(agentCount),
        timeRange
      }
    });
  } catch (error) {
    next(error);
  }
};

const getTimeBasedRequestsMetrics = async (req, res, next) => {
  try {
    const periods = {
      daily: "created_at >= NOW() - INTERVAL '1 day'",
      weekly: "created_at >= NOW() - INTERVAL '1 week'",
      monthly: "created_at >= NOW() - INTERVAL '1 month'"
    };

    const totalRequestAmount = (await db.one(
      `SELECT COALESCE(SUM(amount), 0) as total FROM requests`
    )).total;

    const metrics = {};
    for (const [period, dateFilter] of Object.entries(periods)) {
      const requests = await db.manyOrNone(`SELECT * FROM requests WHERE ${dateFilter}`);
      const requestCount = requests.length;
      const completedRequests = await db.one(
        `SELECT COUNT(*) as count FROM requests WHERE ${dateFilter} AND status = 'completed'`
      );
      const pendingRequests = await db.one(
        `SELECT COUNT(*) as count FROM requests WHERE ${dateFilter} AND status = 'pending'`
      );
      
      const totalRequestAmount = (await db.one(
        `SELECT COALESCE(SUM(amount), 0) as total FROM requests WHERE ${dateFilter}`
      )).total;

      metrics[period] = {
        requestCount,
        completedRequestCount: parseInt(completedRequests.count),
        pendingRequestCount: parseInt(pendingRequests.count),
        totalRequestAmount
      };
    }

    res.status(200).json({metrics, totalRequestAmount});
  } catch (error) {
    next(error);
  }
};

const getTimeBasedTransactionsMetrics = async (req, res, next) => {
  try {
    const periods = {
      daily: "created_at >= NOW() - INTERVAL '1 day'",
      weekly: "created_at >= NOW() - INTERVAL '1 week'",
      monthly: "created_at >= NOW() - INTERVAL '1 month'"
    };

    const totalTransactionAmount = (await db.one(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions`
    )).total;

    const metrics = {};
    for (const [period, dateFilter] of Object.entries(periods)) {
      const transactions = await db.manyOrNone(`SELECT * FROM transactions WHERE ${dateFilter}`);
      const transactionCount = transactions.length;
      const completedTransactions = await db.one(
        `SELECT COUNT(*) as count FROM transactions WHERE ${dateFilter} AND status = 'completed'`
      );
      const pendingTransactions = await db.one(
        `SELECT COUNT(*) as count FROM transactions WHERE ${dateFilter} AND status = 'pending'`
      );
      const totalTransactionAmount = (await db.one(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${dateFilter}`
      )).total;

      metrics[period] = {
        transactionCount,
        completedTransactionCount: parseInt(completedTransactions.count),
        pendingTransactionCount: parseInt(pendingTransactions.count),
        totalTransactionAmount
      };
    }

    res.status(200).json({ metrics, totalTransactionAmount });
  } catch (error) {
    next(error);
  }
};


export { getAgentAnalytics, getTimeBasedAnalytics, getTimeBasedRequests, getTimeBasedTransactions, getTimeBasedRequestsMetrics, getTimeBasedTransactionsMetrics };