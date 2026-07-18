import { createWhatsAppClient, getClient } from './client';
import commands from './commands';
import {
  MY_NUMBER,
  PREFIX,
  WA_HEALTHCHECK_INTERVAL_MS,
  WA_HEALTHCHECK_TIMEOUT_MS,
  WA_RECONNECT_READY_TIMEOUT_MS,
} from './config';
import { respondViaOllama } from './ollama';
import { addBlockedPattern } from './utils/blockedPatterns';
import { isRecentlyBotSent, isRecentlyReplied } from './utils/replyDedup';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Client, MessageMedia, Message } from 'whatsapp-web.js';


const allCommands = ["play", "help"];

const SCRIPT_PATH = path.join(__dirname, '../test_download.py');
const PYTHON_CMD = process.env.PYTHON || 'python3';
const PROJECT_ROOT = path.join(__dirname, '..');

let healthCheckInterval: NodeJS.Timeout | null = null;
let healthCheckTimeout: NodeJS.Timeout | null = null;
let reconnectReadyTimeout: NodeJS.Timeout | null = null;
let pendingHealthCheckToken: string | null = null;
let reconnectInProgress = false;
let runtimeHandlersAttachedTo: Client | null = null;

function clearPendingHealthCheck(): void {
  pendingHealthCheckToken = null;
  if (healthCheckTimeout) {
    clearTimeout(healthCheckTimeout);
    healthCheckTimeout = null;
  }
}

function clearReconnectReadyTimeout(): void {
  if (reconnectReadyTimeout) {
    clearTimeout(reconnectReadyTimeout);
    reconnectReadyTimeout = null;
  }
}

function stopHealthCheckScheduler(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

function initializeWhatsApp(client: Client, reason: string): void {
  reconnectInProgress = true;
  clearReconnectReadyTimeout();
  console.log(`[WA] Starting WhatsApp client: ${reason}`);

  reconnectReadyTimeout = setTimeout(() => {
    if (!reconnectInProgress) return;
    reconnectInProgress = false;
    void reconnectWhatsApp(`client did not become ready within ${WA_RECONNECT_READY_TIMEOUT_MS}ms`);
  }, WA_RECONNECT_READY_TIMEOUT_MS);

  try {
    void client.initialize();
  } catch (error) {
    clearReconnectReadyTimeout();
    reconnectInProgress = false;
    console.error('[WA] Failed to initialize client:', error);
  }
}

async function reconnectWhatsApp(reason: string): Promise<void> {
  if (reconnectInProgress) return;
  reconnectInProgress = true;
  clearPendingHealthCheck();
  clearReconnectReadyTimeout();
  stopHealthCheckScheduler();

  console.warn(`[WA] Reconnecting: ${reason}`);

  try {
    const oldClient = getClient();
    runtimeHandlersAttachedTo = null;
    await oldClient.destroy();
  } catch (error) {
    console.warn('[WA] Error while closing the previous client:', error);
  }

  // Give Chromium a moment to fully release the session before opening a new one.
  setTimeout(() => {
    startWhatsAppClient(`reconnect after: ${reason}`);
  }, 2_000);
}

async function runHealthCheck(): Promise<void> {
  if (pendingHealthCheckToken || reconnectInProgress) return;

  const token = `__wa_healthcheck__${Date.now()}`;
  pendingHealthCheckToken = token;
  healthCheckTimeout = setTimeout(() => {
    if (pendingHealthCheckToken === token) {
      void reconnectWhatsApp(`health check timed out after ${WA_HEALTHCHECK_TIMEOUT_MS}ms`);
    }
  }, WA_HEALTHCHECK_TIMEOUT_MS);

  try {
    await getClient().sendMessage(MY_NUMBER, token);
    console.log('[WA] Health check sent');
  } catch (error) {
    console.error('[WA] Health check send failed:', error);
    void reconnectWhatsApp('health check message could not be sent');
  }
}

function startHealthCheckScheduler(): void {
  if (healthCheckInterval) return;

  void runHealthCheck();
  healthCheckInterval = setInterval(() => {
    void runHealthCheck();
  }, WA_HEALTHCHECK_INTERVAL_MS);
  console.log(`[WA] Health check scheduled every ${WA_HEALTHCHECK_INTERVAL_MS / 1000}s`);
}

async function acknowledgeHealthCheck(message: Message): Promise<boolean> {
  if (!message.fromMe || message.body !== pendingHealthCheckToken) return false;

  clearPendingHealthCheck();
  console.log('[WA] Health check received through message_create');
  return true;
}

type VideoPlatform = 'tiktok' | 'facebook' | 'instagram';

const YOUTUBE_URL_PATTERN = /https?:\/\/(?:www\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*\bv=[^\s]+|shorts\/[^\s]+|live\/[^\s]+)|youtu\.be\/[^\s]+)/i;

