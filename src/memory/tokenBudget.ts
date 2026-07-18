import { StoredMessage } from './types';

export function estimateTokens(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}

export function truncateText(text: string, maxTokens: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const maxWords = Math.floor(maxTokens / 1.3);
  if (words.length <= maxWords) return text;
  return words.slice(-maxWords).join(' ');
}

export function trimMessagesToBudget(messages: StoredMessage[], maxTokens: number): StoredMessage[] {
  const result: StoredMessage[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cost = estimateTokens(msg.content);
    if (used + cost > maxTokens) break;
    result.unshift(msg);
    used += cost;
  }

  return result;
}
