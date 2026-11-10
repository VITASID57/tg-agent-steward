import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeBot, normalizeConnection, normalizeControlPlane, normalizeImageProfile, normalizeProfile, normalizeProfileBlock, normalizeStickerPack, normalizeVoiceProfile } from './validate.mjs';

export class ControlPlaneStore {
  constructor(file, legacyStore = null) {
    this.file = file;
    this.legacyStore = legacyStore;
  }

  async get() {
    const legacy = await this.legacyStore?.get().catch(() => ({})) ?? {};
    const raw = await this.file.read();
    if (raw?.schemaVersion === 2) return normalizeControlPlane(raw, legacy);
    return this.file.update((current) => normalizeControlPlane(current, legacy));
  }

  async upsertConnection(input, writeCredential = null) {
    return this.#upsert('connections', 'connection', input, async (value, previous) => {
      const options = { ...value.options };
      if (previous?.kind === value.kind && previous.options.env && !Object.hasOwn(options, 'env')) options.env = previous.options.env;
      const next = normalizeConnection({ ...value, options, lastTest: null });
      if (!next) return null;
      const credentialChanged = await writeCredential?.(next.id);
      if (!credentialChanged && sameConnectionSettings(previous, next)) next.lastTest = previous.lastTest;
      if (previous && Date.parse(next.updatedAt) <= Date.parse(previous.updatedAt)) {
        next.updatedAt = new Date(Date.parse(previous.updatedAt) + 1).toISOString();
      }
      return next;
    });
  }

  async recordConnectionTest(checked, result) {
    await this.file.update((raw) => {
      const state = normalizeControlPlane(raw);
      const current = state.connections.find((item) => item.id === checked.id);
      if (!current) throw Object.assign(new Error('找不到这个连接预设'), { statusCode: 404 });
      if (current.updatedAt !== checked.updatedAt || current.createdAt !== checked.createdAt || !sameConnectionSettings(current, checked)) {
        throw Object.assign(new Error('自检期间连接预设已更新，请重新自检'), { statusCode: 409 });
      }
      current.lastTest = normalizeConnection({ ...current, lastTest: result }).lastTest;
      return state;
    });
  }

  async upsertProfile(input) {
    return this.#upsert('profiles', 'profile', input, (value, previous) =>
      normalizeProfile({ ...value, revision: (previous?.revision ?? 0) + 1 }));
  }

  async upsertVoiceProfile(input) {
    return this.#upsert('voiceProfiles', 'voice', input, normalizeVoiceProfile);
  }

  async upsertImageProfile(input) {
    return this.#upsert('imageProfiles', 'image', input, normalizeImageProfile);
  }

  async upsertStickerPack(input) {
    return this.#upsert('stickerPacks', 'stickers', input, normalizeStickerPack);
  }

  async addProfileBlockTemplate(input) {
    const template = normalizeProfileBlock({ ...input, id: `template-${randomUUID()}` });
    if (typeof input?.title !== 'string' || !input.title.trim() || !template.body.trim()) {
      throw Object.assign(new Error('请先填写模块标题和正文'), { statusCode: 400 });
    }
    return this.#upsert('profileBlockTemplates', 'template', template, (value) => normalizeProfileBlock(value));
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
      if (!state.profiles.some((item) => item.id === next.profileId)
        || (next.chat.connectionId && !state.connections.some((item) => item.id === next.chat.connectionId))) {
        throw Object.assign(new Error('人物或聊天连接已不存在，请重新选择'), { statusCode: 409 });
      }
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
    return this.#remove('connections', id, '连接', (state) => [
      ...state.bots.filter((bot) => [bot.chat.connectionId, ...bot.chat.fallbackConnectionIds,
        bot.voice.transcriptionConnectionId, bot.memoryConnectionId, ...bot.tools.connectionIds].includes(id)),
      ...[...state.voiceProfiles, ...state.imageProfiles].filter((profile) =>
        [profile.primary, ...profile.fallbacks].some((route) => route?.connectionId === id)),
    ]);
  }

  async removeProfile(id) {
    return this.#remove('profiles', id, '人物', (state) => state.bots.filter((bot) => bot.profileId === id));
  }

  async removeVoiceProfile(id) {
    return this.#remove('voiceProfiles', id, '声音预设', (state) => state.bots.filter((bot) => bot.voice.voiceProfileId === id));
  }

  async removeImageProfile(id) {
    return this.#remove('imageProfiles', id, '生图路线', (state) => state.bots.filter((bot) => bot.image.imageProfileId === id));
  }

  async removeBot(id) {
    await this.file.update((raw) => {
      const state = normalizeControlPlane(raw);
      if (state.bots.length <= 1) throw Object.assign(new Error('至少要保留一个 Bot'), { statusCode: 409 });
      return { ...state, bots: state.bots.filter((item) => item.id !== id) };
    });
  }

  async removeStickerPack(id) {
    return this.#remove('stickerPacks', id, '表情包', (state) => state.bots.filter((bot) => bot.stickers.packIds.includes(id)));
  }

  async removeProfileBlockTemplate(id) {
    return this.#remove('profileBlockTemplates', id);
  }

  async #upsert(key, prefix, input, normalize) {
    const legacy = await this.legacyStore?.get().catch(() => ({})) ?? {};
    const now = new Date().toISOString();
    let saved;
    await this.file.update(async (raw) => {
      const state = normalizeControlPlane(raw, legacy);
      const previous = state[key].find((item) => item.id === input.id);
      saved = await normalize({ ...input, id: input.id || `${prefix}-${randomUUID()}`,
        createdAt: previous?.createdAt || now, updatedAt: now }, previous);
      if (!saved) throw Object.assign(new Error('无法保存这个预设'), { statusCode: 400 });
      return normalizeControlPlane({ ...state, [key]: replace(state[key], saved) });
    });
    return saved;
  }

  async #remove(key, id, label = '', references = () => []) {
    const legacy = await this.legacyStore?.get().catch(() => ({})) ?? {};
    await this.file.update((raw) => {
      const state = normalizeControlPlane(raw, legacy);
      const users = references(state);
      if (users.length) {
        const names = [...new Set(users.map((item) => item.name))].join('、');
        const target = key === 'connections' ? '被引用' : '被 Bot 引用';
        throw Object.assign(new Error(`${label}仍${target}（${names}）。请先更换或取消对应设置，再删除。`), { statusCode: 409 });
      }
      return { ...state, [key]: state[key].filter((item) => item.id !== id) };
    });
  }
}

function sameConnectionSettings(left, right) {
  return left?.kind === right.kind && left.baseUrl === right.baseUrl
    && isDeepStrictEqual(probeOptions(left), probeOptions(right));
}

function probeOptions(connection) {
  const defaults = {
    runtimeMode: 'chat', apiStyle: 'chat-completions', authType: connection.kind === 'vertex-ai' ? 'api-key' : 'bearer',
    sandbox: 'read-only', approvalPolicy: 'never', idleHours: 6, writeEnabled: false, accessMode: 'approval',
  };
  return Object.fromEntries(Object.entries(connection.options || {}).filter(([key, value]) =>
    value !== '' && value != null && value !== defaults[key] && !(Array.isArray(value) && !value.length)));
}

function replace(items, value) {
  return items.some((item) => item.id === value.id)
    ? items.map((item) => item.id === value.id ? value : item)
    : [...items, value];
}
