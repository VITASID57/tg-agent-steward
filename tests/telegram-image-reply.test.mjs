import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CodexEngine } from '../src/engines/codex/codex-engine.mjs';
import { ImageService } from '../src/image/image-service.mjs';
import { TelegramRuntime } from '../src/telegram/telegram-runtime.mjs';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

test('a native Codex drawing event reaches Telegram as image bytes without a text-only placeholder', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'steward-image-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const ownPath = join(home, 'generated_images', 'thread', 'own.png');
  const otherPath = join(home, 'generated_images', 'other-thread', 'other.png');
  for (const [folder, file] of [['thread', ownPath], ['other-thread', otherPath]]) {
    await mkdir(join(home, 'generated_images', folder), { recursive: true });
    await writeFile(file, png);
  }
  const codex = new EventEmitter();
  codex.env = { CODEX_HOME: home };
  codex.start = async () => {};
  codex.request = async (method) => {
    if (method === 'thread/start') return { thread: { id: 'thread' } };
    assert.equal(method, 'turn/start');
    const emitItem = (item) => codex.emit('item/completed', { threadId: 'thread', turnId: 'turn', item });
    const own = { id: 'one', type: 'imageGeneration', status: 'completed', savedPath: ownPath };
    emitItem(own);
    emitItem({ ...own, id: 'two', savedPath: otherPath });
    emitItem({ ...own, id: 'three', savedPath: null, result: `data:image/png;base64,${png.toString('base64')}` });
    codex.emit('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed', items: [own] } });
    return { turn: { id: 'turn' } };
  };
  const engine = new CodexEngine(codex);
  const result = await runTelegram({
    bot: { chat: { connectionId: 'codex' } },
    manager: { reply: () => engine.complete({ settings: { runtimeMode: 'agent' }, prompt: 'draw' }) },
  });
  assert.deepEqual(result, [['photo', png, 'image.png'], ['photo', png, 'image.png'],
    ['text', '有 1 张图片没能发送，请稍后再试。']]);
});

test('a conversational drawing test reaches the configured Vertex route and uploads the final photo', async () => {
  const connection = { id: 'vertex', kind: 'vertex-ai', baseUrl: 'https://vertex.test/v1/publishers/google' };
  const imageService = new ImageService({
    controlPlaneStore: { async get() { return { connections: [connection],
      imageProfiles: [{ id: 'art', primary: { connectionId: 'vertex', model: 'gemini-nano-banana-2.1' }, fallbacks: [] }] }; } },
    secretStore: { async read() { return 'fixture-key'; } },
    fetchImpl: async (url, init) => {
      assert.match(url, /gemini-nano-banana-2\.1:generateContent$/u);
      assert.match(JSON.parse(init.body).contents[0].parts[0].text, /老公贝～测试画图/u);
      return Response.json({ candidates: [{ content: { parts: [
        { thought: true, inlineData: { mimeType: 'image/png', data: 'bad' } },
        { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
      ] } }] });
    },
  });
  const result = await runTelegram({
    bot: { image: { enabled: true, imageProfileId: 'art' } },
    manager: { reply: () => assert.fail('the chat model should not generate this request') },
    imageService,
  });
  assert.deepEqual(result, [['photo', png, 'image.png']]);
});

async function runTelegram({ bot, manager, imageService }) {
  const sent = [];
  let first = true;
  const current = { id: 'bot', enabled: true, voice: { enabled: false },
    telegram: { allowedChatIds: ['42'], mergeBurst: false }, ...bot };
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const client = {
    async getMe() { return { username: 'fake_bot' }; },
    async getUpdates(_offset, signal) {
      if (first) {
        first = false;
        return [{ update_id: 1, message: { text: '老公贝～测试画图', chat: { id: 42, type: 'private' } } }];
      }
      finish();
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve([]), { once: true }));
    },
    async sendMessage(_chatId, text) { sent.push(['text', text]); },
    async sendPhoto(_chatId, bytes, filename) { sent.push(['photo', bytes, filename]); },
  };
  const runtime = new TelegramRuntime({ botId: 'bot', client, manager, imageService,
    controlPlaneStore: { async get() { return { bots: [current], connections: [{ id: 'codex', kind: 'codex' }] }; } },
    logger: { error() {} } });
  await runtime.start();
  let timeout;
  try {
    await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Telegram fixture timed out')), 1000); })]);
    return sent;
  } finally { clearTimeout(timeout); runtime.stop(); }
}
