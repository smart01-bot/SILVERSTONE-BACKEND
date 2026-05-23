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
import { getNextRequest } from './services/queueService.js';
import { processTransfer } from './services/transferService.js';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

// Initialize Express app and HTTP server
const app = express();

// Middleware
app.use(helmet());
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
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
app.use(express.json());

//body parser 
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cookieParser());

// Routes
app.use('/api/requests', requestRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sse', sseRoutes); 

// Background job to process queue every 1 seconds
setInterval(async () => {
  try {
    const request = await getNextRequest();
    if (request) await processTransfer(request.id);
  } catch (error) {
    console.error('Queue processing error:', error);
  }
}, 1000);

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 8800;
app.listen(PORT, () => console.log(`SERVER RUNNING ON PORT ${PORT}`));