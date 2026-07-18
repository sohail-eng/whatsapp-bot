import {
  MAX_STORED_MESSAGES,
  SUMMARIZE_BATCH_SIZE,
  SUMMARY_TOKEN_BUDGET,
} from '../config';
import {
  getMessages,
  getSummary,
  setSummary,
  trimOldest,
} from './conversationStore';
import { buildSummaryPrompt } from './promptBuilder';
import { truncateText } from './tokenBudget';
import { ChatMessage } from './types';

type AskOllamaChatFn = (messages: ChatMessage[]) => Promise<string>;

export async function maybeSummarizeHistory(
  userId: string,
  askOllamaChat: AskOllamaChatFn,
): Promise<void> {
  const messages = await getMessages(userId);
  if (messages.length <= MAX_STORED_MESSAGES) return;

  const batch = messages.slice(0, SUMMARIZE_BATCH_SIZE);
  const existingSummary = await getSummary(userId);
  const summaryMessages = buildSummaryPrompt(existingSummary, batch);

  try {
    const newSummary = await askOllamaChat(summaryMessages);
    if (!newSummary.trim()) return;

    const capped = truncateText(newSummary.trim(), SUMMARY_TOKEN_BUDGET);
    await setSummary(userId, capped);
    await trimOldest(userId, SUMMARIZE_BATCH_SIZE);
    console.log(`[SUMMARY] Updated summary for ${userId} (${capped.length} chars)`);
  } catch (error) {
    console.error('[SUMMARY ERROR] Failed to summarize history:', error);
  }
}
