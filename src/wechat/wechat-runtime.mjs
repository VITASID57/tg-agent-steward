import { shouldSendVoice } from '../voice/probability.mjs';

const USER_MESSAGE = 1;
const TEXT_ITEM = 1;
const VOICE_ITEM = 3;

export class WechatRuntime {
  constructor({ botId, client, controlPlaneStore, manager, stateFile, pairing, voiceService, imageService,
    stickerService, eventStore = null, onStatus = null, random = Math.random, logger = console }) {
    Object.assign(this, { botId, client, controlPlaneStore, manager, stateFile, pairing, voiceService,
      imageService, stickerService, eventStore, onStatus, random, logger });
    this.controller = null;
  }

  async start() {
    if (this.controller) return;
    this.controller = new AbortController();
    await this.client.notifyStart?.();
    this.onStatus?.({ running: true, lastError: null });
    this.#poll(this.controller.signal).catch((error) => {
      if (!this.controller?.signal.aborted) this.logger.error(`WeChat ${this.botId}: ${safeError(error)}`);
    });
  }

  stop() {
    this.controller?.abort(); this.controller = null;
    this.client.notifyStop?.().catch(() => {});
  }

  async #poll(signal) {
    let failures = 0;
    while (!signal.aborted) {
      try {
        const saved = await this.#savedState();
        const response = await this.client.getUpdates(saved.syncBuffer || '', signal);
        for (const message of response.msgs || []) await this.#message(message, signal);
        if (response.get_updates_buf !== undefined) await this.#save({ syncBuffer: response.get_updates_buf });
        failures = 0;
      } catch (error) {
        if (signal.aborted || error.name === 'AbortError' || error.name === 'TimeoutError') continue;
        if (Number(error.code) === -14) {
          const detail = '微信登录已过期，请重新扫码连接。';
          this.logger.error(`WeChat polling ${this.botId}: ${detail}`);
          await this.#save({ syncBuffer: '' });
          this.onStatus?.({ running: false, lastError: detail });
          await this.eventStore?.record(this.botId, { kind: 'channel', status: 'error', title: '微信登录已过期', detail });
          break;
        }
        failures += 1; this.logger.error(`WeChat polling ${this.botId}: ${safeError(error)}`);
        await this.eventStore?.record(this.botId, { kind: 'channel', status: 'error', title: '微信轮询异常', detail: safeError(error) });
        await delay(failures >= 3 ? 10_000 : 1_500, signal);
      }
    }
  }

  async #message(message, signal) {
    if (message?.message_type !== USER_MESSAGE) return;
    const senderId = String(message.from_user_id || '');
    const contextToken = String(message.context_token || '');
    if (!senderId || !contextToken) return;
    const state = await this.controlPlaneStore.get();
    const bot = state.bots.find((item) => item.id === this.botId);
    if (!bot?.enabled || bot.channel?.type !== 'wechat-clawbot') return;
    const incoming = extractIncoming(message, bot.wechat);
    if (!incoming.text) {
      if (incoming.voice) await this.client.sendText(senderId, contextToken,
        bot.wechat?.usePlatformTranscription === false ? '这个 Bot 暂停了微信语音转写。' : '收到语音了，但微信这次没有附带可用的转写文字。', signal);
      return;
    }
    const messageId = String(message.msg_id || message.client_id || `${senderId}:${message.create_time || ''}:${incoming.text}`);
    const saved = await this.#savedState();
    if ((saved.recentMessageIds || []).includes(messageId)) return;
    try {
      if (await this.#pairing(senderId, contextToken, incoming.text, signal)) return;
      if (!(bot.wechat?.allowedUserIds || []).includes(senderId)) {
        await this.client.sendText(senderId, contextToken, '这个账号还没有获得访问权限。请先使用主人给的一次性配对码。', signal);
        return;
      }
      if (await this.#draw(bot, senderId, contextToken, incoming.text, signal)) return;
      await this.#reply(bot, senderId, contextToken, incoming.text, { transcribed: incoming.voice }, signal);
    } catch (error) {
      this.logger.error(`WeChat reply ${this.botId}: ${safeError(error)}`);
      await this.eventStore?.record(this.botId, { kind: 'reply', status: 'error', title: '消息回复失败', detail: safeError(error) });
      await this.client.sendText(senderId, contextToken, `这次回复失败了：${safeError(error)}`, signal).catch(() => {});
    } finally {
      await this.#save({
        recentMessageIds: [messageId, ...(saved.recentMessageIds || []).filter((id) => id !== messageId)].slice(0, 100),
        lastContact: { senderId, contextToken, at: new Date().toISOString() },
        contacts: { ...(saved.contacts || {}), [senderId]: { contextToken, at: new Date().toISOString() } },
      });
    }
  }

  async #pairing(senderId, contextToken, text, signal) {
    const match = text.match(/^\/pair\s+(\d{6})$/u);
    if (!match) return false;
    const ok = await this.pairing?.redeem(this.botId, match[1], senderId, 'wechat-clawbot');
    await this.client.sendText(senderId, contextToken, ok ? '配对成功，现在可以聊天了。' : '配对码无效或已经过期。', signal);
    return true;
  }

  async #draw(bot, senderId, contextToken, text, signal) {
    const match = text.match(/^\/draw(?:\s+|$)([\s\S]*)/u);
    if (!match) return false;
    if (!bot.image?.enabled || !bot.image.imageProfileId) {
      await this.client.sendText(senderId, contextToken, '这个 Bot 还没有启用生图路线。', signal); return true;
    }
    if (!match[1].trim()) {
      await this.client.sendText(senderId, contextToken, '请在 /draw 后面写想画的内容。', signal); return true;
    }
    const ticket = await this.#startTyping(bot, senderId, contextToken, signal);
    try {
      const result = await this.imageService.generate(bot.image.imageProfileId, match[1].trim(), signal);
      await this.client.sendImage(senderId, contextToken, result.image, signal);
    } finally { await this.client.stopTyping(senderId, ticket, signal).catch(() => {}); }
    return true;
  }

  async #reply(bot, senderId, contextToken, text, context, signal) {
    const ticket = await this.#startTyping(bot, senderId, contextToken, signal);
    try {
      const voiceGuide = bot.voice?.enabled && bot.voice.voiceProfileId && this.voiceService?.instruction
        ? await this.voiceService.instruction(bot.voice.voiceProfileId).catch(() => '') : '';
      const result = await this.manager.reply(senderId, text, {
        surface: 'wechat', botId: this.botId, group: false, voiceGuide, ...context,
      });
      if (context.wake && result.text.trim() === '[[SILENT]]') return { sent: false, reason: 'silent' };
      let voice = null;
      if (bot.voice?.voiceProfileId && shouldSendVoice(bot.voice, this.random)) {
        voice = await this.voiceService.synthesize(bot.voice.voiceProfileId, result.speechText || result.text, signal)
          .catch((error) => { this.logger.error(`WeChat voice ${this.botId}: ${safeError(error)}`); return null; });
      }
      if (!voice || bot.voice.sendTextWithVoice) {
        for (const part of splitWechatMessage(result.text, bot.wechat)) {
          await this.client.sendText(senderId, contextToken, part, signal);
          if (bot.wechat?.splitParagraphs) await delay(280, signal);
        }
      }
      if (voice) await this.client.sendFile(senderId, contextToken, voice.audio, `reply.${voice.extension}`, signal);
      let stickerSent = false;
      if (result.sticker && this.stickerService) {
        const asset = await this.stickerService.readAsset(result.sticker.assetId);
        await this.client.sendImage(senderId, contextToken, asset.data, signal);
        stickerSent = true;
      }
      if (!context.wake) await this.eventStore?.record(this.botId, { kind: 'reply', status: 'success', title: '消息回复已发送',
        detail: [voice ? '语音' : '', stickerSent ? '表情' : '', (!voice || bot.voice.sendTextWithVoice) ? '文字' : ''].filter(Boolean).join(' + ') || '回复已完成' });
      return { sent: true, voice: Boolean(voice), sticker: stickerSent };
    } finally { await this.client.stopTyping(senderId, ticket, signal).catch(() => {}); }
  }

  async proactive(userId, prompt, context = {}) {
    const target = String(userId); const saved = await this.#savedState();
    const contact = saved.contacts?.[target] || (saved.lastContact?.senderId === target ? saved.lastContact : null);
    if (!contact?.contextToken) throw new Error('微信主动唤醒需要对方先发来一条新消息');
    const state = await this.controlPlaneStore.get(); const bot = state.bots.find((item) => item.id === this.botId);
    if (!bot?.enabled || !(bot.wechat?.allowedUserIds || []).includes(target)) throw new Error('微信唤醒目标没有访问权限');
    return this.#reply(bot, target, contact.contextToken, prompt, { wake: true, ...context }, this.controller?.signal);
  }

  #startTyping(bot, senderId, contextToken, signal) {
    return bot.wechat?.typingIndicator === false ? Promise.resolve(null)
      : this.client.startTyping(senderId, contextToken, signal).catch(() => null);
  }

  async #savedState() { const state = await this.stateFile.read(); return state.bots?.[this.botId] || {}; }
  async #save(patch) {
    await this.stateFile.update((state = { bots: {} }) => ({
      ...state, bots: { ...(state.bots || {}), [this.botId]: { ...(state.bots?.[this.botId] || {}), ...patch } },
    }));
  }
}

