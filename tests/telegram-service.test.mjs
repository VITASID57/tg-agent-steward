import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramService } from '../src/telegram/telegram-service.mjs';

const bot = (id, enabled = true) => ({ id, name: id, enabled });
const secrets = (values) => ({ async read(key) { return values[key] || ''; } });

test('Telegram service independently reconciles multiple bots without exposing tokens', async () => {
  const calls = [];
  const service = new TelegramService({
    envToken: '', controlPlaneStore: { async get() { return { bots: [] }; } },
    secretStore: secrets({ 'telegram:a': 'secret-a', 'telegram:b': 'secret-b' }),
    createRuntime: (id, token) => ({
      async start() { calls.push(`start:${id}:${token.length}`); },
      stop() { calls.push(`stop:${id}`); },
    }),
  });
  const first = { bots: [bot('a'), bot('b', false)] };
  const running = await service.reconcile(first);
  assert.equal(running.bots.find((item) => item.botId === 'a').running, true);
  assert.equal(running.bots.find((item) => item.botId === 'b').running, false);
  assert.equal(JSON.stringify(running).includes('secret-a'), false);

  await service.reconcile({ bots: [bot('a', false), bot('b')] });
  assert.deepEqual(calls, ['start:a:8', 'stop:a', 'start:b:8']);
});

test('Telegram service ignores bots assigned to the WeChat channel', async () => {
  const service = new TelegramService({
    envToken: '', controlPlaneStore: { async get() { return { bots: [] }; } },
    secretStore: secrets({ 'telegram:wx': 'should-not-run' }),
    createRuntime: () => { throw new Error('must not create'); },
  });
  assert.equal((await service.reconcile({ bots: [{ ...bot('wx'), channel: { type: 'wechat-clawbot' } }] })).bots.length, 0);
});

test('Telegram service records a startup failure and retries on the next reconcile', async () => {
  let attempts = 0;
  const service = new TelegramService({
    envToken: '', controlPlaneStore: { async get() { return { bots: [] }; } }, secretStore: secrets({ 'telegram:a': 'x' }),
    createRuntime: () => ({ async start() { attempts += 1; if (attempts === 1) throw new Error('bad token'); }, stop() {} }),
  });
  const state = { bots: [bot('a')] };
  assert.equal((await service.reconcile(state)).bots[0].lastError, 'bad token');
  assert.equal((await service.reconcile(state)).bots[0].running, true);
});

test('Telegram verifies pasted tokens and replaces a running client when the saved token changes', async () => {
  const values = { 'telegram:a': '123:old' };
  const events = [];
  const service = new TelegramService({
    controlPlaneStore: { async get() { return { bots: [bot('a')] }; } }, secretStore: secrets(values),
    async checkToken(token) {
      if (token === '123:bad') throw Object.assign(new Error('provider error includes 123:bad'), { telegramStatus: 401 });
    },
    createRuntime: (_id, token) => ({
      me: { username: token.endsWith('old') ? 'old_bot' : 'new_bot' },
      async start() { events.push(`start ${this.me.username}`); },
      stop() { events.push(`stop ${this.me.username}`); },
    }),
  });
  assert.equal(await service.validateToken(' 123:new '), '123:new');
  await assert.rejects(() => service.validateToken('123:bad'), (error) => error.statusCode === 400 && !error.message.includes('123:bad'));
  assert.equal((await service.reconcile()).bots[0].username, 'old_bot');
  values['telegram:a'] = '123:new';
  assert.equal((await service.reconcile()).bots[0].username, 'new_bot');
  assert.deepEqual(events, ['start old_bot', 'stop old_bot', 'start new_bot']);
});
