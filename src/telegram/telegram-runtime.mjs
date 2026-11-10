import { MessageBatcher } from './batcher.mjs';
import { handleCommand } from './commands.mjs';
import { splitTelegramMessage } from './message-format.mjs';
import { shouldSendVoice } from '../voice/probability.mjs';
import { imageRequestPrompt, isExplicitVoiceRequest } from '../media/request-intent.mjs';

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
      this.me = await this.client.getMe(this.controller.signal);
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
      command = text ? await handleCommand({ text, chatId, bot, manager: this.manager,
        controlPlaneStore: this.controlPlaneStore, pairing: this.pairing, engines: this.engines,
        imageService: this.imageService, toolBroker: this.toolBroker }) : command;
    } catch (error) { return this.client.sendMessage(chatId, `操作失败：${safeError(error)}`); }
    if (command.handled) {
      if (command.image) await this.client.sendPhoto(chatId, command.image.image, `image.${command.image.extension}`, command.text);
      else await this.client.sendMessage(chatId, command.text);
      return;
    }
    if (!bot.telegram.allowedChatIds.includes(chatId)) {
      return this.client.sendMessage(chatId, '这个账号还没有获得访问权限。请先使用主人给的一次性配对码。');
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
      if (imagePrompt) {
        if (!bot.image?.enabled || !bot.image.imageProfileId) {
          await this.client.sendMessage(chatId, '这个 Bot 还没有启用生图路线。');
          return { sent: true, image: false };
        }
        const image = await this.imageService.generate(bot.image.imageProfileId, imagePrompt);
        await this.client.sendPhoto(chatId, image.image, `image.${image.extension}`, image.fallbackNote || '');
        await this.eventStore?.record(bot.id, { kind: 'reply', status: 'success', title: '图片回复已发送', detail: '生图' });
        return { sent: true, image: true };
      }
      const voiceGuide = bot.voice.enabled && bot.voice.voiceProfileId && this.voiceService.instruction
        ? await this.voiceService.instruction(bot.voice.voiceProfileId).catch(() => '') : '';
      const result = await this.manager.reply(chatId, text, { surface: 'telegram', botId: bot.id, voiceGuide, ...context });
      if (context.wake && result.text.trim() === '[[SILENT]]') return { sent: false, reason: 'silent' };
      let voice = null; let voiceError = null;
      const explicitVoice = !context.wake && isExplicitVoiceRequest(text);
      if ((result.speechText || result.text) && bot.voice.enabled && bot.voice.voiceProfileId
        && (explicitVoice || shouldSendVoice(bot.voice, this.random))) {
        voice = await this.voiceService.synthesize(bot.voice.voiceProfileId, result.speechText || result.text).catch((error) => {
          voiceError = error; this.logger.error(`Voice ${bot.id}: ${error.message}`); return null;
        });
      }
      if (!voice || bot.voice.sendTextWithVoice) {
        for (const part of splitTelegramMessage(result.text, bot.telegram)) {
          await this.client.sendMessage(chatId, part);
          if (bot.telegram.splitParagraphs) await new Promise((resolve) => setTimeout(resolve, 280));
        }
      }
      if (voice) {
        if (voice.mime === 'audio/wav') await this.client.sendAudio(chatId, voice.audio, `reply.${voice.extension}`);
        else await this.client.sendVoice(chatId, voice.audio, `reply.${voice.extension}`);
      }
      if (explicitVoice && voiceError) await this.client.sendMessage(chatId, `语音没有发出去：${safeError(voiceError)}`);
      let stickerSent = false;
      if (result.sticker && this.stickerService) {
        try {
          const asset = await this.stickerService.readAsset(result.sticker.assetId);
          await this.client.sendPhoto(chatId, asset.data, `sticker.${asset.extension}`);
          stickerSent = true;
        } catch (error) { this.logger.error(`Sticker ${bot.id}: ${error.message}`); }
      }
      if (!context.wake) await this.eventStore?.record(bot.id, { kind: 'reply', status: 'success', title: '消息回复已发送',
        detail: [voice ? '语音' : '', stickerSent ? '表情' : '', (!voice || bot.voice.sendTextWithVoice) ? '文字' : ''].filter(Boolean).join(' + ') || '回复已完成' });
      return { sent: true, voice: Boolean(voice), sticker: stickerSent };
    } catch (error) {
      if (!context.wake) await this.eventStore?.record(bot.id, { kind: 'reply', status: 'error', title: '消息回复失败', detail: safeError(error) });
      if (context.wake) throw error;
      await this.client.sendMessage(chatId, `这次回复失败了：${safeError(error)}`);
    } finally {
      if (typingTimer) clearInterval(typingTimer);
    }
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
