import Redis from 'ioredis';
import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB } from './config';

// Create Redis client instance
export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  db: REDIS_DB,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

// Handle connection events
redis.on('connect', () => {
  console.log('[REDIS] Connected to Redis server');
});

redis.on('error', (error) => {
  console.error('[REDIS ERROR]', error);
});

redis.on('close', () => {
  console.log('[REDIS] Connection closed');
});

// Helper function to get Redis key for conversation history
export function getHistoryKey(phoneNumber: string): string {
  return `conversation:${phoneNumber}`;
}

export function getSummaryKey(phoneNumber: string): string {
  return `conversation:${phoneNumber}:summary`;
}

