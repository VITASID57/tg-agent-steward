export class TelegramService {
  constructor({ envToken, controlPlaneStore, secretStore, createRuntime, eventStore = null }) {
    this.envToken = envToken || '';
    this.controlPlaneStore = controlPlaneStore;
    this.secretStore = secretStore;
    this.createRuntime = createRuntime;
    this.eventStore = eventStore;
    this.runtimes = new Map();
    this.states = new Map();
  }

  async reconcile(controlPlane = null) {
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
      if (this.runtimes.has(bot.id)) { this.states.set(bot.id, status(bot, true, true, null)); continue; }
      const runtime = this.createRuntime(bot.id, token);
      try {
        await runtime.start(); this.runtimes.set(bot.id, runtime); this.states.set(bot.id, status(bot, true, true, null));
        await this.eventStore?.record(bot.id, { kind: 'channel', status: 'success', title: 'Telegram Bot 已启动', detail: '消息轮询已连接。' });
      } catch (error) {
        runtime.stop(); this.states.set(bot.id, status(bot, true, false, error.message));
        await this.eventStore?.record(bot.id, { kind: 'channel', status: 'error', title: 'Telegram Bot 启动失败', detail: error.message });
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

  #stop(id) { this.runtimes.get(id)?.stop(); this.runtimes.delete(id); }
}

function status(bot, configured, running, lastError) {
  return { botId: bot.id, name: bot.name, configured, enabled: bot.enabled, running, lastError };
}
