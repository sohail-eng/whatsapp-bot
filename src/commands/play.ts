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

  // Pick a random mp3 from downloads/ (skip subdirs like tiktok/facebook/instagram).
  const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.opus', '.aac', '.wav']);

  const getRandomSong = () =>
    new Promise<{ path: string; title?: string }>((resolve, reject) => {
      const downloadDirectory = path.join(PROJECT_ROOT, 'downloads');
      if (!fs.existsSync(downloadDirectory)) {
        return reject(new Error('No downloaded songs available yet.'));
      }

      const songs = fs
        .readdirSync(downloadDirectory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
        )
        .map((entry) => entry.name);

      if (songs.length === 0) {
        return reject(new Error('No downloaded songs available yet.'));
      }

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
      const lower = errorMessage.toLowerCase();
      let reply = '❌ Error playing this track.';
      if (lower.includes('still blocked after cookie retry')) {
        reply =
          '❌ YouTube blocked the download even with browser cookies. Log into YouTube in Chrome, or export cookies to YTDLP_COOKIES_FILE.';
      } else if (
        lower.includes('sign in to confirm') ||
        lower.includes('not a bot') ||
        lower.includes('requires cookies')
      ) {
        reply = process.env.YTDLP_COOKIES_FROM_BROWSER || process.env.YTDLP_COOKIES_FILE
          ? '❌ YouTube cookie retry failed. Confirm Chrome is logged into YouTube, or set YTDLP_COOKIES_FILE.'
          : '❌ YouTube requires browser cookies. Set YTDLP_COOKIES_FROM_BROWSER=chrome and try again.';
      }
      await safeReply(message, reply);
    }
  },
};
