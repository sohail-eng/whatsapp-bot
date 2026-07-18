import axios from 'axios';
import readline from 'node:readline';
import { OLLAMA_API_KEY, OLLAMA_CHAT_URL, OLLAMA_MODEL } from './config';
import { ChatMessage } from './memory/types';

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
}

export async function askOllamaChat(messages: ChatMessage[]): Promise<string> {
  const isCloudEndpoint = /^https:\/\/ollama\.com(?:\/|$)/.test(OLLAMA_CHAT_URL);
  if (isCloudEndpoint && !OLLAMA_API_KEY) {
    throw new Error('OLLAMA_API_KEY is required when using Ollama Cloud');
  }

  const response = await axios.post(
    OLLAMA_CHAT_URL,
    { model: OLLAMA_MODEL, messages, stream: true },
    {
      responseType: 'stream',
      headers: OLLAMA_API_KEY
        ? { Authorization: `Bearer ${OLLAMA_API_KEY}` }
        : undefined,
    },
  );

  return new Promise<string>((resolve, reject) => {
    const rl = readline.createInterface({ input: response.data });
    let collected = '';

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const chunk = JSON.parse(trimmed) as OllamaChatChunk;
        if (chunk.message?.content) collected += chunk.message.content;
        if (chunk.done) {
          rl.close();
          resolve(collected.trim());
        }
      } catch (error) {
        rl.close();
        reject(error);
      }
    });

    response.data.once('end', () => {
      rl.close();
      resolve(collected.trim());
    });

    response.data.once('error', (error: Error) => {
      rl.close();
      reject(error);
    });
  });
}
