import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatService } from '../src/wechat/wechat-service.mjs';

function secretStore(initial = {}) {
  const values = { ...initial };
  return {
    async has(key) { return Boolean(values[key]); }, async read(key) { return values[key] || ''; },
    async write(key, value) { values[key] = value; }, async remove(key) { delete values[key]; }, values,
  };
}

test('wechat service reconciles only WeChat bots and never exposes account credentials', async () => {
  const secrets = secretStore({ 'wechat:wx': JSON.stringify({ token: 'private', baseUrl: 'https://ilinkai.weixin.qq.com', accountId: 'a' }) });
  const calls = [];
  const service = new WechatService({
    controlPlaneStore: { async get() { return { bots: [] }; } }, secrets, secretStore: secrets,
    createRuntime: (id, account) => ({ async start() { calls.push(`start:${id}:${account.token.length}`); }, stop() { calls.push(`stop:${id}`); } }),
  });
  const state = { bots: [
    { id: 'tg', name: 'TG', enabled: true, channel: { type: 'telegram' } },
    { id: 'wx', name: 'WX', enabled: true, channel: { type: 'wechat-clawbot' } },
  ] };
  const status = await service.reconcile(state);
  assert.deepEqual(calls, ['start:wx:7']);
  assert.equal(status.bots.length, 1);
  assert.equal(JSON.stringify(status).includes('private'), false);
});

test('confirmed QR login stores the account privately and authorizes the scanner', async () => {
  let bot = { id: 'wx', name: 'WX', enabled: false, channel: { type: 'wechat-clawbot' }, wechat: { allowedUserIds: [] } };
  const secrets = secretStore();
  const fakeFetch = async (url) => ({ ok: true, status: 200, async text() {
    return JSON.stringify(String(url).includes('get_bot_qrcode')
      ? { qrcode: 'opaque-code', qrcode_img_content: 'https://example.test/qr.png' }
      : { status: 'confirmed', bot_token: 'private-token', baseurl: 'https://ilinkai.weixin.qq.com',
        ilink_bot_id: 'account-1', ilink_user_id: 'scanner-1' });
  } });
  const service = new WechatService({
    controlPlaneStore: { async get() { return { bots: [bot] }; }, async upsertBot(value) { bot = value; return value; } },
    secretStore: secrets, fetchImpl: fakeFetch,
    createRuntime: () => ({ async start() {}, stop() {} }),
  });
  const start = await service.beginLogin('wx');
  const result = await service.loginStatus('wx');
  assert.deepEqual(start, { status: 'waiting', image: 'https://example.test/qr.png', expiresInSeconds: 300 });
  assert.deepEqual(result, { status: 'connected' });
  assert.match(secrets.values['wechat:wx'], /private-token/u);
  assert.deepEqual(bot.wechat.allowedUserIds, ['scanner-1']);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});
