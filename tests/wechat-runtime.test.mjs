import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatRuntime, extractWechatText, splitWechatMessage } from '../src/wechat/wechat-runtime.mjs';

function memoryFile(initial = { bots: {} }) {
  let value = structuredClone(initial);
  return { async read() { return structuredClone(value); }, async update(update) { value = await update(structuredClone(value)); return value; } };
}

test('wechat runtime routes messages after a rejected startup notification if polling works', async () => {
  const sent = []; const states = []; let polls = 0; let context;
  const client = {
    async notifyStart() { throw Object.assign(new Error('expired'), { code: -14 }); },
    async notifyStop() {},
    async getUpdates(_buffer, signal) {
      polls += 1;
      if (polls === 1) return { get_updates_buf: 'next-buffer', msgs: [{
        msg_id: 'message-1', message_type: 1, from_user_id: 'user-1', context_token: 'ctx-1',
        item_list: [{ type: 1, text_item: { text: '你好' } }],
      }] };
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ msgs: [] }), { once: true }));
    },
    async sendText(userId, token, text) { sent.push({ userId, token, text }); },
    async startTyping() { return null; }, async stopTyping() {},
  };
  const stateFile = memoryFile();
  const runtime = new WechatRuntime({
    botId: 'wechat-bot', client, stateFile,
    controlPlaneStore: { async get() { return { bots: [{ id: 'wechat-bot', enabled: true, channel: { type: 'wechat-clawbot' },
      wechat: { allowedUserIds: ['user-1'], typingIndicator: false, splitParagraphs: false, longMessageSplit: true } }] }; } },
    manager: { async reply(chatId, text, options) { context = { chatId, text, options }; return { text: '收到啦' }; } },
    onStatus(value) { states.push(value); },
    logger: { error() {} },
  });
  await runtime.start();
  await waitFor(() => sent.length === 1);
  runtime.stop();
  assert.deepEqual(context, { chatId: 'user-1', text: '你好', options: {
    surface: 'wechat', botId: 'wechat-bot', group: false, voiceGuide: '', transcribed: false,
  } });
  assert.deepEqual(sent, [{ userId: 'user-1', token: 'ctx-1', text: '收到啦' }]);
  assert.equal((await stateFile.read()).bots['wechat-bot'].syncBuffer, 'next-buffer');
  assert.equal(states[0].checking, true);
  assert.equal(states.at(-1).running, true);
});

test('wechat runtime stops polling and surfaces an expired login', async () => {
  const statuses = []; let polls = 0;
  const runtime = new WechatRuntime({ botId: 'wechat-bot', stateFile: memoryFile(),
    client: {
      async notifyStart() {}, async notifyStop() {},
      async getUpdates() { polls += 1; throw Object.assign(new Error('expired'), { code: -14 }); },
    },
    controlPlaneStore: { async get() { return { bots: [] }; } }, manager: {},
    onStatus(value) { statuses.push(value); }, logger: { error() {} },
  });
  await runtime.start(); await waitFor(() => statuses.some((item) => item.sessionExpired)); runtime.stop();
  assert.equal(polls, 1);
  assert.match(statuses.at(-1).lastError, /会话已失效/u);
  assert.equal(statuses.at(-1).sessionExpired, true);
});

test('wechat voice transcript becomes user text and can be switched off', () => {
  const message = { item_list: [{ type: 3, voice_item: { text: '微信识别出的语音' } }] };
  assert.equal(extractWechatText(message, { usePlatformTranscription: true }), '微信识别出的语音');
  assert.equal(extractWechatText(message, { usePlatformTranscription: false }), '');
});

test('wechat sentence splitting follows the per-bot switches and protects long messages', () => {
  assert.deepEqual(splitWechatMessage('第一句\n\n第二句', { splitParagraphs: true, longMessageSplit: true }), ['第一句', '第二句']);
  assert.deepEqual(splitWechatMessage('第一句\n\n第二句', { splitParagraphs: false, longMessageSplit: true }), ['第一句\n\n第二句']);
  assert.equal(splitWechatMessage('字'.repeat(1900), { splitParagraphs: false, longMessageSplit: true }).length, 2);
});

