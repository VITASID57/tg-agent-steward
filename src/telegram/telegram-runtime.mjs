import { MessageBatcher } from './batcher.mjs';
import { handleCommand } from './commands.mjs';
import { splitTelegramMessage } from './message-format.mjs';
import { deliverReplyAudio } from '../voice/reply-audio.mjs';
import { imageRequestPrompt, isExplicitVoiceRequest, voiceRequestText } from '../media/request-intent.mjs';

export class TelegramRuntime {
  constructor({ botId, client, controlPlaneStore, manager, pairing, engines, voiceService, transcriptionService, imageService, stickerService, toolBroker, eventStore = null, random = Math.random, logger = console }) {
    this.botId = botId;
    this.client = client;
    this.controlPlaneStore = controlPlaneStore;
    this.manager = manager;
    this.pairing = pairing;
    this.engines = engines;
    this.voiceService = voiceService;
    this.transcriptionService = transcriptionService;
    this.imageService = imageService;
    this.stickerService = stickerService;
    this.toolBroker = toolBroker;
    this.eventStore = eventStore;
    this.random = random;
    this.logger = logger;
    this.offset = 0;
    this.controller = null;
    this.me = null;
    this.batcher = new MessageBatcher((chatId, text, context) => this.#reply(chatId, text, context));
  }

  async start() {
    if (this.controller) return;
    this.controller = new AbortController();
    try {
      this.me = await this.client.getMe(AbortSignal.any([this.controller.signal, AbortSignal.timeout(8_000)]));
      this.#poll(this.controller.signal);
    } catch (error) {
      this.controller.abort();
      this.controller = null;
      throw error;
    }
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
  }

  async #poll(signal) {
    while (!signal.aborted) {
      try {
        const updates = await this.client.getUpdates(this.offset, signal);
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.#message(update.message);
        }
      } catch (error) {
        if (!signal.aborted) {
          this.logger.error(`Telegram polling: ${error.message}`);
          await this.eventStore?.record(this.botId, { kind: 'channel', status: 'error', title: 'Telegram 轮询异常', detail: safeError(error) });
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }
  }

  async #message(message) {
    if (!message || (!message.text && !message.voice && !message.audio)) return;
    const chatId = String(message.chat.id);
    const state = await this.controlPlaneStore.get();
    const bot = state.bots.find((item) => item.id === this.botId);
    if (!bot?.enabled) return;
    let text = message.text || '';
    let command = { handled: false };
    try {
      command = text ? await handleCommand({ text, chatId, chatType: message.chat.type, botUsername: this.me?.username, bot, manager: this.manager,
        controlPlaneStore: this.controlPlaneStore, pairing: this.pairing, engines: this.engines,
        toolBroker: this.toolBroker }) : command;
    } catch (error) { return this.client.sendMessage(chatId, `操作失败：${safeError(error)}`); }
    if (command.handled) {
      if (command.imagePrompt) {
        await this.#reply(chatId, `/draw ${command.imagePrompt}`);
      } else {
        await this.#sendImages(chatId, command.images, command.imageErrors);
        await this.#sendText(chatId, command.text, { splitParagraphs: false, longMessageSplit: true });
      }
      return;
    }
    if (!bot.telegram.allowedChatIds.includes(chatId)) {
      return this.client.sendMessage(chatId, 'Bot 已连通。请先在栖光庭的 Bot 卡片绑定你的 Telegram 账号。');
    }
    if (message.chat.type !== 'private') {
      if (!bot.telegram.groupMode || !isMentioned(text, this.me?.username)) return;
    }
    if (!text) {
      if (!bot.voice.transcriptionConnectionId) return this.client.sendMessage(chatId, '收到语音了，但这个 Bot 还没有选择语音转写连接。');
      await this.client.sendTyping(chatId).catch(() => {});
      try {
        const media = message.voice || message.audio; const file = await this.client.downloadFile(media.file_id);
        text = await this.transcriptionService.transcribe(bot.voice.transcriptionConnectionId, file.data, media.mime_type || mimeFromPath(file.path));
      } catch (error) { return this.client.sendMessage(chatId, `语音转写失败：${safeError(error)}`); }
    }
    const delay = bot.telegram.mergeBurst ? bot.telegram.mergeDelayMs : 0;
    await this.batcher.push(chatId, text, delay, { group: message.chat.type !== 'private', transcribed: !message.text });
  }

