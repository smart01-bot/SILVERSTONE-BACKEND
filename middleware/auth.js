import jwt from 'jsonwebtoken';

// Supports both httpOnly cookie (web dashboard) and Bearer token (mobile app).
// restrictToMainAgent=true gates a route to main agents only (approvals,
// dashboards, analytics, agent management, etc). Sub-agents and main agents
// are the only two roles in this system — there is no 'admin' role.
const auth = (restrictToMainAgent = false) => {
  return (req, res, next) => {
    let token = req.cookies?.accessToken;

    if (!token) {
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      if (restrictToMainAgent && decoded.role !== 'main-agent') {
        return res.status(403).json({ error: 'Main agent access required' });
      }

      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
};

export default auth;