import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramRuntime } from '../src/telegram/telegram-runtime.mjs';

test('Telegram voice messages are downloaded, transcribed, and sent through the normal conversation path', async () => {
  let updates = 0; let received = ''; let finish; const done = new Promise((resolve) => { finish = resolve; });
  const bot = { id: 'bot', enabled: true, telegram: { allowedChatIds: ['42'], typingIndicator: false, splitParagraphs: false,
    longMessageSplit: true, mergeBurst: false, mergeDelayMs: 0, groupMode: false }, voice: { enabled: false,
    replyProbability: 0, voiceProfileId: null, transcriptionConnectionId: 'stt', sendTextWithVoice: true } };
  const client = {
    async getMe() { return { username: 'test' }; },
    async getUpdates(_offset, signal) { if (updates++ === 0) return [{ update_id: 1, message: { voice: { file_id: 'file', mime_type: 'audio/ogg' }, chat: { id: 42, type: 'private' } } }];
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true })); },
    async downloadFile() { return { data: Buffer.from([1, 2]), path: 'voice.ogg' }; }, async sendTyping() {},
    async sendMessage(_chatId, text) { if (text === 'reply') finish(); },
  };
  const runtime = new TelegramRuntime({ botId: 'bot', client, controlPlaneStore: { async get() { return { bots: [bot] }; } },
    manager: { async reply(_chatId, text) { received = text; return { text: 'reply' }; } }, pairing: {}, engines: {}, voiceService: {},
    transcriptionService: { async transcribe(_id, audio, mime) { assert.equal(audio.length, 2); assert.equal(mime, 'audio/ogg'); return '转写文字'; } },
    imageService: {}, toolBroker: {}, logger: { error() {} } });
  await runtime.start(); await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('runtime timeout')), 500))]);
  runtime.stop(); assert.equal(received, '转写文字');
});
