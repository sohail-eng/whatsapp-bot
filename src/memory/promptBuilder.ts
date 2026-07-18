import { ChatMessage, StoredMessage, DetectedLanguage } from './types';
import { truncateText } from './tokenBudget';
import { SUMMARY_TOKEN_BUDGET } from '../config';
import { buildProfilePromptContext } from '../profileData';

export const BASE_SYSTEM_INSTRUCTIONS = `You are Sohail's personal WhatsApp assistant. Reply in WhatsApp message format.

Languages: English, Urdu, Roman Urdu only. Hindi is not allowed.

Rules:
- Keep replies natural, concise, and actionable
- For hi/hello, keep replies short and friendly
- For casual or wellness messages, respond politely with brief helpful answers
- If user wants to share information, ask for context
- If urgent, say: "This seems urgent, you should call Sohail directly."
- Profile / personal questions about Sohail (marriage, wife, family, job, email, etc.): answer from profile context. NEVER reply with !play for these.
- Music only when the user clearly wants a song/music, or confirms a prior song suggestion:
  1) Suggest with: !play <song name>
  2) !play is a reserved keyword. Never put the song name in quotes.
  3) On confirm (yes / ok / sure / go ahead after a song suggestion), reply with ONLY: !play <song name>
  4) Never invent a song reply for non-music messages.`;

export const PROFILE_CONTEXT = buildProfilePromptContext();

interface BuildChatMessagesParams {
  selectedProfileKeys: string[];
  summary: string;
  recentMessages: StoredMessage[];
  language: DetectedLanguage;
  currentMessage: string;
}

function getLanguageInstruction(language: DetectedLanguage): string {
  if (language === 'roman_urdu') {
    return 'Reply only in Roman Urdu for this turn. Do not use English sentences. Do not add translations.';
  }

  if (language === 'urdu') {
    return 'Reply only in Urdu script for this turn. Do not use English sentences. Do not add translations.';
  }

  return 'Reply only in English for this turn. Do not mix Urdu or Roman Urdu.';
}

export function buildChatMessages({
  selectedProfileKeys,
  summary,
  recentMessages,
  language,
  currentMessage,
}: BuildChatMessagesParams): ChatMessage[] {
  let systemContent = `${BASE_SYSTEM_INSTRUCTIONS}\n\nLanguage lock:\n${getLanguageInstruction(language)}`;

  if (selectedProfileKeys.length > 0) {
    systemContent += `\n\n${buildProfilePromptContext(selectedProfileKeys)}`;
  }

  if (summary.trim()) {
    const cappedSummary = truncateText(summary.trim(), SUMMARY_TOKEN_BUDGET);
    systemContent += `\n\nLong-term context for this user:\n${cappedSummary}`;
  }

  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

  for (const msg of recentMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: currentMessage });

  return messages;
}

export function buildSummaryPrompt(
  existingSummary: string,
  batch: StoredMessage[],
): ChatMessage[] {
  const formatted = batch
    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n');

  const systemContent = `Summarize this WhatsApp conversation excerpt in 3-5 sentences.
Keep: user name, topics discussed, requests, preferences, unanswered questions.
Return only the summary, no preamble.`;

  let userContent = `New messages:\n${formatted}`;
  if (existingSummary.trim()) {
    userContent = `Existing summary:\n${existingSummary}\n\n${userContent}`;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}
