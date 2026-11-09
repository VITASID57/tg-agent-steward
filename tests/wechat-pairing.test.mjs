import assert from 'node:assert/strict';
import test from 'node:test';
import { PairingService } from '../src/telegram/pairing-service.mjs';

test('pairing service writes access to the selected channel only', async () => {
  let bot = { id: 'wx', telegram: { allowedChatIds: [] }, wechat: { allowedUserIds: [] } };
  const service = new PairingService({
    async get() { return { bots: [structuredClone(bot)] }; },
    async upsertBot(next) { bot = structuredClone(next); },
  });
  const { code } = service.create('wx');
  assert.equal(await service.redeem('wx', code, 'wechat-user', 'wechat-clawbot'), true);
  assert.deepEqual(bot.wechat.allowedUserIds, ['wechat-user']);
  assert.deepEqual(bot.telegram.allowedChatIds, []);
});
