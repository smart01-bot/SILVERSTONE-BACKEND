import db from '../config/database.js';

const getRevenueMetrics = async (req, res, next) => {
  try {
    const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const previousMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const previousMonthEnd = new Date(currentMonthStart - 1);

    // REVENUE
    const totalRevenue = (await db.one(
        'SELECT COALESCE(SUM(amount), 0) as total FROM transactions'
    )).total;

    const currentRevenue = (await db.one(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE created_at >= $1',
      [currentMonthStart]
    )).total;

    const previousRevenue = (await db.one(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE created_at BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).total;

    const revenuePercentage = previousRevenue ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : 0;

    // REQUESTS
    const totalRequests = (await db.one(
      'SELECT COUNT(*) as count FROM requests'
    )).count;

    const dailyRequestsCount = (await db.one(
        `SELECT COUNT(*) as count FROM requests WHERE created_at >= NOW() - INTERVAL '1 day'`
    )).count;

    const currentRequests = (await db.one(
      'SELECT COUNT(*) as count FROM requests WHERE created_at >= $1',
      [currentMonthStart]
    )).count;

    const previousRequests = (await db.one(
      'SELECT COUNT(*) as count FROM requests WHERE created_at BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).count;

    const requestsPercentage = previousRequests ? ((currentRequests - previousRequests) / previousRequests * 100).toFixed(1) : 0;

    // TRANSACTIONS
    const totalTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions'
    )).count;

    const dailyTransactionsCount = (await db.one(
        `SELECT COUNT(*) as count FROM transactions WHERE created_at >= NOW() - INTERVAL '1 day'`
    )).count;

    const currentTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions WHERE created_at >= $1',
      [currentMonthStart]
    )).count;

    const previousTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions WHERE created_at BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).count;

    const transactionsPercentage = previousTransactions ? ((currentTransactions - previousTransactions) / previousTransactions * 100).toFixed(1) : 0;

    // SUB-AGENTS
    const totalSubAgents = (await db.one(
      'SELECT COUNT(*) as count FROM agents'
    )).count;

    const dailyAgentsCount = (await db.one(
        `SELECT COUNT(*) as count FROM agents WHERE createdat >= NOW() - INTERVAL '1 day'`
    )).count;

    const currentSubAgents = (await db.one(
      'SELECT COUNT(*) as count FROM agents WHERE createdat >= $1',
      [currentMonthStart]
    )).count;

    const previousSubAgents = (await db.one(
      'SELECT COUNT(*) as count FROM agents WHERE createdat BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).count;

    const subAgentsPercentage = previousSubAgents ? ((currentSubAgents - previousSubAgents) / previousSubAgents * 100).toFixed(1) : 0;



    res.status(200).json({
        // revenue
        currentRevenue,
        previousRevenue,
        revenuePercentage,
        totalRevenue,

        // requests
        dailyRequestsCount,
        currentRequests,
        previousRequests,
        requestsPercentage,
        totalRequests,

        // transactions
        dailyTransactionsCount,
        currentTransactions,
        previousTransactions,
        transactionsPercentage,
        totalTransactions,

        // subagents
        dailyAgentsCount,
        currentSubAgents,
        previousSubAgents,
        subAgentsPercentage,
        totalSubAgents
    });
  } catch (error) {
    next(error);
  }
};

const getMonthlyCounts = async (req, res, next) => {
  try {
    const months = [];
    for (let i = 6; i >= 0; i--) {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
      const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() - i + 1, 0);

      const requests = (await db.one(
        'SELECT COUNT(*) as count FROM requests WHERE created_at BETWEEN $1 AND $2',
        [monthStart, monthEnd]
      )).count;

      const transactions = (await db.one(
        'SELECT COUNT(*) as count FROM transactions WHERE created_at BETWEEN $1 AND $2',
        [monthStart, monthEnd]
      )).count;

      months.push({
        month: monthStart.toLocaleString('default', { month: 'long' }),
        requests,
        transactions
      });
    }

    res.status(200).json(months);
  } catch (error) {
    next(error);
  }
};

const getPerformanceMetrics = async (req, res, next) => {
  try {
    const totalTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions'
    )).count;

    const completedTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions WHERE status = $1',
      ['completed']
    )).count;

    const successRate = totalTransactions ? (parseFloat(completedTransactions / totalTransactions * 100).toFixed(1)) : '0.0';

    const averageTransactionAmount = parseFloat((await db.one(
      'SELECT COALESCE(AVG(amount), 0) as average FROM transactions'
    )).average).toFixed(1);

    const averageRequestAmount = parseFloat((await db.one(
      'SELECT COALESCE(AVG(amount), 0) as average FROM requests'
    )).average).toFixed(1);

    const pendingRequestAging = parseFloat((await db.one(
      'SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600), 0) as average_hours FROM requests WHERE status = $1',
      ['pending']
    )).average_hours).toFixed(1);

    const pendingTransactionAging = parseFloat((await db.one(
      'SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600), 0) as average_hours FROM transactions WHERE status = $1',
      ['pending']
    )).average_hours).toFixed(1);

    res.status(200).json({
      transactionSuccessRate: successRate,
      averageTransactionAmount,
      averageRequestAmount,
      pendingRequestAging,
      pendingTransactionAging
    });
  } catch (error) {
    next(error);
  }
};

