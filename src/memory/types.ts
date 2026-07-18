export type ChatRole = 'user' | 'assistant';

export interface StoredMessage {
  role: ChatRole;
  content: string;
  timestamp: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type DetectedLanguage = 'english' | 'roman_urdu' | 'urdu';

export type AnswerStyle = 'single_fact' | 'summary' | 'list';

export interface SchemaRouterDecision {
  language: DetectedLanguage;
  intent: 'direct' | 'profile_lookup' | 'recent_history' | 'summary' | 'mixed';
  requiredKeys: string[];
  answerStyle: AnswerStyle;
}

function parseLegacyLine(line: string): StoredMessage | null {
  const userMatch = line.match(/^([^:]+):\s*([\s\S]*)$/);
  if (!userMatch) return null;

  const label = userMatch[1].trim();
  const content = userMatch[2].trim();
  if (!content) return null;

  if (label === 'Assistant') {
    return { role: 'assistant', content, timestamp: 0 };
  }

  return { role: 'user', content, timestamp: 0 };
}

export function parseStoredMessages(data: string): StoredMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  if (parsed.length > 0 && typeof parsed[0] === 'string') {
    return (parsed as string[])
      .map(parseLegacyLine)
      .filter((msg): msg is StoredMessage => msg !== null);
  }

  return (parsed as StoredMessage[]).filter(
    (msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string',
  );
}
