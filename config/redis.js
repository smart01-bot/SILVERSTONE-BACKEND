import { createClient } from 'redis';
import dotenv from "dotenv";
dotenv.config({quiet: true});

const client = createClient({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        connectTimeout: 10000,
        reconnectStrategy: false,
        tls: true,
        rejectUnauthorized: true,
    }
});

client.on('error', () => console.error('Redis connection error'));

client.on("ready", () => {
  console.log("✅ Redis client connected and ready to use!");
});

// Connection is initiated explicitly by index.js.

export default client;