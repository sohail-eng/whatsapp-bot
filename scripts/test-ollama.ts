import axios from 'axios';
import { askOllamaChat } from '../src/ollamaClient';
import { OLLAMA_CHAT_URL, OLLAMA_MODEL } from '../src/config';
import { ChatMessage } from '../src/memory/types';

async function readAxiosErrorBody(data: unknown): Promise<unknown> {
  if (!data || typeof data !== 'object' || !(Symbol.asyncIterator in data)) {
    return data;
  }

  let body = '';
  for await (const chunk of data as AsyncIterable<Buffer | string>) {
    body += chunk.toString();
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function main() {
  const messages: ChatMessage[] = [{
    role: 'user',
    content: 'Reply with only: Hello World',
  }];

  console.log(`Testing ${OLLAMA_MODEL} at ${OLLAMA_CHAT_URL}`);
  const reply = await askOllamaChat(messages);
  console.log('Received response:', reply);
}

main().catch(async (error) => {
  if (axios.isAxiosError(error)) {
    console.error('Failed to query Ollama:', {
      status: error.response?.status,
      response: await readAxiosErrorBody(error.response?.data),
      message: error.message,
    });
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error('Failed to query Ollama:', message);
  process.exit(1);
});
