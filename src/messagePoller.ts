import axios from 'axios';
import {
  MESSAGE_POLL_INTERVAL_MS,
  MESSAGE_SERVICE_ADMIN_KEY,
  MESSAGE_SERVICE_ALLOWED_APPS,
  MESSAGE_SERVICE_URL,
  MESSAGE_SERVICE_URL_ACTIVE,
} from './config';
import { getClient, hasClient } from './client';

export type PendingMessage = {
  id: number;
  app_name: string;
  phone_number: string;
  message: string;
  created_at: string;
};

let pollInterval: NodeJS.Timeout | null = null;
let pollInProgress = false;
let shouldPoll = false;
let onTransportFailure: ((reason: string) => void) | null = null;

/** Register the WhatsApp reconnect handler (wired from main to avoid circular imports). */
export function setWhatsAppTransportFailureHandler(handler: (reason: string) => void): void {
  onTransportFailure = handler;
}

function isWhatsAppTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /detached Frame|Target closed|Session closed|Protocol error|Execution context was destroyed|browser has disconnected|Navigating frame was detached/i.test(
    message,
  );
}

function adminHeaders() {
  return {
    accept: 'application/json',
    'X-Admin-Key': MESSAGE_SERVICE_ADMIN_KEY,
  };
}

/** Convert "+92309..." / "92309..." → "92309...@c.us" */
export function toWhatsAppChatId(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) {
    throw new Error(`Invalid phone number: ${phoneNumber}`);
  }
  return `${digits}@c.us`;
}

async function fetchPendingMessages(): Promise<PendingMessage[]> {
  const response = await axios.get<PendingMessage[]>(`${MESSAGE_SERVICE_URL}/messages`, {
    headers: adminHeaders(),
    timeout: 15_000,
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function markMessageProcessed(id: number): Promise<void> {
  await axios.post(
    `${MESSAGE_SERVICE_URL}/messages/${id}/process`,
    null,
    {
      headers: adminHeaders(),
      timeout: 15_000,
    },
  );
}

async function sendWhatsAppMessage(phoneNumber: string, body: string): Promise<void> {
  const chatId = toWhatsAppChatId(phoneNumber);
  await getClient().sendMessage(chatId, body);
}

function formatOutboundMessage(item: PendingMessage): string {
  const body = item.message.trimEnd();
  const appName = item.app_name?.trim();
  if (!appName) return body;
  return `${body}\n\n*${appName}*`;
}

async function processPendingMessage(item: PendingMessage): Promise<boolean> {
  try {
    await sendWhatsAppMessage(item.phone_number, formatOutboundMessage(item));
  } catch (error) {
    console.error(
      `[MSG_POLL] Failed to send message id=${item.id} to ${item.phone_number}:`,
      error instanceof Error ? error.message : error,
    );

    if (isWhatsAppTransportFailure(error)) {
      console.warn('[MSG_POLL] WhatsApp session looks dead; requesting reconnect');
      shouldPoll = false;
      onTransportFailure?.(`MSG_POLL transport failure: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    return true;
  }

  try {
    await markMessageProcessed(item.id);
    console.log(`[MSG_POLL] Sent and marked processed id=${item.id} → ${item.phone_number}`);
  } catch (error) {
    console.error(
      `[MSG_POLL] Sent WhatsApp but failed to mark processed id=${item.id}:`,
      error instanceof Error ? error.message : error,
    );
  }

  return true;
}

export async function runMessagePoll(): Promise<void> {
  if (!MESSAGE_SERVICE_URL_ACTIVE || !shouldPoll || pollInProgress || !hasClient()) return;
  if (!MESSAGE_SERVICE_ADMIN_KEY) {
    console.warn('[MSG_POLL] MESSAGE_SERVICE_ADMIN_KEY is not set; skipping poll');
    return;
  }

  pollInProgress = true;
  try {
    const allMessages = await fetchPendingMessages();
    const messages = MESSAGE_SERVICE_ALLOWED_APPS.length === 0
      ? allMessages
      : allMessages.filter((m) => {
        const app = (m.app_name || '').trim();
        return app && MESSAGE_SERVICE_ALLOWED_APPS.includes(app);
      });
    if (messages.length === 0) return;

    console.log(
      `[MSG_POLL] Fetched ${allMessages.length} pending message(s)` +
      (MESSAGE_SERVICE_ALLOWED_APPS.length === 0
        ? ''
        : `, ${messages.length} after app filter [${MESSAGE_SERVICE_ALLOWED_APPS.join(', ')}]`),
    );
    for (const item of messages) {
      if (!shouldPoll || !hasClient()) break;
      const keepGoing = await processPendingMessage(item);
      if (!keepGoing) break;
    }
  } catch (error) {
    console.error(
      '[MSG_POLL] Failed to fetch pending messages:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    pollInProgress = false;
  }
}

export function startMessagePollScheduler(): void {
  if (pollInterval) return;
  if (!MESSAGE_SERVICE_URL_ACTIVE) {
    console.log('[MSG_POLL] MESSAGE_SERVICE_URL_ACTIVE is false; poller not started');
    return;
  }
  if (!MESSAGE_SERVICE_ADMIN_KEY) {
    console.warn('[MSG_POLL] MESSAGE_SERVICE_ADMIN_KEY is not set; poller not started');
    return;
  }

  shouldPoll = true;
  void runMessagePoll();
  pollInterval = setInterval(() => {
    void runMessagePoll();
  }, MESSAGE_POLL_INTERVAL_MS);
  console.log(`[MSG_POLL] Scheduled every ${MESSAGE_POLL_INTERVAL_MS / 1000}s → ${MESSAGE_SERVICE_URL}`);
}

export function stopMessagePollScheduler(): void {
  shouldPoll = false;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
