import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import text from './language';
import { LANGUAGE } from './config';

const chromiumPath = '/usr/bin/google-chrome';

const executablePath = fs.existsSync(chromiumPath) ? chromiumPath : undefined;

if (!executablePath) {
  console.log('⚠ Local Chromium not found. Using default Puppeteer settings.');
} else {
  console.log('✅ Using local Chromium:', executablePath);
}

const AUTH_DATA_PATH = path.resolve(process.cwd(), '.wwebjs_auth');
const SESSION_DIR = path.join(AUTH_DATA_PATH, 'session');

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
    authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
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

export function hasClient(): boolean {
  return activeClient !== null;
}

/** Remove Chrome singleton locks left behind by a crashed / detached browser. */
function clearSessionSingletonLocks(): void {
  for (const lockName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = path.join(SESSION_DIR, lockName);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        console.log(`[WA] Removed stale ${lockName}`);
      }
    } catch (error) {
      console.warn(`[WA] Could not remove ${lockName}:`, error);
    }
  }
}

/**
 * Kill any Chrome/Chromium processes still attached to our LocalAuth session dir.
 * Needed when puppeteer reports a detached frame but the OS process keeps the profile lock.
 */
export async function forceReleaseSessionLock(): Promise<void> {
  try {
    execSync(`pkill -f ${JSON.stringify(SESSION_DIR)} || true`, { stdio: 'ignore' });
  } catch {
    // pkill returns non-zero when nothing matched
  }

  clearSessionSingletonLocks();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

async function forceClosePuppeteerBrowser(client: Client): Promise<void> {
  const browser = (client as { pupBrowser?: {
    isConnected?: () => boolean;
    close: () => Promise<void>;
    process?: () => { killed?: boolean; kill: (signal?: string) => void } | null;
    pages?: () => Promise<Array<{ close: () => Promise<void> }>>;
  } }).pupBrowser;

  if (!browser) return;

  try {
    const pages = browser.pages ? await browser.pages().catch(() => []) : [];
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
  } catch {
    // ignore
  }

  try {
    if (!browser.isConnected || browser.isConnected()) {
      await browser.close();
    }
  } catch {
    // ignore — process kill below is the fallback
  }

  try {
    const proc = browser.process?.();
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
    }
  } catch {
    // ignore
  }
}

/**
 * Tear down the active client and ensure the session profile is unlocked
 * so a new Client can launch against the same LocalAuth directory.
 */
export async function destroyWhatsAppClient(): Promise<void> {
  const client = activeClient;
  activeClient = null;
  if (!client) {
    await forceReleaseSessionLock();
    return;
  }

  // When the frame is already detached, Client.destroy() often skips browser.close()
  // because isConnected() is false while the Chrome process is still alive.
  await forceClosePuppeteerBrowser(client);

  try {
    await client.destroy();
  } catch (error) {
    console.warn('[WA] client.destroy() failed:', error);
  }

  await forceReleaseSessionLock();
}
