import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneStore } from '../src/control/control-plane-store.mjs';
import { JsonFile } from '../src/storage/json-file.mjs';
import { SecretStore } from '../src/storage/secret-store.mjs';
import { handleCommand } from '../src/telegram/commands.mjs';
import { PairingService } from '../src/telegram/pairing-service.mjs';

test('an owner link binds a private Telegram chat once and explicitly grants it access to other Bots', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'steward-owner-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ControlPlaneStore(new JsonFile(join(dir, 'control.json'), {}));
  const secrets = new SecretStore(new JsonFile(join(dir, 'secrets.json'), {}));
  const pairing = new PairingService(store, secrets);
  const [first] = (await store.get()).bots;
  const second = await store.upsertBot({ ...first, id: 'second' });
  const getBot = async (id) => (await store.get()).bots.find((bot) => bot.id === id);
  const result = await pairing.startOwnerAccess(first, 'first_bot');
  const parameter = new URL(result.url).searchParams.get('start');
  assert.match(parameter, /^lko_[A-Za-z0-9_-]{32}$/u);
  const open = (chatType, bot = first, botUsername = 'first_bot') =>
    handleCommand({ text: `/start ${parameter}`, chatId: '123', chatType, botUsername, bot, pairing });
  assert.match((await open('group')).text, /失效/u);
  assert.match((await open('private', second)).text, /失效/u);
  assert.match((await open('private', first, 'replacement_bot')).text, /失效/u);
  assert.deepEqual(await pairing.ownerAccess(await getBot(first.id)), { hasOwner: false, allowed: false });
  const claims = await Promise.all([open('private'), open('private')]);
  assert.equal(claims.filter(({ text }) => text.includes('已绑定')).length, 1);
  assert.deepEqual(await pairing.ownerAccess(await getBot(first.id)), { hasOwner: true, allowed: true, ownerChatId: '123' });
  const restarted = new PairingService(store, secrets);
  assert.deepEqual(await restarted.ownerAccess(await getBot(second.id)), { hasOwner: true, allowed: false });
  assert.deepEqual(await restarted.startOwnerAccess(second, 'second_bot'), { allowed: true, url: 'https://t.me/second_bot' });
  assert.deepEqual((await getBot(second.id)).telegram.allowedChatIds, ['123']);
});
