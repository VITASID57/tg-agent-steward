import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlPlaneStore } from '../src/control/control-plane-store.mjs';
import { JsonFile } from '../src/storage/json-file.mjs';

function memoryFile(initial = {}) {
  let value = structuredClone(initial);
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); },
    async update(mutator) { value = structuredClone(await mutator(structuredClone(value))); return value; } };
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

test('connection self-check persists across ordinary saves without revising the live connection', async () => {
  const store = new ControlPlaneStore(memoryFile());
  const original = await store.upsertConnection({ kind: 'vertex-ai', baseUrl: 'https://example.test/v1' });
  const report = { status: 'passed', ok: true, title: '目录已通过', message: '测试详情', at: '2026-11-10T10:00:00.000Z' };
  await store.recordConnectionTest(original, report);
  const afterTest = (await store.get()).connections[0];
  assert.equal(afterTest.updatedAt, original.updatedAt);
  const { lastTest, ...editorInput } = afterTest;
  const saved = await store.upsertConnection({ ...editorInput, name: '改名', cachedModels: ['new-model'], options: {
    authType: 'api-key', runtimeMode: 'chat', apiStyle: 'chat-completions', authName: '', idleHours: 6,
    sandbox: 'read-only', approvalPolicy: 'never', args: [], writeEnabled: false, accessMode: 'approval',
  } });
  assert.deepEqual(saved.lastTest, report);
  assert.deepEqual((await store.get()).connections[0].lastTest, report);
  const changed = await store.upsertConnection({ ...saved, options: { ...saved.options, authType: 'bearer' } });
  assert.equal(changed.lastTest, null);
  await assert.rejects(store.recordConnectionTest(saved, report), { statusCode: 409 });
  assert.equal((await store.get()).connections[0].options.authType, 'bearer');
  await store.recordConnectionTest(changed, report);
  const rotated = await store.upsertConnection(changed, async () => true);
  assert.equal(rotated.lastTest, null);
  await store.removeConnection(rotated.id);
  await assert.rejects(store.recordConnectionTest(rotated, report), { statusCode: 404 });
  assert.deepEqual((await store.get()).connections, []);
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

test('whole preset deletion protects references, then removes released presets', async () => {
  const store = new ControlPlaneStore(memoryFile());
  const { bots: [initial], profiles: [original] } = await store.get();
  const profile = await store.upsertProfile({ name: '替用人物' });
  const connection = await store.upsertConnection({ name: '备用连接', kind: 'vertex-ai' });
  const voice = await store.upsertVoiceProfile({ name: '备用声音', fallbacks: [{ connectionId: connection.id }] });
  const image = await store.upsertImageProfile({ name: '备用生图', primary: { connectionId: connection.id } });
  const pack = await store.upsertStickerPack({ name: '备用表情' });
  await store.upsertBot({ ...initial, profileId: profile.id, name: '测试 Bot',
    voice: { ...initial.voice, voiceProfileId: voice.id }, image: { ...initial.image, imageProfileId: image.id },
    stickers: { ...initial.stickers, packIds: [pack.id] } });
  const deletions = [[store.removeProfile, profile], [store.removeVoiceProfile, voice],
    [store.removeImageProfile, image], [store.removeStickerPack, pack]];
  for (const [remove, item] of deletions) {
    await assert.rejects(remove.call(store, item.id), { statusCode: 409, message: /测试 Bot/u });
  }
  await assert.rejects(store.removeConnection(connection.id), { statusCode: 409, message: /备用声音、备用生图/u });
  await store.upsertBot({ ...initial, profileId: original.id });
  for (const [remove, item] of deletions) await remove.call(store, item.id);
  await store.removeConnection(connection.id);
  const saved = await store.get();
  assert.deepEqual(saved.profiles.map((entry) => entry.id), [original.id]);
  assert.deepEqual([saved.connections, saved.voiceProfiles, saved.imageProfiles, saved.stickerPacks], [[], [], [], []]);
  await assert.rejects(store.upsertBot({ ...initial, profileId: profile.id }), { statusCode: 409 });
  assert.equal((await store.get()).bots[0].profileId, original.id);
});

test('common modules persist separately from profile copies, including when all blocks are removed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'steward-profile-library-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'control.json');
  const store = new ControlPlaneStore(new JsonFile(path, {}));
  const { profiles: [profile] } = await store.get();
  const [template, emptied] = await Promise.all([
    store.addProfileBlockTemplate({ title: '写作口吻', body: '保留自己的口吻', enabled: false, surface: 'telegram', scope: 'private' }),
    store.upsertProfile({ ...profile, blocks: [] }),
  ]);
  const restarted = new ControlPlaneStore(new JsonFile(path, {}));
  const state = await restarted.get();
  assert.deepEqual(state.profiles[0], emptied);
  assert.deepEqual(state.profiles[0].blocks, []);
  assert.deepEqual(state.profileBlockTemplates, [template]);
  assert.deepEqual({ ...template, id: undefined }, { id: undefined, title: '写作口吻', body: '保留自己的口吻',
    enabled: false, surface: 'telegram', scope: 'private' });
  const other = await restarted.upsertProfile({ name: '另一个人物', blocks: [{ ...template, id: 'copy' }] });
  await restarted.removeProfileBlockTemplate(template.id);
  assert.deepEqual((await restarted.get()).profileBlockTemplates, []);
  assert.deepEqual((await restarted.get()).profiles.find((entry) => entry.id === other.id).blocks, other.blocks);
  await assert.rejects(restarted.addProfileBlockTemplate({ title: '空正文', body: '  ' }), { statusCode: 400 });
});
