import { StoredMessage, DetectedLanguage, SchemaRouterDecision } from './types';

export interface ContextSelection {
  language: DetectedLanguage;
  includeProfile: boolean;
  includeSummary: boolean;
  includeRecentHistory: boolean;
  maxAssistantMessages: number;
}

const SIMPLE_MESSAGES = new Set([
  'ok', 'okay', 'k', 'kk', 'thanks', 'thank you', 'thx', 'yes', 'no', 'hmm',
  'hm', 'alright', 'theek', 'thik', 'acha', 'achha', 'good', 'great', 'nice',
]);

const PROFILE_KEYWORDS = [
  'email', 'github', 'git hub', 'contact', 'about sohail', 'about you',
  'who is sohail', 'what do you do', 'profile', 'bio', 'experience',
  'react', 'python', 'c++', 'c#', 'java',
  'sohail ka', 'sohail k', 'sohail ke', 'tum sohail', 'apka email', 'aap ka email',
  'wife', 'biwi', 'shadi', 'shaadi', 'married', 'spouse',
  'kon hai', 'kon haim', 'kaun hai', 'kaun haim', 'who is',
  'sister', 'brother', 'mother', 'father', 'family', 'birthday', 'age',
];

const RECENT_CONTEXT_KEYWORDS = [
  'that', 'this', 'it', 'second option', 'dobara', 'phir', 'wo', 'woh', 'us',
  'iss', 'is', 'again', 'which one', 'konsa', 'kon sa', 'kis wala', 'same',
];

const SUMMARY_KEYWORDS = [
  'earlier', 'before', 'previously', 'last time', 'pehle', 'pehly', 'pehlay',
  'yaad', 'remember', 'discussed before', 'jo pehle', 'what did i say',
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function detectLanguage(text: string): DetectedLanguage {
  if (/[\u0600-\u06FF]/.test(text)) {
    return 'urdu';
  }

  const lower = text.toLowerCase();
  const romanUrduHints = [
    'hai', 'ho', 'kya', 'kyun', 'ka', 'ke', 'ki', 'mera', 'meri', 'mujhe',
    'tum', 'aap', 'sohail', 'bata', 'batao', 'karo', 'karna', 'mein', 'mai',
    'acha', 'achha', 'theek', 'thik', 'wala', 'wali', 'kis', 'kon', 'konsa',
  ];

  const hintCount = romanUrduHints.reduce((count, hint) => (
    lower.includes(hint) ? count + 1 : count
  ), 0);

  if (hintCount >= 2) {
    return 'roman_urdu';
  }

  return 'english';
}

export function selectContext(messageText: string, _messages: StoredMessage[]): ContextSelection {
  const normalized = messageText.trim().toLowerCase();
  const language = detectLanguage(messageText);

  if (SIMPLE_MESSAGES.has(normalized)) {
    // Keep a little recent history so yes/ok can confirm a prior !play suggestion.
    return {
      language,
      includeProfile: false,
      includeSummary: false,
      includeRecentHistory: true,
      maxAssistantMessages: 1,
    };
  }

  if (includesAny(normalized, PROFILE_KEYWORDS)) {
    return {
      language,
      includeProfile: true,
      includeSummary: false,
      includeRecentHistory: false,
      maxAssistantMessages: 0,
    };
  }

  if (includesAny(normalized, SUMMARY_KEYWORDS)) {
    return {
      language,
      includeProfile: false,
      includeSummary: true,
      includeRecentHistory: true,
      maxAssistantMessages: 1,
    };
  }

  if (includesAny(normalized, RECENT_CONTEXT_KEYWORDS)) {
    return {
      language,
      includeProfile: false,
      includeSummary: false,
      includeRecentHistory: true,
      maxAssistantMessages: 1,
    };
  }

  return {
    language,
    includeProfile: false,
    includeSummary: true,
    includeRecentHistory: true,
    maxAssistantMessages: 2,
  };
}

export function decisionToContextSelection(decision: SchemaRouterDecision): ContextSelection {
  switch (decision.intent) {
    case 'profile_lookup':
      return {
        language: decision.language,
        includeProfile: decision.requiredKeys.length > 0,
        includeSummary: false,
        includeRecentHistory: false,
        maxAssistantMessages: 0,
      };
    case 'recent_history':
      return {
        language: decision.language,
        includeProfile: false,
        includeSummary: false,
        includeRecentHistory: true,
        maxAssistantMessages: 1,
      };
    case 'summary':
      return {
        language: decision.language,
        includeProfile: false,
        includeSummary: true,
        includeRecentHistory: true,
        maxAssistantMessages: 1,
      };
    case 'mixed':
      return {
        language: decision.language,
        includeProfile: decision.requiredKeys.length > 0,
        includeSummary: true,
        includeRecentHistory: true,
        maxAssistantMessages: 1,
      };
    case 'direct':
    default:
      return {
        language: decision.language,
        includeProfile: false,
        includeSummary: false,
        includeRecentHistory: false,
        maxAssistantMessages: 0,
      };
  }
}

export function filterRecentMessages(
  messages: StoredMessage[],
  maxAssistantMessages: number,
): StoredMessage[] {
  let assistantCount = 0;
  const result: StoredMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    if (msg.role === 'assistant') {
      if (assistantCount >= maxAssistantMessages) {
        continue;
      }
      assistantCount += 1;
    }

    result.unshift(msg);
  }

  return result;
}
