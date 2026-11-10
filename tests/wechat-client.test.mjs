import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatClient, pollWechatQr, requestWechatQr } from '../src/wechat/wechat-client.mjs';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}

test('wechat QR login returns only public QR data and normalizes confirmed account', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('get_bot_qrcode')) return response({ qrcode: 'qr-code', qrcode_img_content: 'https://example.test/qr.png' });
    return response({ status: 'confirmed', bot_token: 'secret-token', baseurl: 'https://ilinkai.weixin.qq.com/', ilink_bot_id: 'bot-1', ilink_user_id: 'user-1' });
  };
  assert.deepEqual(await requestWechatQr(fakeFetch), { code: 'qr-code', image: 'https://example.test/qr.png' });
  const confirmed = await pollWechatQr('qr-code', fakeFetch);
  assert.equal(confirmed.account.token, 'secret-token');
  assert.equal(confirmed.account.baseUrl, 'https://ilinkai.weixin.qq.com');
  assert.match(calls[0], /bot_type=3/u);
});

test('wechat QR login turns raw base64 into a browser image source', async () => {
  const result = await requestWechatQr(async () => response({ qrcode: 'qr-code', qrcode_img_content: 'iVBORw0KGgo=' }));
  assert.equal(result.image, 'data:image/png;base64,iVBORw0KGgo=');
});

test('wechat QR login renders the official QR landing page as a scannable image', async () => {
  const result = await requestWechatQr(async () => response({
    qrcode: 'qr-code', qrcode_img_content: 'https://example.test/q/opaque-login-code',
  }));
  assert.match(result.image, /^data:image\/png;base64,/u);
  assert.ok(result.image.length > 500);
});

test('wechat client sends the official iLink text envelope without exposing the token in errors', async () => {
  let request;
  const client = new WechatClient({ token: 'super-secret', fetchImpl: async (url, options) => {
    request = { url: String(url), options }; return response({ ret: 0 });
  } });
  await client.sendText('recipient', 'context-token', 'hello');
  const body = JSON.parse(request.options.body);
  assert.equal(body.msg.to_user_id, 'recipient');
  assert.equal(body.msg.context_token, 'context-token');
  assert.equal(body.msg.item_list[0].text_item.text, 'hello');
  assert.equal(request.options.headers.authorization, 'Bearer super-secret');
  assert.equal(request.options.headers['iLink-App-ClientVersion'], '132106');
  assert.equal(body.base_info.channel_version, '2.4.10');
});

test('wechat client announces channel start and stop', async () => {
  const calls = [];
  const client = new WechatClient({ token: 'secret', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) }); return response({ ret: 0 });
  } });
  await client.notifyStart(); await client.notifyStop();
  assert.match(calls[0].url, /msg\/notifystart/u);
  assert.match(calls[1].url, /msg\/notifystop/u);
  assert.equal(calls[0].body.base_info.channel_version, '2.4.10');
});

test('wechat client turns an expired iLink session into an actionable error', async () => {
  const client = new WechatClient({ token: 'expired', fetchImpl: async () => response({ errcode: -14, errmsg: 'session timeout' }) });
  await assert.rejects(() => client.getUpdates(), (error) => error.code === -14 && /重新扫码/u.test(error.message));
});

test('wechat client starts and stops the official typing indicator', async () => {
  const paths = []; const bodies = [];
  const client = new WechatClient({ token: 'secret', fetchImpl: async (url, options) => {
    paths.push(String(url)); bodies.push(JSON.parse(options.body));
    return response(String(url).includes('getconfig') ? { ret: 0, typing_ticket: 'ticket-1' } : { ret: 0 });
  } });
  const ticket = await client.startTyping('user-1', 'context-1');
  await client.stopTyping('user-1', ticket);
  assert.equal(ticket, 'ticket-1');
  assert.match(paths[0], /getconfig/u); assert.equal(bodies[1].status, 1); assert.equal(bodies[2].status, 2);
});

test('wechat client encrypts and sends images through the official CDN shape', async () => {
  const calls = []; let sentBody;
  const client = new WechatClient({ token: 'secret', fetchImpl: async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('getuploadurl')) return response({ ret: 0, upload_full_url: 'https://cdn.example/upload' });
    if (String(url).includes('cdn.example')) return { ok: true, status: 200, headers: { get(name) { return name === 'x-encrypted-param' ? 'download-param' : null; } } };
    sentBody = JSON.parse(options.body); return response({ ret: 0, message_id: 'message-1' });
  } });
  await client.sendImage('user-1', 'context-1', Buffer.from('image-bytes'));
  assert.equal(calls.length, 3);
  assert.equal(sentBody.msg.item_list[0].type, 2);
  assert.equal(sentBody.msg.item_list[0].image_item.media.encrypt_query_param, 'download-param');
});
