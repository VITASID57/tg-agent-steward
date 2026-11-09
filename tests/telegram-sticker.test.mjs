import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramRuntime } from '../src/telegram/telegram-runtime.mjs';

test('Telegram runtime sends a revalidated sticker asset after the text reply', async () => {
  const sent = []; let polls = 0; let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const bot = { id: 'bot', enabled: true, chat: { connectionId: 'chat' },
    telegram: { allowedChatIds: ['42'], typingIndicator: false, splitParagraphs: false, longMessageSplit: true, mergeBurst: false, mergeDelayMs: 0, groupMode: false },
    voice: { enabled: false, replyProbability: 0, voiceProfileId: null, sendTextWithVoice: true } };
  const client = {
    async getMe() { return { username: 'test' }; },
    async getUpdates(_offset, signal) {
      if (polls++ === 0) return [{ update_id: 1, message: { text: '开心', chat: { id: 42, type: 'private' } } }];
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    },
    async sendMessage(_chatId, text) { sent.push(`text:${text}`); }, async sendTyping() {},
    async sendPhoto(_chatId, data, filename) { sent.push(`photo:${filename}:${data.toString()}`); finish(); },
  };
  const runtime = new TelegramRuntime({ botId: 'bot', client, controlPlaneStore: { get: async () => ({ bots: [bot] }) },
    manager: { reply: async () => ({ text: '好呀', sticker: { id: 'happy', assetId: 'sticker-a.png' } }) }, pairing: {}, engines: {},
    voiceService: {}, stickerService: { readAsset: async () => ({ data: Buffer.from('image'), extension: 'png' }) }, logger: { error() {} } });
  await runtime.start(); await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('runtime timeout')), 500))]);
  runtime.stop(); assert.deepEqual(sent, ['text:好呀', 'photo:sticker.png:image']);
});
