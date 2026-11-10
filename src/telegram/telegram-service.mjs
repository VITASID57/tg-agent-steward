export class TelegramService {
  constructor({ envToken, controlPlaneStore, secretStore, createRuntime, checkToken = null, eventStore = null }) {
    this.envToken = envToken || '';
    this.controlPlaneStore = controlPlaneStore;
    this.secretStore = secretStore;
    this.createRuntime = createRuntime;
    this.checkToken = checkToken;
    this.eventStore = eventStore;
    this.runtimes = new Map();
    this.states = new Map();
    this.tokens = new Map();
    this.queue = Promise.resolve();
  }

  reconcile(controlPlane = null) {
    const run = this.queue.then(() => this.#reconcile(controlPlane));
    this.queue = run.catch(() => {});
    return run;
  }

  async validateToken(value) {
    const token = String(value ?? '').trim();
    if (!token) return '';
    if (!/^\d+:[A-Za-z0-9_-]+$/u.test(token)) throw Object.assign(new Error('请粘贴 BotFather 提供的完整 Bot Token。'), { statusCode: 400 });
    try { await this.checkToken?.(token); }
    catch (error) {
      if ([401, 404].includes(error.telegramStatus)) {
        throw Object.assign(new Error('Telegram 没有接受这个 Token，请从 BotFather 重新复制。'), { statusCode: 400 });
      }
      throw Object.assign(new Error('暂时无法向 Telegram 核对 Token，请稍后再试。'), { statusCode: 502 });
    }
    return token;
  }

  async #reconcile(controlPlane) {
    const state = controlPlane ?? await this.controlPlaneStore.get();
    const wanted = new Set();
    for (const bot of state.bots) {
      if ((bot.channel?.type ?? 'telegram') !== 'telegram') {
        this.#stop(bot.id); this.states.delete(bot.id); continue;
      }
      const stored = await this.secretStore.read(`telegram:${bot.id}`);
      const token = stored || (bot.id === 'bot-default' ? this.envToken : '');
      const shouldRun = Boolean(bot.enabled && token);
      if (!shouldRun) { this.#stop(bot.id); this.states.set(bot.id, status(bot, Boolean(token), false, null)); continue; }
      wanted.add(bot.id);
      if (this.runtimes.has(bot.id) && this.tokens.get(bot.id) === token) {
        this.states.set(bot.id, status(bot, true, true, null, this.runtimes.get(bot.id).me?.username)); continue;
      }
      this.#stop(bot.id);
      const runtime = this.createRuntime(bot.id, token);
      try {
        await runtime.start();
        this.runtimes.set(bot.id, runtime); this.tokens.set(bot.id, token);
        this.states.set(bot.id, status(bot, true, true, null, runtime.me?.username));
        await this.eventStore?.record(bot.id, { kind: 'channel', status: 'success', title: 'Telegram Bot 已启动', detail: '消息轮询已连接。' });
      } catch (error) {
        const detail = String(error.message).replaceAll(token, '[已隐藏]');
        runtime.stop(); this.states.set(bot.id, status(bot, true, false, detail));
        await this.eventStore?.record(bot.id, { kind: 'channel', status: 'error', title: 'Telegram Bot 启动失败', detail });
      }
    }
    for (const id of this.runtimes.keys()) if (!wanted.has(id)) this.#stop(id);
    return this.status(state);
  }

  stop() {
    for (const id of [...this.runtimes.keys()]) this.#stop(id);
  }

  status(controlPlane) {
    const bots = controlPlane.bots.filter((bot) => (bot.channel?.type ?? 'telegram') === 'telegram')
      .map((bot) => this.states.get(bot.id) ?? status(bot, false, false, null));
    const first = bots[0] ?? { configured: false, enabled: false, running: false, lastError: null };
    return { ...first, bots };
  }

  async proactive(botId, chatId, prompt, context = {}) {
    const runtime = this.runtimes.get(botId); if (!runtime) throw new Error('Bot 当前没有运行');
    return runtime.proactive(chatId, prompt, context);
  }

  #stop(id) { this.runtimes.get(id)?.stop(); this.runtimes.delete(id); this.tokens.delete(id); }
}

function status(bot, configured, running, lastError, username = null) {
  return { botId: bot.id, name: bot.name, configured, enabled: bot.enabled, running, lastError, username };
}
