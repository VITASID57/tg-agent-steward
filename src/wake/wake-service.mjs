export class WakeService {
  constructor({ controlPlaneStore, stateFile, send, eventStore = null, now = () => new Date(), random = Math.random, logger = console }) {
    Object.assign(this, { controlPlaneStore, stateFile, send, eventStore, now, random, logger });
    this.timer = null; this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => this.logger.error(`Wake: ${error.message}`)), 60_000);
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (this.running) return; this.running = true;
    try {
      const control = await this.controlPlaneStore.get(); const wakeState = await this.stateFile.read();
      for (const bot of control.bots) await this.#tickBot(bot, wakeState);
      await this.stateFile.write(wakeState);
    } finally { this.running = false; }
  }

  async status(botId) {
    const [control, state] = await Promise.all([this.controlPlaneStore.get(), this.stateFile.read()]);
    const bot = control.bots.find((item) => item.id === botId);
    if (!bot) throw Object.assign(new Error('找不到这个 Bot'), { statusCode: 404 });
    const config = bot.wake || {}; const runtime = state.bots?.[botId] || {};
    const nextAttemptAt = config.scheduleMode === 'random' ? runtime.nextAttemptAt || null : fixedNextAttempt(config, runtime);
    return {
      enabled: bot.enabled && config.enabled === true,
      configured: Boolean(config.targetChatId && isAllowed(bot, config.targetChatId)),
      mode: config.scheduleMode === 'random' ? 'random' : 'fixed',
      intervalMinutes: config.intervalMinutes, randomMinMinutes: config.randomMinMinutes,
      randomMaxMinutes: config.randomMaxMinutes, quietStart: config.quietStart, quietEnd: config.quietEnd,
      dailyLimit: config.dailyLimit, todayCount: runtime.date === localDate(this.now()) ? runtime.count || 0 : 0,
      nextAttemptAt, lastAttemptAt: runtime.lastAttemptAt || null,
      lastSentAt: runtime.lastSentAt || null, lastResult: runtime.lastResult || null,
      lastError: runtime.lastError || null,
    };
  }

  async #tickBot(bot, state) {
    const config = bot.wake; const targetId = config?.targetChatId;
    if (!bot.enabled || !config?.enabled || !targetId || !isAllowed(bot, targetId)) return;
    const now = this.now(); const today = localDate(now); const previous = state.bots?.[bot.id] || {};
    const current = previous.date === today ? previous : {
      date: today, count: 0, lastAttemptAt: previous.lastAttemptAt, lastSentAt: previous.lastSentAt,
      nextAttemptAt: null, scheduleKey: null,
    };
    state.bots = { ...(state.bots || {}), [bot.id]: current };
    const randomMode = config.scheduleMode === 'random';
    if (randomMode && !this.#randomDue(config, current, now)) return;
    if (inQuietHours(now, config.quietStart, config.quietEnd)) {
      if (randomMode) this.#scheduleNext(config, current, now);
      return;
    }
    if (current.count >= config.dailyLimit) return;
    if (!randomMode && !elapsed(current.lastAttemptAt, config.intervalMinutes, now)) return;
    if (!elapsed(current.lastSentAt, config.cooldownMinutes, now)) return;
    current.lastAttemptAt = now.toISOString();
    if (randomMode) this.#scheduleNext(config, current, now);
    try {
      const result = await this.send(bot.id, String(targetId), config.prompt, {
        wakeRunId: `${bot.id}:${current.lastAttemptAt}`, channel: bot.channel?.type || 'telegram',
      });
      current.lastResult = result?.sent === false ? 'silent' : 'sent'; delete current.lastError;
      if (result?.sent !== false) { current.count += 1; current.lastSentAt = now.toISOString(); }
      await this.eventStore?.record(bot.id, result?.sent === false
        ? { kind: 'wake', status: 'info', title: '自动唤醒保持安静', detail: '模型判断这次没有需要主动发送的内容。', at: current.lastAttemptAt }
        : { kind: 'wake', status: 'success', title: '自动唤醒已发送', detail: `今日第 ${current.count} 次主动消息。`, at: current.lastAttemptAt });
    } catch (error) {
      current.lastResult = 'failed'; current.lastError = String(error.message || error).slice(0, 500);
      await this.eventStore?.record(bot.id, { kind: 'wake', status: 'error', title: '自动唤醒失败', detail: current.lastError, at: current.lastAttemptAt });
    }
  }

  #randomDue(config, state, now) {
    const key = scheduleKey(config);
    if (state.scheduleKey !== key || !validFutureOrPast(state.nextAttemptAt)) {
      state.scheduleKey = key; this.#scheduleNext(config, state, now); return false;
    }
    return now.getTime() >= Date.parse(state.nextAttemptAt);
  }

  #scheduleNext(config, state, now) {
    const [min, max] = randomBounds(config);
    const minutes = min + Math.floor(this.random() * (max - min + 1));
    state.scheduleKey = scheduleKey(config);
    state.nextAttemptAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  }
}

export function inQuietHours(now, start = '23:00', end = '08:00') {
  const minutes = now.getHours() * 60 + now.getMinutes(); const from = clock(start); const to = clock(end);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export function randomBounds(config = {}) {
  const left = clampMinutes(config.randomMinMinutes, 45); const right = clampMinutes(config.randomMaxMinutes, 120);
  return left <= right ? [left, right] : [right, left];
}

function isAllowed(bot, targetId) {
  const ids = bot.channel?.type === 'wechat-clawbot' ? bot.wechat?.allowedUserIds : bot.telegram?.allowedChatIds;
  return (ids || []).includes(String(targetId));
}
function scheduleKey(config) { const [min, max] = randomBounds(config); return `random:${min}:${max}`; }
function validFutureOrPast(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function elapsed(value, minutes, now) { return !value || now.getTime() - Date.parse(value) >= Number(minutes) * 60_000; }
function fixedNextAttempt(config, state) {
  if (config.scheduleMode === 'random' || !state.lastAttemptAt) return null;
  const candidates = [Date.parse(state.lastAttemptAt) + Number(config.intervalMinutes || 0) * 60_000];
  if (state.lastSentAt) candidates.push(Date.parse(state.lastSentAt) + Number(config.cooldownMinutes || 0) * 60_000);
  const value = Math.max(...candidates.filter(Number.isFinite));
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}
function clampMinutes(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(10_080, Math.max(5, Math.round(parsed))) : fallback; }
function clock(value) { const [hour, minute] = String(value).split(':').map(Number); return hour * 60 + minute; }
function localDate(date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
