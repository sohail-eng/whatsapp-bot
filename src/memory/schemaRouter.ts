import axios from 'axios';
import { OLLAMA_API_KEY, OLLAMA_CHAT_URL, OLLAMA_MODEL } from '../config';
import { getProfileSchemaKeys } from '../profileData';
import { looksLikeProfileQuestion } from './contextRouter';
import { ChatMessage, SchemaRouterDecision } from './types';

const SCHEMA_ROUTER_SYSTEM_PROMPT = `Classify the user message for a WhatsApp assistant.
Return JSON only with keys:
- language: english | roman_urdu | urdu
- intent: direct | profile_lookup | recent_history | summary | mixed
- requiredKeys: string[]
- answerStyle: single_fact | summary | list

Rules:
- Use profile_lookup when the question can be answered from profile keys
- Questions about Sohail's marriage, wife, family, job, email, github are profile_lookup
- Use recent_history for follow-up questions needing recent conversation
- Use summary for older memory questions
- Use mixed when both profile keys and conversation context are needed
- Never invent keys. Only return keys from availableProfileKeys.
- If no profile key is needed, return requiredKeys as []
- Do not treat personal/profile questions as music requests`;

function safeParseSchemaDecision(raw: string): SchemaRouterDecision | null {
  try {
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, '').trim();
    const parsed = JSON.parse(cleaned) as SchemaRouterDecision;
    if (!parsed || !parsed.language || !parsed.intent || !Array.isArray(parsed.requiredKeys) || !parsed.answerStyle) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function validateSchemaDecision(decision: SchemaRouterDecision): SchemaRouterDecision {
  const allowed = new Set(getProfileSchemaKeys());
  return {
    ...decision,
    requiredKeys: decision.requiredKeys.filter((key) => allowed.has(key)),
  };
}

export async function requestSchemaRouterDecision(
  messageText: string,
  askOllamaChat: (messages: ChatMessage[]) => Promise<string>,
): Promise<SchemaRouterDecision | null> {
  const availableProfileKeys = getProfileSchemaKeys();
  try {
    const raw = await askOllamaChat([
      {
        role: 'system',
        content: SCHEMA_ROUTER_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: JSON.stringify({
          message: messageText,
          availableProfileKeys,
        }),
      },
    ]);
    const parsed = safeParseSchemaDecision(raw);
    return parsed ? validateSchemaDecision(parsed) : null;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 503) {
      const retryRaw = await askOllamaChat([
        { role: 'system', content: SCHEMA_ROUTER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            message: messageText,
            availableProfileKeys,
          }),
        },
      ]);
      const retryParsed = safeParseSchemaDecision(retryRaw);
      return retryParsed ? validateSchemaDecision(retryParsed) : null;
    }
    throw error;
  }
}

export function buildFallbackSchemaDecision(messageText: string): SchemaRouterDecision {
  const lower = messageText.toLowerCase();
  const familyMap: Record<string, string> = {
    wife: 'identity.wifeName',
    biwi: 'identity.wifeName',
    sister: 'identity.sisterName',
    brother: 'identity.brotherName',
    mother: 'identity.motherName',
    father: 'identity.fatherName',
    birthday: 'identity.birthday',
    age: 'identity.age',
    email: 'contact.email',
    github: 'social.github',
    'git hub': 'social.github',
    shadi: 'identity.maritalStatus',
    shaadi: 'identity.maritalStatus',
    married: 'identity.maritalStatus',
  };

  // Match whole words only, so e.g. "message" doesn't trigger the "age" keyword.
  // Long/multi-line texts (pasted documents) are never profile questions.
  const requiredKeys = looksLikeProfileQuestion(messageText)
    ? [...new Set(
      Object.entries(familyMap)
        .filter(([keyword]) => new RegExp(`\\b${keyword}\\b`, 'i').test(lower))
        .map(([, key]) => key),
    )]
    : [];

  return {
    language: /[\u0600-\u06FF]/.test(messageText) ? 'urdu' : 'roman_urdu',
    intent: requiredKeys.length > 0 ? 'profile_lookup' : 'direct',
    requiredKeys,
    answerStyle: requiredKeys.length <= 1 ? 'single_fact' : 'summary',
  };
}
