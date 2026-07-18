import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { MessageMedia, Message } from 'whatsapp-web.js';
import { normalizeSongName } from '../utils/playCommand';
import { safeReply } from '../utils/safeReply';

const SCRIPT_PATH = path.join(__dirname, '../../test_download.py');
const PYTHON_CMD = process.env.PYTHON || 'python3';
const PROJECT_ROOT = path.join(__dirname, '../..');

const runDownload = (query: string) =>
  new Promise<{ path: string; title?: string }>((resolve, reject) => {
    const downloader = spawn(
      PYTHON_CMD,
      [SCRIPT_PATH, query, '--machine'],
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

  // Here we will choose a random song from the available songs in the donwload directory
  // return should be same as above runDownload function
  const getRandomSong = () => 
    new Promise<{ path: string; title?: string }>((resolve, reject) => {
      const downloadDirectory = path.join(PROJECT_ROOT, 'downloads');
      const songs = fs.readdirSync(downloadDirectory);
      const randomSong = songs[Math.floor(Math.random() * songs.length)];
      resolve({ path: path.join(downloadDirectory, randomSong), title: randomSong });
    });

export default {
  run: async (message: Message, query: string) => {
    const songQuery = normalizeSongName(query.split('\n')[0] || '');
    if (!songQuery) {
      return safeReply(message, '❌ Please provide a song name or URL.');
    }

    let outputFile: string;
    let downloadResult: { path: string; title?: string };
    try {
      if (songQuery.includes('random_song')){
        downloadResult = await getRandomSong();
        outputFile = path.resolve(downloadResult.path);
      }
      else{
        downloadResult = await runDownload(songQuery);
        outputFile = path.resolve(downloadResult.path);
      }

      if (!fs.existsSync(outputFile)) {
        throw new Error('Download finished but file is missing.');
      }

      const client = (message as any).client;
      if (!client) throw new Error('Unable to access Whatsapp client inside command.');

      const trackTitle = downloadResult.title || songQuery;
      console.log('[PLAY]', 'downloaded track', trackTitle, outputFile);
      await safeReply(message, `🎵 Playing: ${trackTitle}`);
      const media = MessageMedia.fromFilePath(outputFile);
      return safeReply(message, media);
    } catch (err) {
      console.error('[PLAY ERROR]', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      const reply = errorMessage.includes('Sign in to confirm you’re not a bot')
        ? '❌ YouTube requires browser cookies. Configure YTDLP_COOKIES_FROM_BROWSER=chrome and try again.'
        : '❌ Error playing this track.';
      await safeReply(message, reply);
    }
  },
};
