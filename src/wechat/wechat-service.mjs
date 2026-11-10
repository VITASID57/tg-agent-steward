import { pollWechatQr, requestWechatQr } from './wechat-client.mjs';

export class WechatService {
  constructor({ controlPlaneStore, secretStore, createRuntime, eventStore = null, fetchImpl = fetch }) {
    this.controlPlaneStore = controlPlaneStore;
    this.secretStore = secretStore;
    this.createRuntime = createRuntime;
    this.fetch = fetchImpl;
    this.eventStore = eventStore;
    this.runtimes = new Map();
    this.states = new Map();
    this.logins = new Map();
  }

  async reconcile(controlPlane = null) {
    const state = controlPlane || await this.controlPlaneStore.get();
    const wanted = new Set();
    for (const bot of state.bots.filter((item) => item.channel?.type === 'wechat-clawbot')) {
      const account = await this.#account(bot.id);
      if (!bot.enabled || !account) {
        this.#stop(bot.id); this.states.set(bot.id, status(bot, Boolean(account), false, null)); continue;
      }
      wanted.add(bot.id);
      if (this.runtimes.has(bot.id)) { this.states.set(bot.id, status(bot, true, true, null)); continue; }
      const runtime = this.createRuntime(bot.id, account);
      try {
        await runtime.start(); this.runtimes.set(bot.id, runtime); this.states.set(bot.id, status(bot, true, true, null));
        await this.eventStore?.record(bot.id, { kind: 'channel', status: 'success', title: '微信 Bot 已启动', detail: '消息轮询已连接。' });
      } catch (error) {
        runtime.stop(); this.states.set(bot.id, status(bot, true, false, error.message));
        await this.eventStore?.record(bot.id, { kind: 'channel', status: 'error', title: '微信 Bot 启动失败', detail: error.message });
      }
    }
    for (const id of this.runtimes.keys()) if (!wanted.has(id)) this.#stop(id);
    return this.status(state);
  }

  async beginLogin(botId) {
    await this.#assertWechatBot(botId);
    const qr = await requestWechatQr(this.fetch);
    this.logins.set(botId, { code: qr.code, createdAt: Date.now(), baseUrl: null, verifyCode: null });
    return { status: 'waiting', image: qr.image, expiresInSeconds: 300 };
  }

  async loginStatus(botId) {
    await this.#assertWechatBot(botId);
    const pending = this.logins.get(botId);
    if (!pending) return { status: await this.secretStore.has(`wechat:${botId}`) ? 'connected' : 'idle' };
    if (Date.now() - pending.createdAt > 300_000) {
      this.logins.delete(botId); return { status: 'expired' };
    }
    const result = await pollWechatQr(pending.code, this.fetch, { baseUrl: pending.baseUrl, verifyCode: pending.verifyCode });
    if (result.baseUrl) pending.baseUrl = result.baseUrl;
    if (result.status === 'binded_redirect' && await this.secretStore.has(`wechat:${botId}`)) {
      this.logins.delete(botId); await this.reconcile(); return { status: 'connected' };
    }
    if (result.status === 'expired') this.logins.delete(botId);
    if (result.status !== 'confirmed') return { status: qrStatus(result.status) };
    await this.secretStore.write(`wechat:${botId}`, JSON.stringify(result.account));
    if (result.account.userId) {
      const bot = await this.#assertWechatBot(botId);
      await this.controlPlaneStore.upsertBot({ ...bot, wechat: { ...bot.wechat,
        allowedUserIds: [...new Set([...(bot.wechat?.allowedUserIds || []), String(result.account.userId)])] } });
    }
    this.logins.delete(botId); this.#stop(botId);
    await this.reconcile();
    return { status: 'connected' };
  }

  async submitVerifyCode(botId, code) {
    await this.#assertWechatBot(botId);
    const pending = this.logins.get(botId);
    if (!pending) throw Object.assign(new Error('当前没有等待校验的微信二维码'), { statusCode: 409 });
    const value = String(code || '').trim();
    if (!/^\d{1,12}$/u.test(value)) throw Object.assign(new Error('请输入手机微信显示的数字'), { statusCode: 400 });
    pending.verifyCode = value;
    return { ok: true };
  }

  async disconnect(botId) {
    this.logins.delete(botId); this.#stop(botId);
    await this.secretStore.remove(`wechat:${botId}`);
    await this.reconcile();
    return { ok: true };
  }

  status(controlPlane) {
    const bots = controlPlane.bots.filter((bot) => bot.channel?.type === 'wechat-clawbot')
      .map((bot) => this.states.get(bot.id) || status(bot, false, false, null));
    const first = bots[0] || { configured: false, enabled: false, running: false, lastError: null };
    return { ...first, bots };
  }

  async proactive(botId, userId, prompt, context = {}) {
    const runtime = this.runtimes.get(botId); if (!runtime) throw new Error('Bot 当前没有运行');
    return runtime.proactive(userId, prompt, context);
  }

  stop() { for (const id of [...this.runtimes.keys()]) this.#stop(id); }

  async #assertWechatBot(botId) {
    const bot = (await this.controlPlaneStore.get()).bots.find((item) => item.id === botId);
    if (!bot) throw Object.assign(new Error('找不到这个 Bot'), { statusCode: 404 });
    if (bot.channel?.type !== 'wechat-clawbot') throw Object.assign(new Error('这个 Bot 不是微信渠道'), { statusCode: 409 });
    return bot;
  }

  async #account(botId) {
    const raw = await this.secretStore.read(`wechat:${botId}`);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value?.token && value?.baseUrl ? value : null;
    } catch { return null; }
  }

  #stop(id) { this.runtimes.get(id)?.stop(); this.runtimes.delete(id); }
}

function status(bot, configured, running, lastError) {
  return { botId: bot.id, name: bot.name, channel: 'wechat-clawbot', configured, enabled: bot.enabled, running, lastError };
}

function qrStatus(value) {
  return ({ wait: 'waiting', scaned: 'scanned', scaned_but_redirect: 'scanned',
    need_verifycode: 'needs-verification', verify_code_blocked: 'verification-blocked',
    binded_redirect: 'already-bound' })[value] || value;
}
