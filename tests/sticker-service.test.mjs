import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StickerAssetStore } from '../src/stickers/sticker-asset-store.mjs';
import { StickerService } from '../src/stickers/sticker-service.mjs';

const pack = { id: 'pack-one', name: '常用', stickers: [
  { id: 'happy', name: '开心', meaning: '庆祝开心', tags: ['笑'], assetId: 'sticker-a.png', enabled: true },
  { id: 'sad', name: '难过', meaning: '伤心安慰', tags: ['哭'], assetId: 'sticker-b.png', enabled: true },
] };
function service(random = () => 0) { return new StickerService({ random, controlPlaneStore: { get: async () => ({ stickerPacks: [pack] }) }, assetStore: {} }); }
const bot = { stickers: { enabled: true, packIds: ['pack-one'], replyProbability: 30 } };

test('sticker candidates obey probability, explicit request, declines and recent penalty', async () => {
  assert.deepEqual(await service(() => 0.9).candidates(bot, '今天开心', {}), []);
  assert.equal((await service(() => 0.9).candidates(bot, '今天开心，发个表情包', {}))[0].id, 'happy');
  assert.deepEqual(await service().candidates(bot, '别发任何表情包', {}), []);
  assert.equal((await service().candidates(bot, '我又开心又难过', { recentStickerIds: ['happy'] }))[0].id, 'sad');
});

test('only a current candidate marker can select a sticker', () => {
  const instance = service();
  assert.deepEqual(instance.extract('好呀 [[STICKER:invented]]', [pack.stickers[0]]), { text: '好呀', sticker: null });
  assert.equal(instance.extract('好呀 [[STICKER:happy]]', [pack.stickers[0]]).sticker.id, 'happy');
});

test('sticker asset store checks declared image content and blocks unsafe ids', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sticker-test-')); const store = new StickerAssetStore(folder);
  try {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const saved = await store.save({ mime: 'image/png', dataBase64: png.toString('base64') });
    assert.deepEqual((await store.read(saved.id)).data, png);
    await assert.rejects(store.read('../secret.png'), /不合法/);
    await assert.rejects(store.save({ mime: 'image/png', dataBase64: Buffer.from('not png').toString('base64') }), /格式不一致/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