export function extractWechatText(message, settings = {}) { return extractIncoming(message, settings).text; }
export function splitWechatMessage(value, settings = {}) {
  const clean = String(value || '').trim();
  if (!clean) return [];
  const paragraphs = settings.splitParagraphs === false ? [clean]
    : clean.split(/(?:\n\s*\n|\s*\[SPLIT\]\s*)+/u).map((item) => item.trim()).filter(Boolean);
  return settings.longMessageSplit === false ? paragraphs : paragraphs.flatMap(splitLong);
}

function extractIncoming(message, settings = {}) {
  const items = message.item_list || [];
  const plain = String(items.find((item) => item.type === TEXT_ITEM)?.text_item?.text || '').trim();
  const voiceItem = items.find((item) => item.type === VOICE_ITEM)?.voice_item;
  const transcript = settings.usePlatformTranscription === false ? '' : String(voiceItem?.text || '').trim();
  return { text: plain || transcript, voice: Boolean(voiceItem) };
}

function splitLong(clean) {
  const result = []; let remaining = clean;
  while (remaining.length > 1800) {
    let at = remaining.lastIndexOf('\n', 1800);
    if (at < 900) at = remaining.lastIndexOf('。', 1800) + 1;
    if (at < 900) at = 1800;
    result.push(remaining.slice(0, at).trim()); remaining = remaining.slice(at).trim();
  }
  if (remaining) result.push(remaining); return result;
}

function safeError(error) {
  return String(error?.message || error).replace(/(?:Bearer\s+|bot[_-]?token[=:\s]+)[A-Za-z0-9._-]+/giu, '[已隐藏]');
}
function delay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
