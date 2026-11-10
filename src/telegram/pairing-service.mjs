import { randomBytes, randomInt } from 'node:crypto';

const OWNER_KEY = 'owner:telegram';
const LINK_TTL = 10 * 60_000;

export class PairingService {
  constructor(controlPlaneStore, secretStore = null) {
    this.controlPlaneStore = controlPlaneStore;
    this.secretStore = secretStore;
    this.active = new Map();
    this.ownerLink = null;
    this.bindingOwner = false;
  }

  async ownerAccess(bot) {
    const ownerId = await this.secretStore.read(OWNER_KEY);
    return { hasOwner: Boolean(ownerId), allowed: Boolean(ownerId && bot.telegram.allowedChatIds.includes(ownerId)) };
  }

  async startOwnerAccess(bot, username) {
    if (!/^[A-Za-z0-9_]+$/u.test(username || '')) {
      throw Object.assign(new Error('请先保存并启用 Telegram Bot，等它连上 Telegram。'), { statusCode: 409 });
    }
    if (this.bindingOwner) throw Object.assign(new Error('正在完成上一次绑定，请稍后再试。'), { statusCode: 409 });
    const url = new URL(`https://t.me/${username}`);
    const ownerId = await this.secretStore.read(OWNER_KEY);
    if (ownerId) {
      await this.controlPlaneStore.grantTelegramChat(bot.id, ownerId);
      return { allowed: true, url: url.href };
    }
    if (this.bindingOwner) throw Object.assign(new Error('正在完成上一次绑定，请稍后再试。'), { statusCode: 409 });
    const code = `lko_${randomBytes(24).toString('base64url')}`;
    this.ownerLink = { code, botId: bot.id, username, expiresAt: Date.now() + LINK_TTL };
    url.searchParams.set('start', code);
    return { allowed: false, url: url.href, expiresAt: new Date(this.ownerLink.expiresAt).toISOString() };
  }

  async redeemOwnerLink(botId, code, chatId, username) {
    const link = this.ownerLink;
    if (this.bindingOwner || !link || link.code !== code || link.botId !== botId
      || link.username !== username || link.expiresAt <= Date.now() || !/^[1-9]\d*$/u.test(String(chatId))) return false;
    this.ownerLink = null;
    this.bindingOwner = true;
    try {
      const ownerId = await this.secretStore.read(OWNER_KEY);
      if (ownerId && ownerId !== String(chatId)) return false;
      if (!ownerId) await this.secretStore.write(OWNER_KEY, String(chatId));
      await this.controlPlaneStore.grantTelegramChat(botId, String(chatId));
      return true;
    } catch (error) {
      if (link.expiresAt > Date.now()) this.ownerLink = link;
      throw error;
    } finally { this.bindingOwner = false; }
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