  async #reply(chatId, text, context = {}) {
    const state = await this.controlPlaneStore.get();
    const bot = state.bots.find((item) => item.id === this.botId);
    if (!bot) return;
    let typingTimer = null;
    if (bot.telegram.typingIndicator) {
      await this.client.sendTyping(chatId).catch(() => {});
      typingTimer = setInterval(() => this.client.sendTyping(chatId).catch(() => {}), 4500);
    }
    try {
      const imagePrompt = !context.wake ? imageRequestPrompt(text) : null;
      if (imagePrompt && bot.image?.enabled && bot.image.imageProfileId) {
        const image = await this.imageService.generate(bot.image.imageProfileId, imagePrompt);
        const imageSent = await this.#sendImages(chatId, [image], 0, image.fallbackNote || '');
        await this.eventStore?.record(bot.id, { kind: 'reply', status: imageSent ? 'success' : 'error',
          title: imageSent ? '图片回复已发送' : '图片回复发送失败', detail: image.route || '生图' });
        return { sent: true, image: Boolean(imageSent) };
      }
      if (imagePrompt && !(bot.tools?.enabled && bot.tools.connectionIds?.length)
        && !state.connections?.some((item) => item.id === bot.chat?.connectionId && item.kind === 'codex')) {
        await this.client.sendMessage(chatId, '这个 Bot 还没有启用生图路线。');
        return { sent: true, image: false };
      }
      const voiceGuide = bot.voice.enabled && bot.voice.voiceProfileId && this.voiceService.instruction
        ? await this.voiceService.instruction(bot.voice.voiceProfileId).catch(() => '') : '';
      const result = await this.manager.reply(chatId, voiceRequestText(text), { surface: 'telegram', botId: bot.id, voiceGuide, ...context });
      if (context.wake && result.text.trim() === '[[SILENT]]') return { sent: false, reason: 'silent' };
      const imageSent = await this.#sendImages(chatId, result.images, result.imageErrors);
      const delivery = await this.#sendReplyText(chatId, bot, result, !context.wake && isExplicitVoiceRequest(text));
      let stickerSent = false;
      if (result.sticker && this.stickerService) {
        try {
          const asset = await this.stickerService.readAsset(result.sticker.assetId);
          await this.client.sendPhoto(chatId, asset.data, `sticker.${asset.extension}`);
          stickerSent = true;
        } catch (error) { this.logger.error(`Sticker ${bot.id}: ${error.message}`); }
      }
      const sent = Boolean(imageSent || delivery.voice || delivery.text || stickerSent);
      if (!context.wake) await this.eventStore?.record(bot.id, { kind: 'reply', status: sent ? 'success' : 'error',
        title: sent ? '消息回复已发送' : '没有可发送的回复',
        detail: [delivery.voice ? '语音' : '', delivery.text ? '文字' : '', imageSent ? '图片' : '', stickerSent ? '表情' : ''].filter(Boolean).join(' + ') || '回复已完成' });
      return { sent, voice: delivery.voice, sticker: stickerSent };
    } catch (error) {
      if (!context.wake) await this.eventStore?.record(bot.id, { kind: 'reply', status: 'error', title: '消息回复失败', detail: safeError(error) });
      if (context.wake) throw error;
      await this.client.sendMessage(chatId, `这次回复失败了：${safeError(error)}`);
    } finally {
      if (typingTimer) clearInterval(typingTimer);
    }
  }

  async #sendReplyText(chatId, bot, result, explicitVoice) {
    const { sent: voice, error: voiceError, stage } = await deliverReplyAudio({ voice: bot.voice, voiceService: this.voiceService,
      text: result.speechText || result.text, explicit: explicitVoice, random: this.random, send: async (audio) => {
        if (audio.mime === 'audio/wav') await this.client.sendAudio(chatId, audio.audio, `reply.${audio.extension}`);
        else await this.client.sendVoice(chatId, audio.audio, `reply.${audio.extension}`);
      } });
    if (voiceError) {
      this.logger.error(`Voice ${bot.id}: ${safeError(voiceError)}`);
      await this.eventStore?.record(bot.id, { kind: 'voice', status: 'error', title: '语音发送未完成', detail: stage });
    }
    const text = Boolean(result.text?.trim() && (!voice || bot.voice?.telegramSendTextWithVoice));
    if (text) await this.#sendText(chatId, result.text, bot.telegram);
    if (explicitVoice && voiceError) await this.client.sendMessage(chatId, `语音没有发出去：${safeError(voiceError)}`);
    return { voice, text };
  }

  async #sendText(chatId, text, settings) {
    for (const part of splitTelegramMessage(text, settings)) {
      await this.client.sendMessage(chatId, part);
      if (settings.splitParagraphs) await new Promise((resolve) => setTimeout(resolve, 280));
    }
  }

  async #sendImages(chatId, images = [], failures = 0, caption = '') {
    let sent = 0;
    for (const { image, extension } of images) {
      try {
        const filename = `image.${extension}`;
        if (image.length > 10 * 1024 * 1024) await this.client.sendDocument(chatId, image, filename, caption.slice(0, 1024));
        else await this.client.sendPhoto(chatId, image, filename, caption.slice(0, 1024));
        sent += 1;
      } catch (error) {
        failures += 1;
        this.logger.error(`Image ${this.botId}: ${safeError(error)}`);
      }
    }
    if (failures) await this.client.sendMessage(chatId, `有 ${failures} 张图片没能发送，请稍后再试。`);
    return sent;
  }

  proactive(chatId, prompt, context = {}) { return this.#reply(String(chatId), prompt, { wake: true, ...context }); }
}

function isMentioned(text, username) {
  return Boolean(username && text.toLowerCase().includes(`@${username.toLowerCase()}`));
}

function safeError(error) {
  return String(error?.message ?? error).replace(/(?:sk|bot|Bearer)[-_:\s][A-Za-z0-9._-]+/gi, '[已隐藏]');
}

function mimeFromPath(path = '') { if (path.endsWith('.mp3')) return 'audio/mpeg'; if (path.endsWith('.wav')) return 'audio/wav'; if (path.endsWith('.webm')) return 'audio/webm'; return 'audio/ogg'; }
