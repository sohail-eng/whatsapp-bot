import 'dotenv/config';

export const MAX_DURATION = 900;
export const DOWNLOAD_PATH = 'downloads';
export const PREFIX = '!';
export const LANGUAGE = 'en';
export const MY_NUMBER = "923041301397@c.us";

// Redis configuration
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
export const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);

// Ollama configuration. Defaults target Ollama Cloud; override the URLs for local Ollama.
export const OLLAMA_URL = process.env.OLLAMA_URL || 'https://ollama.com/api/generate';
export const OLLAMA_CHAT_URL = process.env.OLLAMA_CHAT_URL || 'https://ollama.com/api/chat';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b';
export const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// WhatsApp connection watchdog configuration
export const WA_HEALTHCHECK_INTERVAL_MS = parseInt(process.env.WA_HEALTHCHECK_INTERVAL_MS || '60000', 10);
export const WA_HEALTHCHECK_TIMEOUT_MS = parseInt(process.env.WA_HEALTHCHECK_TIMEOUT_MS || '20000', 10);
export const WA_RECONNECT_READY_TIMEOUT_MS = parseInt(process.env.WA_RECONNECT_READY_TIMEOUT_MS || '45000', 10);

// Outbound message service (poll → WhatsApp → mark processed)
export const MESSAGE_SERVICE_URL = (process.env.MESSAGE_SERVICE_URL || 'https://message-service.dev-link.cloud').replace(/\/$/, '');
export const MESSAGE_SERVICE_ADMIN_KEY = process.env.MESSAGE_SERVICE_ADMIN_KEY || '';
export const MESSAGE_POLL_INTERVAL_MS = parseInt(process.env.MESSAGE_POLL_INTERVAL_MS || '30000', 10);
/** Set to false/0/off to disable polling the outbound message service. */
export const MESSAGE_SERVICE_URL_ACTIVE = !['false', '0', 'no', 'off'].includes(
  (process.env.MESSAGE_SERVICE_URL_ACTIVE || 'true').toLowerCase(),
);

// Memory / token budget configuration
export const MAX_RECENT_TURNS = parseInt(process.env.MAX_RECENT_TURNS || '6', 10);
export const MAX_STORED_MESSAGES = parseInt(process.env.MAX_STORED_MESSAGES || '40', 10);
export const HISTORY_TOKEN_BUDGET = parseInt(process.env.HISTORY_TOKEN_BUDGET || '700', 10);
export const SUMMARY_TOKEN_BUDGET = parseInt(process.env.SUMMARY_TOKEN_BUDGET || '150', 10);
export const SUMMARIZE_BATCH_SIZE = parseInt(process.env.SUMMARIZE_BATCH_SIZE || '10', 10);