const extractYouTubeUrl = (text: string): string | null => {
  const match = text.match(YOUTUBE_URL_PATTERN);
  return match ? match[0] : null;
};

// Detect TikTok URLs
const isTikTokUrl = (text: string): boolean => {
  const tiktokPatterns = [
    /tiktok\.com/i,
    /vm\.tiktok\.com/i,
    /vt\.tiktok\.com/i,
    /www\.tiktok\.com/i,
  ];
  return tiktokPatterns.some(pattern => pattern.test(text));
};

// Detect Facebook URLs
const isFacebookUrl = (text: string): boolean => {
  const facebookPatterns = [
    /facebook\.com/i,
    /fb\.com/i,
    /fb\.watch/i,
    /m\.facebook\.com/i,
  ];
  return facebookPatterns.some(pattern => pattern.test(text));
};

// Detect Instagram URLs
const isInstagramUrl = (text: string): boolean => {
  const instagramPatterns = [
    /instagram\.com/i,
    /instagr\.am/i,
  ];
  return instagramPatterns.some(pattern => pattern.test(text));
};

// Extract TikTok URL from message
const extractTikTokUrl = (text: string): string | null => {
  const urlPattern = /https?:\/\/(?:www\.|vm\.|vt\.)?(?:tiktok\.com\/[^\s]+)/gi;
  const match = text.match(urlPattern);
  return match ? match[0] : null;
};

// Extract Facebook URL from message
const extractFacebookUrl = (text: string): string | null => {
  const urlPattern = /https?:\/\/(?:www\.|m\.)?(?:facebook\.com|fb\.com|fb\.watch)\/[^\s]+/gi;
  const match = text.match(urlPattern);
  return match ? match[0] : null;
};

// Extract Instagram URL from message
const extractInstagramUrl = (text: string): string | null => {
  const urlPattern = /https?:\/\/(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/[^\s]+/gi;
  const match = text.match(urlPattern);
  return match ? match[0] : null;
};

// Download video (works for TikTok, Facebook, Instagram, etc.)
const downloadVideo = (url: string, platform: VideoPlatform = 'tiktok'): Promise<{ path: string; title?: string }> => {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT_PATH, url, '--machine'];
    if (platform === 'facebook') {
      args.push('--facebook');
    } else if (platform === 'instagram') {
      args.push('--instagram');
    }
    
    const downloader = spawn(
      PYTHON_CMD,
      args,
      { cwd: PROJECT_ROOT, env: process.env, windowsHide: true },
    );

    let stdout = '';
    let stderr = '';

    downloader.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    downloader.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    downloader.once('error', (error) => reject(error));
    downloader.once('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python downloader failed: ${stderr.trim() || `exit ${code}`}`));
      }
      console.log(stdout);
      const markerSegments = stdout.split('THIS_JSON_OUTPUT_START');
      if (markerSegments.length < 2) {
        return reject(new Error('Downloader did not emit JSON output.'));
      }

      const afterStart = markerSegments[1];
      const jsonContent = afterStart.split('THIS_JSON_OUTPUT_END')[0].trim();
      if (!jsonContent) {
        return reject(new Error('Downloader emitted empty JSON payload.'));
      }

      try {
        resolve(JSON.parse(jsonContent));
      } catch (parseError) {
        reject(new Error(`Downloader emitted invalid JSON: ${(parseError as Error).message}\n${jsonContent}`));
      }
    });
  });
};

