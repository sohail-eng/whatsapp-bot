import { redis } from '../redis';

const REPLY_DEDUP_TTL_SECONDS = 5;

export function normalizeMessageText(text: string): string {
  return text.trim().replace(/^`|`$/g, '').trim();
}

function getReplyDedupKey(senderId: string, messageText: string): string {
  return `replyDedup:${senderId}:${messageText}`;
}

function getBotSentKey(messageText: string): string {
  return `botSent:${messageText}`;
}

async function setWithExpiry(key: string): Promise<void> {
  await redis.set(key, '1', 'EX', REPLY_DEDUP_TTL_SECONDS);
}

export async function isRecentlyReplied(senderId: string, messageText: string): Promise<boolean> {
  const normalized = normalizeMessageText(messageText);
  if (!normalized) return false;

  try {
    const exists = await redis.exists(getReplyDedupKey(senderId, normalized));
    return exists === 1;
  } catch (error) {
    console.error('[DEDUP] Failed to check reply dedup:', error);
    return false;
  }
}

export async function isRecentlyBotSent(messageText: string): Promise<boolean> {
  const normalized = normalizeMessageText(messageText);
  if (!normalized) return false;

  try {
    const exists = await redis.exists(getBotSentKey(normalized));
    return exists === 1;
  } catch (error) {
    console.error('[DEDUP] Failed to check bot sent dedup:', error);
    return false;
  }
}

export async function markReplied(senderId: string, messageText: string): Promise<void> {
  const normalized = normalizeMessageText(messageText);
  if (!normalized) return;

  try {
    await setWithExpiry(getReplyDedupKey(senderId, normalized));
  } catch (error) {
    console.error('[DEDUP] Failed to mark replied message:', error);
  }
}

export async function markBotSent(messageText: string): Promise<void> {
  const normalized = normalizeMessageText(messageText);
  if (!normalized) return;

  try {
    await setWithExpiry(getBotSentKey(normalized));
  } catch (error) {
    console.error('[DEDUP] Failed to mark bot sent message:', error);
  }
}
