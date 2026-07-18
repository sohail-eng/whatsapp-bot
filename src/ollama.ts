import axios from 'axios';
import type { Message } from 'whatsapp-web.js';
import { markBotSent, markReplied, normalizeMessageText } from './utils/replyDedup';
import { safeReply } from './utils/safeReply';
import {
  extractPlaySongName,
  normalizePlayReply,
  shouldExecutePlayCommand,
} from './utils/playCommand';
import * as fs from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import {
  MY_NUMBER,
  MAX_RECENT_TURNS,
  HISTORY_TOKEN_BUDGET,
} from './config';
import commands from './commands';
import {
  appendMessage,
  getMessages,
  getSummary,
  hasUserMessages,
} from './memory/conversationStore';
import { buildChatMessages } from './memory/promptBuilder';
import {
  decisionToContextSelection,
  filterRecentMessages,
  selectContext,
} from './memory/contextRouter';
import { buildProfileReply } from './memory/profileResponder';
import {
  buildFallbackSchemaDecision,
  requestSchemaRouterDecision,
} from './memory/schemaRouter';
import { maybeSummarizeHistory } from './memory/summarizer';
import { estimateTokens, trimMessagesToBudget } from './memory/tokenBudget';
import { ChatMessage, SchemaRouterDecision, StoredMessage } from './memory/types';
export { askOllamaChat } from './ollamaClient';
import { askOllamaChat } from './ollamaClient';

export const WELCOME_MESSAGE = `👋 *Hello! I'm Sohail's personal WhatsApp assistant.*

Sohail is currently away from his phone, but I'm here to help you in the meantime!

------------------------------------

📞 *If it's important:*  
• You can call anytime.

🎤 *If it's for Sohail:*  
• Feel free to leave a voice message — he'll get back to you soon.

💬 *If you want to chat:*  
• I'm always here. Just send a text!

🎵 *Feeling bored and want music?*  
• Tell me your favorite song and I'll download it instantly.

------------------------------------

✨ *Music Command:*  
\`!play <your favourite song name>\`
`;

const LIMIT_PARALLEL_REQUESTS = 5;

const limit = pLimit(LIMIT_PARALLEL_REQUESTS);

function formatOllamaError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status ? `HTTP ${status}: ${error.message}` : error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

let userRequestQueue: Map<string, Promise<void> | null> = new Map();

async function handleRequestSequentially(userId: string, processRequest: () => Promise<void>) {
  if (userRequestQueue.has(userId)) {
    await userRequestQueue.get(userId);
  }

  userRequestQueue.set(userId, new Promise<void>(async (resolve, reject) => {
    try {
      await processRequest();
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      userRequestQueue.delete(userId);
    }
  }));

  return userRequestQueue.get(userId);
}

function mergeContextSelection(
  fallbackSelection: {
    language: 'english' | 'roman_urdu' | 'urdu';
    includeProfile: boolean;
    includeSummary: boolean;
    includeRecentHistory: boolean;
    maxAssistantMessages: number;
  },
  routerSelection: {
    language: 'english' | 'roman_urdu' | 'urdu';
    includeProfile: boolean;
    includeSummary: boolean;
    includeRecentHistory: boolean;
    maxAssistantMessages: number;
  },
): {
  language: 'english' | 'roman_urdu' | 'urdu';
  includeProfile: boolean;
  includeSummary: boolean;
  includeRecentHistory: boolean;
  maxAssistantMessages: number;
} {
  return {
    language: fallbackSelection.language === 'roman_urdu' ? 'roman_urdu' : routerSelection.language,
    includeProfile: fallbackSelection.includeProfile || routerSelection.includeProfile,
    includeSummary: fallbackSelection.includeSummary || routerSelection.includeSummary,
    includeRecentHistory: fallbackSelection.includeRecentHistory || routerSelection.includeRecentHistory,
    maxAssistantMessages: Math.max(
      fallbackSelection.maxAssistantMessages,
      routerSelection.maxAssistantMessages,
    ),
  };
}

