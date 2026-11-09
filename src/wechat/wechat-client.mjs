import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { fileItem, imageItem, uploadWechatMedia } from './wechat-media.mjs';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const CHANNEL_VERSION = '0.4.0';
const COMMON_HEADERS = Object.freeze({ 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132106' });

export class WechatClient {
  constructor({ token, baseUrl = DEFAULT_BASE_URL, cdnBaseUrl = DEFAULT_CDN_BASE_URL, fetchImpl = fetch }) {
    this.token = String(token || '').trim();
    this.baseUrl = safeBaseUrl(baseUrl);
    this.cdnBaseUrl = safeBaseUrl(cdnBaseUrl);
    this.fetch = fetchImpl;
  }

  async getUpdates(buffer = '', signal) {
    return this.#post('ilink/bot/getupdates', {
      get_updates_buf: buffer,
      base_info: baseInfo(),
    }, signal, 40_000);
  }

  async sendText(toUserId, contextToken, text, signal) {
    return this.sendItem(toUserId, contextToken, { type: 1, text_item: { text: String(text) } }, signal);
  }

  async sendImage(toUserId, contextToken, data, signal) {
    const uploaded = await uploadWechatMedia({ client: this, data, toUserId, mediaType: 1, cdnBaseUrl: this.cdnBaseUrl });
    return this.sendItem(toUserId, contextToken, imageItem(uploaded), signal);
  }

  async sendFile(toUserId, contextToken, data, fileName, signal) {
    const uploaded = await uploadWechatMedia({ client: this, data, toUserId, mediaType: 3, cdnBaseUrl: this.cdnBaseUrl });
    return this.sendItem(toUserId, contextToken, fileItem(uploaded, fileName), signal);
  }

  async sendItem(toUserId, contextToken, item, signal) {
    return this.#post('ilink/bot/sendmessage', {
      msg: messageEnvelope(toUserId, contextToken, item),
      base_info: { channel_version: CHANNEL_VERSION },
    }, signal, 15_000);
  }

  async getUploadUrl(data, signal) {
    return this.#post('ilink/bot/getuploadurl', { ...data, base_info: baseInfo() }, signal, 15_000);
  }

  async startTyping(toUserId, contextToken, signal) {
    const config = await this.#post('ilink/bot/getconfig', {
      ilink_user_id: String(toUserId), context_token: String(contextToken),
      base_info: baseInfo(),
    }, signal, 15_000);
    if (!config.typing_ticket) return null;
    await this.#typing(toUserId, config.typing_ticket, 1, signal);
    return config.typing_ticket;
  }

  stopTyping(toUserId, ticket, signal) {
    return ticket ? this.#typing(toUserId, ticket, 2, signal) : Promise.resolve();
  }

  #typing(toUserId, ticket, status, signal) {
    return this.#post('ilink/bot/sendtyping', {
      ilink_user_id: String(toUserId), typing_ticket: String(ticket), status,
      base_info: baseInfo(),
    }, signal, 15_000);
  }

  async #post(endpoint, data, signal, timeoutMs) {
    if (!this.token) throw new Error('微信账号凭据不完整');
    const body = JSON.stringify(data);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetch(new URL(endpoint, `${this.baseUrl}/`), {
      method: 'POST', signal: combined, body,
      headers: {
        'content-type': 'application/json', 'authorization-type': 'ilink_bot_token',
        authorization: `Bearer ${this.token}`, 'x-wechat-uin': randomWechatUin(), ...COMMON_HEADERS,
      },
    });
    const payload = await response.text();
    if (!response.ok) throw new Error(`微信通道请求失败（${response.status}）`);
    const parsed = parseJson(payload);
    if ((parsed.ret && parsed.ret !== 0) || (parsed.errcode && parsed.errcode !== 0)) {
      throw new Error(`微信通道返回错误：${parsed.errmsg || parsed.ret || parsed.errcode}`);
    }
    return parsed;
  }
}

function messageEnvelope(toUserId, contextToken, item) {
  return {
    from_user_id: '', to_user_id: String(toUserId),
    client_id: `lumenkeep:${Date.now()}-${randomBytes(4).toString('hex')}`,
    message_type: 2, message_state: 2, item_list: [item], context_token: String(contextToken),
  };
}

export async function requestWechatQr(fetchImpl = fetch) {
  const url = new URL('/ilink/bot/get_bot_qrcode', DEFAULT_BASE_URL);
  url.searchParams.set('bot_type', '3');
  const response = await fetchImpl(url, {
    method: 'POST', body: JSON.stringify({ local_token_list: [] }),
    headers: { 'content-type': 'application/json', ...COMMON_HEADERS },
  });
  const payload = parseJson(await response.text());
  if (!response.ok || !payload.qrcode || !payload.qrcode_img_content) throw new Error('暂时没有拿到微信登录二维码');
  return { code: payload.qrcode, image: await qrImageSource(payload.qrcode_img_content) };
}

export async function pollWechatQr(code, fetchImpl = fetch, options = {}) {
  const url = new URL('/ilink/bot/get_qrcode_status', options.baseUrl || DEFAULT_BASE_URL);
  url.searchParams.set('qrcode', code);
  if (options.verifyCode) url.searchParams.set('verify_code', options.verifyCode);
  const response = await fetchImpl(url, { headers: { ...COMMON_HEADERS } });
  const payload = parseJson(await response.text());
  if (!response.ok) throw new Error('微信扫码状态查询失败');
  if (payload.status !== 'confirmed') return {
    status: payload.status || 'waiting',
    baseUrl: payload.redirect_host ? safeBaseUrl(`https://${payload.redirect_host}`)
      : (payload.baseurl ? safeBaseUrl(payload.baseurl) : null),
  };
  if (!payload.bot_token || !payload.ilink_bot_id) throw new Error('微信登录已确认，但账号凭据不完整');
  return {
    status: 'confirmed',
    account: {
      token: payload.bot_token,
      baseUrl: safeBaseUrl(payload.baseurl || DEFAULT_BASE_URL),
      cdnBaseUrl: safeBaseUrl(payload.cdnbaseurl || DEFAULT_CDN_BASE_URL),
      accountId: String(payload.ilink_bot_id),
      userId: String(payload.ilink_user_id || ''),
    },
  };
}

function baseInfo() { return { channel_version: CHANNEL_VERSION, bot_agent: 'Lumenkeep/0.4.0' }; }

function randomWechatUin() {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString('base64');
}

function safeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (url.protocol !== 'https:') throw new Error('微信通道地址必须使用 HTTPS');
  return url.origin + url.pathname.replace(/\/$/u, '');
}

function parseJson(value) {
  try { return JSON.parse(value); }
  catch { throw new Error('微信通道返回了无法识别的数据'); }
}

async function qrImageSource(value) {
  const image = String(value || '').trim();
  if (/^data:image\//iu.test(image)) return image;
  if (/^https?:\/\//iu.test(image)) {
    const path = new URL(image).pathname;
    if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(path)) return image;
    return QRCode.toDataURL(image, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
  }
  return `data:image/png;base64,${image.replace(/\s+/gu, '')}`;
}
