import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

import text from './language';
import { LANGUAGE } from './config';

import fs from 'fs';

const chromiumPath = '/usr/bin/google-chrome';

const executablePath = fs.existsSync(chromiumPath) ? chromiumPath : undefined;

if (!executablePath) {
  console.log('⚠ Local Chromium not found. Using default Puppeteer settings.');
} else {
  console.log('✅ Using local Chromium:', executablePath);
}

let activeClient: Client | null = null;

function applySendSeenPatch(client: Client): void {
  // WhatsApp Web API change: default sendSeen crashes with "markedUnread" undefined.
  // Disable it globally until whatsapp-web.js ships a stable fix (wwebjs#5729).
  const originalSendMessage = client.sendMessage.bind(client);
  client.sendMessage = async (chatId, content, options = {}) =>
    originalSendMessage(chatId, content, { ...options, sendSeen: false });
}

function attachLifecycleListeners(client: Client): void {
  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    console.log('[WA] Authenticated');
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`[WA] Loading: ${percent}% - ${message}`);
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA] Auth failure:', msg);
  });

  client.on('disconnected', (reason) => {
    console.warn('[WA] Disconnected:', reason);
  });

  client.on('ready', () => {
    console.log(text[LANGUAGE].CONNECTED);
  });
}

/**
 * Build a brand-new WhatsApp client.
 * After destroy(), the old Client/Puppeteer page cannot be reused —
 * calling initialize() again on it causes "detached Frame" and stuck ready.
 */
export function createWhatsAppClient(): Client {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: false,
      executablePath,
      args: [
        '--no-sandbox',
      ],
    },
  });

  applySendSeenPatch(client);
  attachLifecycleListeners(client);
  activeClient = client;
  return client;
}

export function getClient(): Client {
  if (!activeClient) {
    throw new Error('WhatsApp client has not been created yet');
  }
  return activeClient;
}