const getRequestsPerNetwork = async (req, res, next) => {
  try {
    const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const previousMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const previousMonthEnd = new Date(currentMonthStart - 1);

    const currentRequests = (await db.manyOrNone(
      'SELECT requested_network, COUNT(*) as count FROM requests WHERE created_at >= $1 GROUP BY requested_network ORDER BY count DESC',
      [currentMonthStart]
    ));

    const previousRequests = (await db.manyOrNone(
      'SELECT requested_network, COUNT(*) as count FROM requests WHERE created_at BETWEEN $1 AND $2 GROUP BY requested_network',
      [previousMonthStart, previousMonthEnd]
    ));

    const previousMap = previousRequests.reduce((map, item) => {
      map[item.requested_network] = item.count;
      return map;
    }, {});

    const requestsPerNetwork = currentRequests.map(item => {
      const previousCount = previousMap[item.requested_network] || 0;
      const percentageChange = previousCount ? ((item.count - previousCount) / previousCount * 100).toFixed(1) : 0;
      return {
        network: item.requested_network,
        currentRequests: item.count,
        previousRequests: previousCount,
        percentageChange
      };
    });

    res.status(200).json(requestsPerNetwork);
  } catch (error) {
    next(error);
  }
};

const getTopPerformingAgents = async (req, res, next) => {
  try {
    const topAgents = await db.manyOrNone(
      'SELECT a.id, a.username, a.role, COUNT(r.id) as requests, COALESCE(SUM(r.amount), 0) as requestAmount ' +
      'FROM agents a LEFT JOIN requests r ON a.id = r.sub_agent_id ' +
      'GROUP BY a.id ORDER BY requestAmount DESC LIMIT 10'
    );

    res.status(200).json(topAgents);
  } catch (error) {
    next(error);
  }
};

export const getDashboardData = async () => {
  try {
    const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const previousMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const previousMonthEnd = new Date(currentMonthStart - 1);

    // REVENUE
    const totalRevenue = (await db.one(
        'SELECT COALESCE(SUM(amount), 0) as total FROM transactions'
    )).total;

    const currentRevenue = (await db.one(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE created_at >= $1',
      [currentMonthStart]
    )).total;

    const previousRevenue = (await db.one(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE created_at BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).total;

    const revenuePercentage = previousRevenue ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : 0;

    // REQUESTS
    const totalRequests = (await db.one(
      'SELECT COUNT(*) as count FROM requests'
    )).count;

    const dailyRequestsCount = (await db.one(
        `SELECT COUNT(*) as count FROM requests WHERE created_at >= NOW() - INTERVAL '1 day'`
    )).count;

    const currentRequests = (await db.one(
      'SELECT COUNT(*) as count FROM requests WHERE created_at >= $1',
      [currentMonthStart]
    )).count;

    const previousRequests = (await db.one(
      'SELECT COUNT(*) as count FROM requests WHERE created_at BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).count;

    const requestsPercentage = previousRequests ? ((currentRequests - previousRequests) / previousRequests * 100).toFixed(1) : 0;

    // TRANSACTIONS
    const totalTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions'
    )).count;

    const dailyTransactionsCount = (await db.one(
        `SELECT COUNT(*) as count FROM transactions WHERE created_at >= NOW() - INTERVAL '1 day'`
    )).count;

    const currentTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions WHERE created_at >= $1',
      [currentMonthStart]
    )).count;

    const previousTransactions = (await db.one(
      'SELECT COUNT(*) as count FROM transactions WHERE created_at BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).count;

    const transactionsPercentage = previousTransactions ? ((currentTransactions - previousTransactions) / previousTransactions * 100).toFixed(1) : 0;

    // SUB-AGENTS
    const totalSubAgents = (await db.one(
      'SELECT COUNT(*) as count FROM agents'
    )).count;

    const dailyAgentsCount = (await db.one(
        `SELECT COUNT(*) as count FROM agents WHERE createdat >= NOW() - INTERVAL '1 day'`
    )).count;

    const currentSubAgents = (await db.one(
      'SELECT COUNT(*) as count FROM agents WHERE createdat >= $1',
      [currentMonthStart]
    )).count;

    const previousSubAgents = (await db.one(
      'SELECT COUNT(*) as count FROM agents WHERE createdat BETWEEN $1 AND $2',
      [previousMonthStart, previousMonthEnd]
    )).count;

    const subAgentsPercentage = previousSubAgents ? ((currentSubAgents - previousSubAgents) / previousSubAgents * 100).toFixed(1) : 0;
      

    return {
      revenueMetrics: {
        // revenue
        currentRevenue,
        previousRevenue,
        revenuePercentage,
        totalRevenue,

        // requests
        dailyRequestsCount,
        currentRequests,
        previousRequests,
        requestsPercentage,
        totalRequests,

        // transactions
        dailyTransactionsCount,
        currentTransactions,
        previousTransactions,
        transactionsPercentage,
        totalTransactions,

        // subagents
        dailyAgentsCount,
        currentSubAgents,
        previousSubAgents,
        subAgentsPercentage,
        totalSubAgents
      }
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error.message);
    throw error;
  }
};

export { getRevenueMetrics, getMonthlyCounts, getPerformanceMetrics, getRequestsPerNetwork, getTopPerformingAgents };