import { AnswerStyle, DetectedLanguage } from './types';
import { buildProfileReplyFromKeys } from './profileFormatter';

export function buildProfileReply(
  requiredKeys: string[],
  language: DetectedLanguage,
  answerStyle: AnswerStyle,
): string {
  return buildProfileReplyFromKeys(requiredKeys, language, answerStyle);
}