test('wechat pairing grants an unknown sender before normal conversation', async () => {
  const sent = []; let polls = 0; let redeemed;
  const client = {
    async getUpdates(_buffer, signal) {
      if (polls++ === 0) return { msgs: [{ msg_id: 'pair-1', message_type: 1, from_user_id: 'new-user', context_token: 'ctx',
        item_list: [{ type: 1, text_item: { text: '/pair 123456' } }] }] };
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ msgs: [] }), { once: true }));
    },
    async sendText(_user, _token, text) { sent.push(text); },
  };
  const runtime = new WechatRuntime({ botId: 'wechat-bot', client, stateFile: memoryFile(),
    controlPlaneStore: { async get() { return { bots: [{ id: 'wechat-bot', enabled: true, channel: { type: 'wechat-clawbot' }, wechat: { allowedUserIds: [] } }] }; } },
    pairing: { async redeem(...args) { redeemed = args; return true; } }, manager: { async reply() { throw new Error('should not reply'); } },
    logger: { error() {} } });
  await runtime.start(); await waitFor(() => sent.length === 1); runtime.stop();
  assert.deepEqual(redeemed, ['wechat-bot', '123456', 'new-user', 'wechat-clawbot']);
  assert.equal(sent[0], '配对成功，现在可以聊天了。');
});

test('wechat routes a clear natural-language image request to the configured image profile', async () => {
  const sent = []; let polls = 0; let prompt = '';
  const client = { async notifyStart() {}, async notifyStop() {},
    async getUpdates(_buffer, signal) {
      if (polls++ === 0) return { msgs: [{ msg_id: 'draw-1', message_type: 1, from_user_id: 'user-1', context_token: 'ctx',
        item_list: [{ type: 1, text_item: { text: '给我画张图，随便画啥' } }] }] };
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ msgs: [] }), { once: true }));
    },
    async sendImage(_user, _token, image) { sent.push(image); }, async startTyping() { return null; }, async stopTyping() {},
  };
  const bot = { id: 'wechat-bot', enabled: true, channel: { type: 'wechat-clawbot' },
    wechat: { allowedUserIds: ['user-1'] }, image: { enabled: true, imageProfileId: 'art' } };
  const runtime = new WechatRuntime({ botId: 'wechat-bot', client, stateFile: memoryFile(),
    controlPlaneStore: { async get() { return { bots: [bot] }; } },
    manager: { async reply() { throw new Error('image request should not reach chat'); } },
    imageService: { async generate(_profile, value) { prompt = value; return { image: Buffer.from([1]) }; } }, logger: { error() {} } });
  await runtime.start(); await waitFor(() => sent.length === 1); runtime.stop();
  assert.equal(prompt, '给我画张图，随便画啥'); assert.equal(sent[0][0], 1);
});

test('wechat proactive wake reuses the latest target context and respects SILENT', async () => {
  const sent = []; const stateFile = memoryFile({ bots: { 'wechat-bot': { contacts: {
    'user-1': { contextToken: 'recent-context', at: '2026-11-08T10:00:00.000Z' },
  } } } });
  const bot = { id: 'wechat-bot', enabled: true, channel: { type: 'wechat-clawbot' },
    wechat: { allowedUserIds: ['user-1'], typingIndicator: false, splitParagraphs: true, longMessageSplit: true },
    voice: { enabled: false }, stickers: { enabled: false } };
  const client = { async sendText(user, token, text) { sent.push({ user, token, text }); },
    async startTyping() { return null; }, async stopTyping() {} };
  let reply = '[[SILENT]]';
  const runtime = new WechatRuntime({ botId: 'wechat-bot', client, stateFile,
    controlPlaneStore: { async get() { return { bots: [bot] }; } }, manager: { async reply() { return { text: reply }; } }, logger: { error() {} } });
  assert.deepEqual(await runtime.proactive('user-1', 'wake'), { sent: false, reason: 'silent' }); assert.equal(sent.length, 0);
  reply = '突然想起你了'; assert.equal((await runtime.proactive('user-1', 'wake')).sent, true);
  assert.deepEqual(sent, [{ user: 'user-1', token: 'recent-context', text: '突然想起你了' }]);
  await assert.rejects(() => runtime.proactive('other-user', 'wake'), /先发来一条新消息/u);
});

async function waitFor(check) {
  const deadline = Date.now() + 1000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
