import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramRuntime } from '../src/telegram/telegram-runtime.mjs';

function bot() {
  return { id: 'bot', name: 'bot', enabled: true, profileId: 'profile', chat: { connectionId: 'chat' },
    telegram: { allowedChatIds: ['42'], typingIndicator: false, splitParagraphs: false, longMessageSplit: true, mergeBurst: false, mergeDelayMs: 0, groupMode: false },
    voice: { enabled: true, replyProbability: 30, voiceProfileId: 'voice', sendTextWithVoice: true } };
}

async function run(random) {
  const sent = []; let updates = 0; let synthesized = 0; let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const current = bot();
  const client = {
    async getMe() { return { username: 'test' }; },
    async getUpdates(_offset, signal) {
      if (updates++ === 0) return [{ update_id: 1, message: { text: 'hello', chat: { id: 42, type: 'private' } } }];
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    },
    async sendMessage(_chatId, text) { sent.push(`text:${text}`); finish(); }, async sendTyping() {},
    async sendVoice() { sent.push('voice'); finish(); }, async sendAudio() { sent.push('audio'); finish(); },
  };
  const runtime = new TelegramRuntime({ botId: 'bot', client, random, controlPlaneStore: { async get() { return { bots: [current] }; } },
    manager: { async reply() { return { text: 'reply' }; } }, pairing: {}, engines: {},
    voiceService: { async synthesize() { synthesized += 1; return { mime: 'audio/mpeg', extension: 'mp3', audio: Buffer.from([1]) }; } },
    logger: { error() {} } });
  await runtime.start(); await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('runtime timeout')), 500))]);
  await new Promise((resolve) => setTimeout(resolve, 15)); runtime.stop();
  return { sent, synthesized };
}

test('Telegram runtime only calls TTS when the saved probability gate hits', async () => {
  const missed = await run(() => 0.5); assert.equal(missed.synthesized, 0); assert.deepEqual(missed.sent, ['text:reply']);
  const hit = await run(() => 0.1); assert.equal(hit.synthesized, 1); assert.deepEqual(hit.sent, ['text:reply', 'voice']);
});
