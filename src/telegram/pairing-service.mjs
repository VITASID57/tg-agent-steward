import { randomInt } from 'node:crypto';

export class PairingService {
  constructor(controlPlaneStore) {
    this.controlPlaneStore = controlPlaneStore;
    this.active = new Map();
  }

  create(botId = 'bot-default', ttlMs = 10 * 60_000) {
    const value = { code: String(randomInt(100000, 1000000)), expiresAt: Date.now() + ttlMs };
    this.active.set(botId, value);
    return { code: value.code, expiresAt: new Date(value.expiresAt).toISOString() };
  }

  async redeem(botId, code, chatId, channel = 'telegram') {
    const active = this.active.get(botId);
    if (!active || Date.now() > active.expiresAt || code !== active.code) return false;
    const state = await this.controlPlaneStore.get();
    const bot = state.bots.find((item) => item.id === botId);
    if (!bot) return false;
    if (channel === 'wechat-clawbot') {
      await this.controlPlaneStore.upsertBot({ ...bot, wechat: { ...bot.wechat,
        allowedUserIds: [...new Set([...(bot.wechat?.allowedUserIds || []), String(chatId)])] } });
    } else {
      await this.controlPlaneStore.upsertBot({ ...bot, telegram: { ...bot.telegram,
        allowedChatIds: [...new Set([...bot.telegram.allowedChatIds, String(chatId)])] } });
    }
    this.active.delete(botId);
    return true;
  }
}