const shortMessage = (message: String) => {
  let message_text = message.trim();
  message_text = message_text.replace(/^`|`$/g, "").trim();
  message_text = message_text.replace(/^`|`$/g, "").trim();
  message_text = message_text.replace(/^`|`$/g, "").trim();  // This will remove both leading and trailing backticks
  return message_text;
}

async function handleMessageCreate(message: Message): Promise<void> {
  console.log('message_create:', message.from, "->", message.body);

  if (await acknowledgeHealthCheck(message)) return;

  if (message.from === 'status@broadcast') return;
  if (message.from.endsWith('@newsletter')) return;

  let body_text = shortMessage(message.body);

  if (message.fromMe) {
    if (message.from === MY_NUMBER && body_text.startsWith('.')) {
      await respondViaOllama(message);
    }
    return;
  }

  // A shared YouTube link is equivalent to !play <url>.
  if (!body_text.startsWith(PREFIX)) {
    const youtubeUrl = extractYouTubeUrl(body_text.split('\n')[0].trim());
    if (youtubeUrl) {
      await commands['!play']?.run(message, youtubeUrl);
      return;
    }
  }

    // Auto-detect and download TikTok/Facebook/Instagram videos
    if (!body_text.startsWith(PREFIX) && body_text.startsWith("http")) {
      const firstLine = body_text.split("\n")[0].trim();
      let videoUrl: string | null = null;
      let platform: VideoPlatform = 'tiktok';
      let platformName = 'TikTok';
      
      if (isTikTokUrl(firstLine)) {
        videoUrl = extractTikTokUrl(firstLine);
        platform = 'tiktok';
        platformName = 'TikTok';
      } else if (isFacebookUrl(firstLine)) {
        videoUrl = extractFacebookUrl(firstLine);
        platform = 'facebook';
        platformName = 'Facebook';
      } else if (isInstagramUrl(firstLine)) {
        videoUrl = extractInstagramUrl(firstLine);
        platform = 'instagram';
        platformName = 'Instagram';
      }
      
      if (videoUrl) {
        try {
          await message.reply(`🎬 Downloading ${platformName} video...`).catch(() => {});
          const downloadResult = await downloadVideo(videoUrl, platform);
          const outputFile = path.resolve(downloadResult.path);
          
          if (!fs.existsSync(outputFile)) {
            throw new Error('Download finished but file is missing.');
          }
          
          // Check file size (WhatsApp Web limit is ~16MB for videos)
          const stats = fs.statSync(outputFile);
          const fileSizeMB = stats.size / (1024 * 1024);
          const MAX_VIDEO_SIZE_MB = 16;
          
          if (stats.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
            console.log(`[${platformName.toUpperCase()}]`, `Video too large: ${fileSizeMB.toFixed(2)}MB (max: ${MAX_VIDEO_SIZE_MB}MB)`);
            try {
              await message.reply(`❌ Video is too large (${fileSizeMB.toFixed(2)}MB). WhatsApp limit is ${MAX_VIDEO_SIZE_MB}MB.`);
            } catch {}
            // Clean up the file
            try {
              fs.unlinkSync(outputFile);
            } catch (unlinkErr) {
              console.error(`[${platformName.toUpperCase()}]`, 'Failed to delete oversized file:', unlinkErr);
            }
            return;
          }
          
          const videoTitle = downloadResult.title || `${platformName} Video`;
          console.log(`[${platformName.toUpperCase()}]`, 'Downloaded video:', videoTitle, outputFile, `(${fileSizeMB.toFixed(2)}MB)`);
          
          // Try to send video with error handling
          let videoSent = false;
          
          try {
            const media = MessageMedia.fromFilePath(outputFile);
            await message.reply(media);
            videoSent = true;
            console.log(`[${platformName.toUpperCase()}]`, 'Video sent successfully');
          } catch (sendErr: any) {
            console.error(`[${platformName.toUpperCase()}]`, 'Error sending video:', sendErr?.message || sendErr);
            
            // If sending failed, inform user
            if (!videoSent) {
              try {
                await message.reply(`✅ Video downloaded: ${videoTitle}`);
                await message.reply(`📁 File saved at: downloads/${platform}/`);
                await message.reply(`⚠️ Unable to send video automatically due to WhatsApp limitations. File has been saved successfully.`);
              } catch (notifyErr) {
                console.error(`[${platformName.toUpperCase()}]`, 'Failed to notify user:', notifyErr);
              }
            }
          }
          
          return;
        } catch (err: any) {
          console.error(`[${platformName.toUpperCase()} ERROR]`, err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          try {
            await message.reply(`❌ Error downloading ${platformName} video: ${errorMessage}`);
          } catch {
            console.error(`[${platformName.toUpperCase()}]`, 'Failed to send error message to user');
          }
          return;
        }
      }
    }
    
  if (body_text.startsWith("blocked_")) {
    const num = body_text.split("_")[1];
    addBlockedPattern(num);
    return;
  }

  if (!body_text || body_text.trim() === "") {
    return;
  }
  
  if (!body_text.startsWith(PREFIX)) {
    if (await isRecentlyReplied(message.from, body_text)) {
      console.log('[DEDUP] Skipping duplicate message from', message.from);
      return;
    }
    if (await isRecentlyBotSent(body_text)) {
      console.log('[DEDUP] Skipping bot echo message from', message.from);
      return;
    }
    // await respondViaOllama(message);
    return;
  }

  const [command, ...rest] = body_text.split(' ');
  const content = rest.join(' ');

  const command_new = command.toLowerCase().trim().replace(" ", "");
  
  if (!allCommands.includes(command_new.substring(1))) return;

  type CommandKey = '!play' | '!help';
  const commandKey = command_new as CommandKey;
  const commandEntry = commands[commandKey];
  if (!commandEntry) return;
  await commandEntry.run(message, content);
}

function attachRuntimeHandlers(client: Client): void {
  if (runtimeHandlersAttachedTo === client) return;
  runtimeHandlersAttachedTo = client;

  client.on('ready', () => {
    clearReconnectReadyTimeout();
    reconnectInProgress = false;
    startHealthCheckScheduler();
  });

  client.on('disconnected', (reason) => {
    void reconnectWhatsApp(`client disconnected: ${reason}`);
  });

  client.on('message_create', (message) => {
    void handleMessageCreate(message);
  });

  client.on('state_changed', (newState) => {
    console.log('State changed to', newState);
  });

  client.on('group_join', (notification) => {
    console.log("New member joined!");

    const groupId = (notification.id as { remote: string }).remote;
    console.log("Group:", groupId);
    console.log("Participant:", notification.recipientIds);

    const welcomeText = 'Welcome to the group!\n\nPlease use the command below to get started:\n\n!play <song name>\n\nHere is a random song for you to enjoy';

    getClient().sendMessage(groupId, welcomeText).catch((error) => {
      console.error('[GROUP_JOIN] Failed to send welcome message:', error);
    });

    const groupMessage = {
      from: groupId,
      to: groupId,
      fromMe: false,
      id: { _serialized: `group_join_${Date.now()}` },
      reply: (content: string | MessageMedia, chatId?: string, options = {}) =>
        getClient().sendMessage(chatId || groupId, content, options),
      client: getClient(),
    } as unknown as Message;

    commands['!play']?.run(groupMessage, 'random_song').catch((error) => {
      console.error('[GROUP_JOIN] Failed to play welcome song:', error);
    });
  });
}

function startWhatsAppClient(reason: string): void {
  const client = createWhatsAppClient();
  attachRuntimeHandlers(client);
  initializeWhatsApp(client, reason);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[WA] Shutting down (${signal})`);
  stopHealthCheckScheduler();
  clearPendingHealthCheck();
  clearReconnectReadyTimeout();
  reconnectInProgress = true;

  try {
    await getClient().destroy();
  } catch (error) {
    console.warn('[WA] Error while shutting down client:', error);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(0));
});

startWhatsAppClient('initial startup');
