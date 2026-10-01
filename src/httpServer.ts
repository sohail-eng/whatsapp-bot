import express, { Request, Response } from 'express';
import { getClient, hasClient } from './client';
import { toWhatsAppChatId } from './messagePoller';
import { HTTP_SERVER_PORT, HTTP_SERVER_APP_KEY } from './config';

let server: ReturnType<typeof express> | null = null;
let httpServer: import('http').Server | null = null;

function authenticate(req: Request, res: Response): boolean {
  if (!HTTP_SERVER_APP_KEY) return true;
  const key = req.headers['x-app-key'];
  if (key !== HTTP_SERVER_APP_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function startHttpServer(): void {
  if (server) return;
  if (!HTTP_SERVER_PORT) {
    console.log('[HTTP] HTTP_SERVER_PORT not set; server not started');
    return;
  }

  server = express();
  server.use(express.json({ limit: '1mb' }));

  server.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', whatsapp_ready: hasClient() });
  });

  server.post('/send', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;

    const { phone_number, message } = req.body ?? {};

    if (!phone_number || typeof phone_number !== 'string') {
      res.status(400).json({ error: 'phone_number is required' });
      return;
    }
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (!hasClient()) {
      res.status(503).json({ error: 'WhatsApp client not ready' });
      return;
    }

    try {
      const chatId = toWhatsAppChatId(phone_number);
      await getClient().sendMessage(chatId, message);
      console.log(`[HTTP] Sent message to ${phone_number}`);
      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[HTTP] Failed to send to ${phone_number}:`, msg);
      const isTransport = /detached Frame|Target closed|Session closed|Protocol error|Execution context was destroyed|browser has disconnected|Navigating frame was detached/i.test(msg);
      res.status(isTransport ? 503 : 500).json({ error: msg });
    }
  });

  httpServer = server.listen(HTTP_SERVER_PORT, () => {
    console.log(`[HTTP] Direct send server listening on port ${HTTP_SERVER_PORT}`);
  });
}

export function stopHttpServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  server = null;
}
