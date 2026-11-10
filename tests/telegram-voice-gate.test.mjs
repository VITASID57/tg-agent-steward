import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramRuntime } from '../src/telegram/telegram-runtime.mjs';

function bot() {
  return { id: 'bot', name: 'bot', enabled: true, profileId: 'profile', chat: { connectionId: 'chat' },
    telegram: { allowedChatIds: ['42'], typingIndicator: false, splitParagraphs: false, longMessageSplit: true, mergeBurst: false, mergeDelayMs: 0, groupMode: false },
    voice: { enabled: true, replyProbability: 30, voiceProfileId: 'voice', sendTextWithVoice: true } };
}

async function run(random, input = 'hello', synthesize = async () => ({ mime: 'audio/mpeg', extension: 'mp3', audio: Buffer.from([1]) })) {
  const sent = []; let updates = 0; let synthesized = 0; let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const current = bot();
  const client = {
    async getMe() { return { username: 'test' }; },
    async getUpdates(_offset, signal) {
      if (updates++ === 0) return [{ update_id: 1, message: { text: input, chat: { id: 42, type: 'private' } } }];
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    },
    async sendMessage(_chatId, text) { sent.push(`text:${text}`); finish(); }, async sendTyping() {},
    async sendVoice() { sent.push('voice'); finish(); }, async sendAudio() { sent.push('audio'); finish(); },
  };
  const runtime = new TelegramRuntime({ botId: 'bot', client, random, controlPlaneStore: { async get() { return { bots: [current] }; } },
    manager: { async reply() { return { text: 'reply' }; } }, pairing: {}, engines: {},
    voiceService: { async synthesize() { synthesized += 1; return synthesize(); } },
    logger: { error() {} } });
  await runtime.start(); await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('runtime timeout')), 500))]);
  await new Promise((resolve) => setTimeout(resolve, 15)); runtime.stop();
  return { sent, synthesized };
}

test('Telegram runtime only calls TTS when the saved probability gate hits', async () => {
  const missed = await run(() => 0.5); assert.equal(missed.synthesized, 0); assert.deepEqual(missed.sent, ['text:reply']);
  const hit = await run(() => 0.1); assert.equal(hit.synthesized, 1); assert.deepEqual(hit.sent, ['text:reply', 'voice']);
});

test('an explicit Telegram voice request bypasses probability and reports a real TTS failure', async () => {
  const success = await run(() => 0.99, '给我发语音看看');
  assert.equal(success.synthesized, 1); assert.deepEqual(success.sent, ['text:reply', 'voice']);
  const failed = await run(() => 0.99, '用语音说给我听', async () => { throw new Error('填入的是 API Key ID'); });
  assert.equal(failed.synthesized, 1);
  assert.deepEqual(failed.sent, ['text:reply', 'text:语音没有发出去：填入的是 API Key ID']);
});
