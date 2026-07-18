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

async function resolveReplyChatId(message: Message): Promise<string> {
  if (isGroupChatId(message.from)) {
    return message.from;
  }

  const chatId = message.fromMe ? message.to : message.from;

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
  const chatId = await resolveReplyChatId(message);
  const quotedOptions: MessageSendOptions = {
    ...options,
    quotedMessageId: message.id._serialized,
  };

  try {
    await getClient().sendMessage(chatId, content, quotedOptions);
    return;
  } catch (error) {
    console.warn('[SAFE_REPLY] Quoted send failed, retrying without quote:', error);
  }

  await getClient().sendMessage(chatId, content, options);
}
