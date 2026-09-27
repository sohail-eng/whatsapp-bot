import {
  Message,
  MessageContent,
  MessageSendOptions,
} from 'whatsapp-web.js';
import { getClient } from '../client';

function isGroupChatId(chatId: string): boolean {
  return chatId.endsWith('@g.us');
}

function isLidChatId(chatId: string): boolean {
  return chatId.endsWith('@lid');
}

function getOriginalChatId(message: Message): string {
  if (isGroupChatId(message.from)) {
    return message.from;
  }
  return message.fromMe ? message.to : message.from;
}

async function resolveReplyChatId(message: Message): Promise<string> {
  const chatId = getOriginalChatId(message);

  if (!isLidChatId(chatId)) {
    return chatId;
  }

  try {
    const resolved = await getClient().getContactLidAndPhone([chatId]);
    const phoneNumber = resolved[0]?.pn;
    if (phoneNumber && !phoneNumber.endsWith('@lid')) {
      return phoneNumber;
    }
  } catch (error) {
    console.warn('[SAFE_REPLY] Failed to resolve LID chat id:', chatId, error);
  }

  return chatId;
}

export async function safeReply(
  message: Message,
  content: MessageContent,
  options: MessageSendOptions = {},
): Promise<void> {
  const originalChatId = getOriginalChatId(message);
  const chatId = await resolveReplyChatId(message);

  const trySend = async (target: string, quote: boolean): Promise<void> => {
    const sendOptions: MessageSendOptions = { ...options };
    if (quote) {
      // Always quote the incoming message so the bot responds as a reply thread.
      await message.reply(content, target, sendOptions);
      return;
    }

    await getClient().sendMessage(target, content, sendOptions);
  };

  // Prefer quoting in the chat where the original message lives (@lid / group).
  try {
    await trySend(originalChatId, true);
    return;
  } catch (error) {
    console.warn('[SAFE_REPLY] Quoted send on original chat failed:', error);
  }

  // Then try the resolved phone chat (@c.us) if different.
  if (chatId !== originalChatId) {
    try {
      await trySend(chatId, true);
      return;
    } catch (error) {
      console.warn('[SAFE_REPLY] Quoted send on resolved chat failed:', error);
    }
  }

  await trySend(chatId, false);
}
