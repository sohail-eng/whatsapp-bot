import { redis, getHistoryKey, getSummaryKey } from '../redis';
import { MAX_STORED_MESSAGES } from '../config';
import { parseStoredMessages, StoredMessage } from './types';

export async function getMessages(userId: string): Promise<StoredMessage[]> {
  try {
    const data = await redis.get(getHistoryKey(userId));
    if (!data) return [];
    return parseStoredMessages(data);
  } catch (error) {
    console.error('[REDIS ERROR] Failed to get messages:', error);
    return [];
  }
}

export async function appendMessage(userId: string, message: StoredMessage): Promise<void> {
  try {
    const messages = await getMessages(userId);
    messages.push({ ...message, timestamp: message.timestamp || Date.now() });
    const trimmed = messages.slice(-MAX_STORED_MESSAGES);
    await redis.set(getHistoryKey(userId), JSON.stringify(trimmed));
  } catch (error) {
    console.error('[REDIS ERROR] Failed to append message:', error);
  }
}

export async function getSummary(userId: string): Promise<string> {
  try {
    const summary = await redis.get(getSummaryKey(userId));
    return summary || '';
  } catch (error) {
    console.error('[REDIS ERROR] Failed to get summary:', error);
    return '';
  }
}

export async function setSummary(userId: string, summary: string): Promise<void> {
  try {
    await redis.set(getSummaryKey(userId), summary);
  } catch (error) {
    console.error('[REDIS ERROR] Failed to set summary:', error);
  }
}

export async function trimOldest(userId: string, count: number): Promise<void> {
  try {
    const messages = await getMessages(userId);
    const trimmed = messages.slice(count);
    await redis.set(getHistoryKey(userId), JSON.stringify(trimmed));
  } catch (error) {
    console.error('[REDIS ERROR] Failed to trim messages:', error);
  }
}

export function hasUserMessages(messages: StoredMessage[]): boolean {
  return messages.some((msg) => msg.role === 'user');
}
