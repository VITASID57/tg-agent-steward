import { randomUUID } from 'node:crypto';
import { normalizeBot, normalizeConnection, normalizeControlPlane, normalizeImageProfile, normalizeProfile, normalizeStickerPack, normalizeVoiceProfile } from './validate.mjs';

export class ControlPlaneStore {
  constructor(file, legacyStore = null) {
    this.file = file;
    this.legacyStore = legacyStore;
  }

  async get() {
    const legacy = await this.legacyStore?.get().catch(() => ({})) ?? {};
    const raw = await this.file.read();
    const state = normalizeControlPlane(raw, legacy);
    if (raw?.schemaVersion !== 2) await this.file.write(state);
    return state;
  }

  async upsertConnection(input) {
    const state = await this.get(); const now = new Date().toISOString();
    const previous = state.connections.find((item) => item.id === input.id);
    const id = input.id || `connection-${randomUUID()}`;
    const next = normalizeConnection({ ...input, id, createdAt: previous?.createdAt || now, updatedAt: now });
    return this.#write({ ...state, connections: replace(state.connections, next) }, next);
  }

  async upsertProfile(input) {
    const state = await this.get(); const now = new Date().toISOString();
    const previous = state.profiles.find((item) => item.id === input.id);
    const next = normalizeProfile({ ...input, id: input.id || `profile-${randomUUID()}`,
      createdAt: previous?.createdAt || now, updatedAt: now, revision: (previous?.revision ?? 0) + 1 });
    return this.#write({ ...state, profiles: replace(state.profiles, next) }, next);
  }

  async upsertVoiceProfile(input) {
    const state = await this.get(); const now = new Date().toISOString();
    const previous = state.voiceProfiles.find((item) => item.id === input.id);
    const next = normalizeVoiceProfile({ ...input, id: input.id || `voice-${randomUUID()}`,
      createdAt: previous?.createdAt || now, updatedAt: now });
    return this.#write({ ...state, voiceProfiles: replace(state.voiceProfiles, next) }, next);
  }

  async upsertImageProfile(input) {
    const state = await this.get(); const now = new Date().toISOString();
    const previous = state.imageProfiles.find((item) => item.id === input.id);
    const next = normalizeImageProfile({ ...input, id: input.id || `image-${randomUUID()}`,
      createdAt: previous?.createdAt || now, updatedAt: now });
    return this.#write({ ...state, imageProfiles: replace(state.imageProfiles, next) }, next);
  }

  async upsertStickerPack(input) {
    const state = await this.get(); const now = new Date().toISOString();
    const previous = state.stickerPacks.find((item) => item.id === input.id);
    const next = normalizeStickerPack({ ...input, id: input.id || `stickers-${randomUUID()}`,
      createdAt: previous?.createdAt || now, updatedAt: now });
    return this.#write({ ...state, stickerPacks: replace(state.stickerPacks, next) }, next);
  }

  async upsertBot(input) {
    const legacy = await this.legacyStore?.get().catch(() => ({})) ?? {};
    const now = new Date().toISOString();
    let next;
    await this.file.update((raw) => {
      const state = normalizeControlPlane(raw, legacy);
      const previous = state.bots.find((item) => item.id === input.id);
      next = normalizeBot({ ...input, avatar: input.avatar ?? previous?.avatar, id: input.id || `bot-${randomUUID()}`,
        createdAt: previous?.createdAt || now, updatedAt: now });
      return normalizeControlPlane({ ...state, bots: replace(state.bots, next) });
    });
    return next;
  }

  async grantTelegramChat(botId, chatId) {
    await this.file.update((raw) => {
      const state = normalizeControlPlane(raw);
      const bot = state.bots.find((item) => item.id === botId);
      if (!bot || !bot.enabled || bot.channel.type !== 'telegram') {
        throw Object.assign(new Error('请先启用这张 Telegram Bot 卡。'), { statusCode: 409 });
      }
      if (!bot.telegram.allowedChatIds.includes(chatId)) {
        if (bot.telegram.allowedChatIds.length >= 500) throw Object.assign(new Error('这张 Bot 卡的授权名单已满。'), { statusCode: 409 });
        bot.telegram.allowedChatIds.push(chatId);
      }
      return state;
    });
  }

  async removeConnection(id) {
    const state = await this.get();
    const references = state.bots.filter((bot) => [bot.chat.connectionId, ...bot.chat.fallbackConnectionIds,
      bot.voice.transcriptionConnectionId, bot.memoryConnectionId, ...bot.tools.connectionIds].includes(id))
      .map((bot) => bot.name);
    const voiceReferences = state.voiceProfiles.filter((profile) => [profile.primary, ...profile.fallbacks]
      .some((route) => route?.connectionId === id)).map((profile) => profile.name);
    const imageReferences = state.imageProfiles.filter((profile) => [profile.primary, ...profile.fallbacks]
      .some((route) => route?.connectionId === id)).map((profile) => profile.name);
    if (references.length || voiceReferences.length || imageReferences.length) throw Object.assign(new Error(`连接仍被引用：${[...references, ...voiceReferences, ...imageReferences].join('、')}`), { statusCode: 409 });
    await this.#write({ ...state, connections: state.connections.filter((item) => item.id !== id) });
  }

  async removeBot(id) {
    await this.file.update((raw) => {
      const state = normalizeControlPlane(raw);
      if (state.bots.length <= 1) throw Object.assign(new Error('至少要保留一个 Bot'), { statusCode: 409 });
      return { ...state, bots: state.bots.filter((item) => item.id !== id) };
    });
  }

  async removeStickerPack(id) {
    const state = await this.get(); const users = state.bots.filter((bot) => bot.stickers.packIds.includes(id)).map((bot) => bot.name);
    if (users.length) throw Object.assign(new Error(`表情包仍被 Bot 引用：${users.join('、')}`), { statusCode: 409 });
    await this.#write({ ...state, stickerPacks: state.stickerPacks.filter((item) => item.id !== id) });
  }

  async #upsert(key, value) {
    const state = await this.get();
    return this.#write({ ...state, [key]: replace(state[key], value) }, value);
  }

  async #write(state, result) {
    const normalized = normalizeControlPlane(state);
    await this.file.write(normalized);
    return result ?? normalized;
  }
}

function replace(items, value) {
  return items.some((item) => item.id === value.id)
    ? items.map((item) => item.id === value.id ? value : item)
    : [...items, value];
}
