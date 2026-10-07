import express from 'express';
import dotenv from "dotenv";
dotenv.config({quiet: true});
import cors from 'cors';
import helmet from 'helmet';
import requestRoutes from './routes/requestRoutes.js';
import transferRoutes from './routes/transferRoutes.js';
import authRoutes from './routes/authRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import sseRoutes from './routes/sseRoutes.js';
import errorHandler from './middleware/errorHandler.js';
import cookieParser from 'cookie-parser';

// Initialize Express app and HTTP server
const app = express();
// Render is the single trusted reverse-proxy hop for the deployed service.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Middleware
app.use(helmet());
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8081',
  'https://svc-dashboard.netlify.app'
];
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., server-to-server) or from allowed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(express.json({ limit: '100kb' }));

app.use(cookieParser());

// Readiness is exposed only after index.js verifies dependency connections.
app.get('/health', async (req, res) => {
  let ready = app.locals.dependenciesReady === true;
  if (ready && app.locals.checkDependencies) {
    try { await app.locals.checkDependencies(); } catch { ready = false; }
  }
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'starting' });
});

// Routes
app.use('/api/requests', requestRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sse', sseRoutes);

app.use(errorHandler);
export default app;
