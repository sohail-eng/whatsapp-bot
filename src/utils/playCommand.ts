import { StoredMessage } from '../memory/types';

const PLAY_COMMAND_RE = /!play\s+(.+?)(?:\n|$)/i;

const MUSIC_HINT_RE = /\b(song|music|gana|gaana|track|album|bajao|baja|suna|sunao|play|!play)\b/i;

const AFFIRMATION_RE = /^(yes|yep|yeah|yup|ok|okay|k|kk|sure|please|yes please|ok please|go ahead|go for it|do it|play it|play|haan|han|ji|theek|thik|acha|achha)([!.\s]*)$/i;

export function extractPlaySongName(text: string): string | null {
  const match = text.match(PLAY_COMMAND_RE);
  if (!match?.[1]) return null;

  return normalizeSongName(match[1]);
}

export function normalizeSongName(songName: string): string {
  return songName
    .trim()
    .replace(/^["'`“”‘’]+/, '')
    .replace(/["'`“”‘’]+$/, '')
    .trim();
}

/** If the AI reply starts with !play, return it with quotes stripped from the song name. */
export function normalizePlayReply(reply: string): string | null {
  const trimmed = reply.trim();
  if (!/^!play\b/i.test(trimmed)) return null;

  const songName = extractPlaySongName(trimmed);
  if (!songName) return null;

  return `!play ${songName}`;
}

export function lastAssistantSuggestedPlay(messages: StoredMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    return /!play\b/i.test(messages[i].content);
  }
  return false;
}

/** Only treat AI !play replies as actionable when the user is in a music turn. */
export function shouldExecutePlayCommand(
  userMessage: string,
  recentMessages: StoredMessage[],
): boolean {
  const text = userMessage.trim();
  if (MUSIC_HINT_RE.test(text)) return true;
  if (AFFIRMATION_RE.test(text) && lastAssistantSuggestedPlay(recentMessages)) return true;
  return false;
}
