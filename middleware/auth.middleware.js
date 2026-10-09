import jwt from 'jsonwebtoken';

// Supports both httpOnly cookie (web dashboard) and Bearer token (mobile app)
const auth = (restrictToAdmin = false) => {
  return (req, res, next) => {
    let token = req.cookies?.accessToken;

    if (!token) {
      const authHeader = req.headers.authorization;
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

      if (restrictToAdmin && decoded.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
};

export default auth;