function logTokenBreakdown(messages: ChatMessage[]): void {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const recent = messages.filter((m) => m.role !== 'system' && m !== messages[messages.length - 1]);
  const current = messages[messages.length - 1]?.content || '';

  const systemTokens = estimateTokens(system);
  const profileMatch = system.match(/Sohail profile:\n([\s\S]*?)(?:\n\n|$)/);
  const summaryMatch = system.match(/Long-term context for this user:\n([\s\S]*)$/);
  const profileTokens = profileMatch ? estimateTokens(profileMatch[1]) : 0;
  const summaryTokens = summaryMatch ? estimateTokens(summaryMatch[1]) : 0;
  const recentTokens = recent.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const currentTokens = estimateTokens(current);
  const total = systemTokens + recentTokens + currentTokens;

  console.log(
    `[TOKENS] system=${systemTokens} profile=${profileTokens} summary=${summaryTokens} recent=${recentTokens} current=${currentTokens} total=${total}`,
  );
}

export async function respondViaOllama(message: Message): Promise<void> {
  const userId = message.from;

  try {
    await limit(() => handleRequestSequentially(userId, async () => {
    if (message.from === MY_NUMBER) {
      if (message.body.startsWith('.')) {
        await appendMessage(message.to, {
          role: 'assistant',
          content: message.body,
          timestamp: Date.now(),
        });
      }
      return;
    }

    const storedMessages = await getMessages(message.from);
    const fallbackSelection = selectContext(message.body, storedMessages);
    let contextSelection = fallbackSelection;
    const fallbackDecision = buildFallbackSchemaDecision(message.body);
    let routerDecision: SchemaRouterDecision = fallbackDecision;
    let useCustomProfileReply = fallbackDecision.intent === 'profile_lookup'
      && fallbackDecision.requiredKeys.length > 0
      && !fallbackSelection.includeRecentHistory
      && !fallbackSelection.includeSummary;

    const isNewConversation = !hasUserMessages(storedMessages);
    if (isNewConversation) {
      await safeReply(message, WELCOME_MESSAGE);
      await markBotSent(WELCOME_MESSAGE);
    }

    try {
      const aiDecision = await requestSchemaRouterDecision(message.body, askOllamaChat);
      if (aiDecision) {
        // Keep heuristic profile keys when the AI router drops them.
        routerDecision = {
          ...aiDecision,
          requiredKeys: [...new Set([...fallbackDecision.requiredKeys, ...aiDecision.requiredKeys])],
          intent: fallbackDecision.intent === 'profile_lookup' && fallbackDecision.requiredKeys.length > 0
            ? 'profile_lookup'
            : aiDecision.intent,
        };
        const aiSelection = decisionToContextSelection(routerDecision);
        // Clear profile questions should stay on the profile path; don't let "mixed" pull in summary/history.
        if (fallbackDecision.intent === 'profile_lookup' && fallbackDecision.requiredKeys.length > 0) {
          contextSelection = {
            ...decisionToContextSelection(routerDecision),
            language: fallbackSelection.language === 'roman_urdu'
              ? 'roman_urdu'
              : aiSelection.language,
          };
          useCustomProfileReply = true;
        } else {
          contextSelection = mergeContextSelection(fallbackSelection, aiSelection);
          useCustomProfileReply = routerDecision.intent === 'profile_lookup'
            && routerDecision.requiredKeys.length > 0
            && !contextSelection.includeRecentHistory
            && !contextSelection.includeSummary;
        }
      }
    } catch (error) {
      console.warn('[SCHEMA_ROUTER] fallback=heuristic', formatOllamaError(error));
    }

    if (
      useCustomProfileReply
      && routerDecision.requiredKeys.length > 0
    ) {
      const replyText = buildProfileReply(
        routerDecision.requiredKeys,
        contextSelection.language,
        routerDecision.answerStyle,
      );
      await appendMessage(message.from, {
        role: 'user',
        content: message.body,
        timestamp: Date.now(),
      });
      await appendMessage(message.from, {
        role: 'assistant',
        content: replyText,
        timestamp: Date.now(),
      });
      await safeReply(message, replyText);
      await markBotSent(replyText);
      await markReplied(message.from, normalizeMessageText(message.body));
      return;
    }

    let summary = '';
    if (contextSelection.includeSummary) {
      summary = await getSummary(message.from);
    }

    let budgetedRecent: StoredMessage[] = [];
    if (contextSelection.includeRecentHistory) {
      const recentWindow = storedMessages.slice(-MAX_RECENT_TURNS * 2);
      const filteredRecent = filterRecentMessages(
        recentWindow,
        contextSelection.maxAssistantMessages,
      );
      budgetedRecent = trimMessagesToBudget(filteredRecent, HISTORY_TOKEN_BUDGET);
    }

    const chatMessages = buildChatMessages({
      selectedProfileKeys: routerDecision.requiredKeys,
      summary,
      recentMessages: budgetedRecent,
      language: contextSelection.language,
      currentMessage: message.body,
    });

    console.log('\n\nlanguage: ', contextSelection.language);
    console.log('[SCHEMA_ROUTER]', JSON.stringify({
      intent: routerDecision.intent,
      requiredKeys: routerDecision.requiredKeys,
      answerStyle: routerDecision.answerStyle,
      includeProfile: contextSelection.includeProfile,
      includeSummary: contextSelection.includeSummary,
      includeRecentHistory: contextSelection.includeRecentHistory,
      maxAssistantMessages: contextSelection.maxAssistantMessages,
      useCustomProfileReply,
    }));
    logTokenBreakdown(chatMessages);

    let reply: string;
    try {
      reply = await askOllamaChat(chatMessages);
    } catch (error) {
      console.error('[OLLAMA ERROR]', formatOllamaError(error));
      const errorMessage = axios.isAxiosError(error) && error.response?.status === 401
        ? '❌ AI service authentication failed. Please check the API key.'
        : '❌ Sorry, I could not generate a response right now. Please try again later.';
      await safeReply(message, errorMessage);
      await markBotSent(errorMessage);
      return;
    }

    let replyText = reply || '❌ Ollama returned an empty response.';
    const normalizedPlay = normalizePlayReply(replyText);
    const canPlay = normalizedPlay !== null
      && shouldExecutePlayCommand(message.body, storedMessages);

    if (normalizedPlay && canPlay) {
      // AI may wrap the song in quotes; keep !play <song> without quotes.
      replyText = normalizedPlay;
    } else if (normalizedPlay && !canPlay) {
      // Model wrongly emitted !play for a non-music turn (e.g. profile follow-up).
      if (routerDecision.requiredKeys.length > 0) {
        replyText = buildProfileReply(
          routerDecision.requiredKeys,
          contextSelection.language,
          routerDecision.answerStyle,
        );
      } else {
        console.warn('[PLAY] Ignoring unexpected !play reply for non-music message:', message.body);
        replyText = contextSelection.language === 'roman_urdu'
          ? 'Yeh music request nahi lagti. Agar gana chahiye to song ka naam batao.'
          : contextSelection.language === 'urdu'
            ? 'یہ میوزک درخواست نہیں لگتی۔ اگر گانا چاہیے تو نام بتائیں۔'
            : "That doesn't look like a music request. Tell me a song name if you want music.";
      }
    }

    await appendMessage(message.from, {
      role: 'user',
      content: message.body,
      timestamp: Date.now(),
    });
    await appendMessage(message.from, {
      role: 'assistant',
      content: replyText,
      timestamp: Date.now(),
    });

    await maybeSummarizeHistory(message.from, askOllamaChat);

    await safeReply(message, replyText);
    await markBotSent(replyText);
    await markReplied(message.from, normalizeMessageText(message.body));

    // Bot's own messages are ignored by the command router (fromMe), so run !play here.
    if (canPlay && normalizedPlay) {
      const songName = extractPlaySongName(replyText);
      if (songName) {
        try {
          await commands['!play']?.run(message, songName);
        } catch (error) {
          console.error('[PLAY] Failed to run AI play command:', error);
        }
      }
    }
  }));
  } catch (error) {
    console.error('[OLLAMA] Failed to respond:', formatOllamaError(error));
  }
}

let contactMap: Map<string, string> | null = null;

function loadContactMap(): Map<string, string> {
  if (contactMap !== null) {
    return contactMap;
  }

  contactMap = new Map<string, string>();
  const contactFile = path.join(process.cwd(), 'contact.csv');

  try {
    if (!fs.existsSync(contactFile)) {
      console.warn(`[CONTACT] Contact file not found: ${contactFile}`);
      return contactMap;
    }

    const content = fs.readFileSync(contactFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const phone = parts[1].trim();

        if (name && phone) {
          contactMap.set(phone, name);
        }
      }
    }

    console.log(`[CONTACT] Loaded ${contactMap.size} contacts from CSV`);
  } catch (error) {
    console.error('[CONTACT] Error loading contact file:', error);
  }

  return contactMap;
}

function extractPhoneNumber(from: string): string {
  return from.split('@')[0];
}

export async function getName(message: Message): Promise<string> {
  try {
    const phoneNumber = extractPhoneNumber(message.from);
    const contacts = loadContactMap();
    const name = contacts.get(phoneNumber);
    return name || 'User';
  } catch (error) {
    console.error('[GET_NAME ERROR]', error);
    return 'User';
  }
}
