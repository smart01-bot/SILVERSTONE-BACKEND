import express from 'express';
import auth from '../middleware/auth.js';
import { getDashboardData } from '../controllers/dashboardController.js';

const router = express.Router();

router.get("/", auth(true), async (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': req.get('origin') || 'https://svc-dashboard.netlify.app',
        'Access-Control-Allow-Credentials': 'true'
    });

    // Send initial message
    res.write('event: connected\ndata: {"message": "Connected to dashboard updates"}\n\n');

    const interval = setInterval(async () => {
        try {
        const dashboardData = await getDashboardData();

        // Send data as SSE event
        res.write(`event: dashboard\ndata: ${JSON.stringify(dashboardData)}\n\n`);
        } catch (error) {
        console.error('❌ SSE Error:', error.message);
        res.write(`event: error\ndata: {"error": "Failed to fetch dashboard data"}\n\n`);
        }
    }, 2000); 

    // Handle client disconnect
    req.on('close', () => {
        clearInterval(interval);
        res.end();
        console.log('✅ SSE client disconnected');
    });
})

export default router;