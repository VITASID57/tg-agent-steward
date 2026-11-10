import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlPlaneStore } from '../src/control/control-plane-store.mjs';

function memoryFile(initial = {}) {
  let value = structuredClone(initial);
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); } };
}

test('a fresh public deployment starts without provider-specific connection presets', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  assert.deepEqual((await store.get()).connections, []);
});

test('connection presets are reusable and cannot be deleted while referenced', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  const codex = await store.upsertConnection({ name: 'Codex', kind: 'codex' });
  const initial = await store.get(); await store.upsertBot({ ...initial.bots[0], chat: { ...initial.bots[0].chat, connectionId: codex.id } });
  await assert.rejects(store.removeConnection(codex.id), /仍被引用/);
  const firstCreatedAt = codex.createdAt;
  const updated = await store.upsertConnection({ ...codex, name: 'shared connection' });
  assert.equal(updated.createdAt, firstCreatedAt);
  assert.equal((await store.get()).connections.find((item) => item.id === codex.id).name, 'shared connection');
});

test('the control plane preserves one bot so the UI always has a recovery path', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  await assert.rejects(store.removeBot('bot-default'), /至少要保留一个 Bot/);
});

test('older bots default to Telegram while a WeChat ClawBot channel is preserved', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  const bot = (await store.get()).bots[0];
  assert.equal(bot.channel.type, 'telegram');
  await store.upsertBot({ ...bot, channel: { type: 'wechat-clawbot' } });
  assert.equal((await store.get()).bots[0].channel.type, 'wechat-clawbot');
});

test('profile channel scopes and Telegram delivery switches persist independently', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  const state = await store.get(); const profile = state.profiles[0]; const bot = state.bots[0];
  await store.upsertProfile({ ...profile, blocks: [
    { id: 'tg-only', title: 'Telegram', body: '只给 Telegram', enabled: true, scope: 'private', surface: 'telegram' },
    { id: 'wx-only', title: '微信', body: '只给微信', enabled: false, scope: 'all', surface: 'wechat' },
  ] });
  await store.upsertBot({ ...bot, telegram: { ...bot.telegram,
    typingIndicator: false, splitParagraphs: false, longMessageSplit: false, mergeBurst: false } });
  const saved = await store.get();
  assert.deepEqual(saved.profiles[0].blocks.map(({ surface, scope, enabled }) => ({ surface, scope, enabled })), [
    { surface: 'telegram', scope: 'private', enabled: true },
    { surface: 'wechat', scope: 'all', enabled: false },
  ]);
  assert.deepEqual(Object.fromEntries(['typingIndicator', 'splitParagraphs', 'longMessageSplit', 'mergeBurst']
    .map((key) => [key, saved.bots[0].telegram[key]])), {
    typingIndicator: false, splitParagraphs: false, longMessageSplit: false, mergeBurst: false,
  });
});

test('bot avatars persist, survive older clients, and can be removed without affecting other bots', async () => {
  const store = new ControlPlaneStore(memoryFile());
  const bot = (await store.get()).bots[0];
  const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  await store.upsertBot({ ...bot, avatar });
  await store.upsertBot({ ...bot, id: 'bot-second', avatar: '' });
  const { avatar: ignored, ...legacy } = bot;
  await store.upsertBot({ ...legacy, name: 'renamed' });
  assert.equal((await store.get()).bots[0].avatar, avatar);
  assert.equal((await store.get()).bots[1].avatar, '');
  for (const invalid of ['https://example.org/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk', 'x'.repeat(200001)]) {
    await assert.rejects(store.upsertBot({ ...bot, avatar: invalid }), /头像/);
    assert.equal((await store.get()).bots[0].avatar, avatar);
  }
  await store.upsertBot({ ...bot, avatar: '' });
  assert.equal((await store.get()).bots[0].avatar, '');
});

test('existing provider presets gain newly supported capabilities during normalization', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  const codex = await store.upsertConnection({ name: 'Codex', kind: 'codex' });
  await store.upsertConnection({ ...codex, capabilities: ['chat'] });
  assert.deepEqual((await store.get()).connections.find((item) => item.id === codex.id).capabilities, ['chat', 'image']);
});

test('subscription image profiles use their real image route instead of a saved chat model', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  const codex = await store.upsertConnection({ name: 'Codex', kind: 'codex' });
  const image = await store.upsertImageProfile({ name: '订阅生图', primary: { connectionId: codex.id, model: 'chat-model' }, fallbacks: [] });
  assert.equal((await store.get()).imageProfiles.find((item) => item.id === image.id).primary.model, 'subscription-imagegen');
});

test('sticker packs are reusable and cannot be deleted while a bot references them', async () => {
  const store = new ControlPlaneStore(memoryFile(), { async get() { return {}; } });
  const created = await store.upsertStickerPack({ name: '日常表情', stickers: [{ id: 'hello', name: '你好', assetId: 'sticker-a.png' }] });
  const state = await store.get(); await store.upsertBot({ ...state.bots[0], stickers: { enabled: true, packIds: [created.id], replyProbability: 42 } });
  await assert.rejects(store.removeStickerPack(created.id), /仍被 Bot 引用/);
  assert.equal((await store.get()).bots[0].stickers.replyProbability, 42);
});
