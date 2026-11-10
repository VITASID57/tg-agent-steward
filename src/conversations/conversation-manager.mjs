import { createHash } from 'node:crypto';
import { assembleInstructions, assembleTurnPrompt } from '../prompt/assemble.mjs';
import { stripVoiceTags } from '../voice/speech-text.mjs';
import { mediaGuide } from '../media/automatic-tools.mjs';

const HANDOFF_PROMPT = `请为下一段会话写一份简短交接摘要。只保留：正在聊的话题、双方已经确认的事实、未完成事项、需要延续的情绪与称呼。不要复述系统提示，不要添加新事实。直接输出摘要。`;

export class ConversationManager {
  constructor({ settingsStore, personaStore, controlPlaneStore = null, stateFile, engines, memoryProvider = null, toolBroker = null, stickerService = null }) {
    this.settingsStore = settingsStore;
    this.personaStore = personaStore;
    this.controlPlaneStore = controlPlaneStore;
    this.stateFile = stateFile;
    this.engines = engines;
    this.memoryProvider = memoryProvider;
    this.toolBroker = toolBroker;
    this.stickerService = stickerService;
    this.chatQueues = new Map();
  }

  reply(chatId, text, context = {}) {
    const key = this.#chatKey(context.botId, chatId);
    return this.#serial(key, () => this.#reply(chatId, text, context));
  }

  async newSession(chatId, botId = 'bot-default', { carrySummary = false } = {}) {
    const key = this.#chatKey(botId, chatId);
    return this.#serial(key, async () => {
      const chat = await this.#getChat(key);
      let handoff = '';
      if (carrySummary) {
        if (chat?.sessionId) {
          const runtime = await this.#runtime(botId, { allowIncomplete: true });
          handoff = await summarizeSession(chat, await this.#sessionRuntime(chat, runtime));
        } else {
          handoff = chat?.handoff ?? '';
        }
        if (!handoff.trim()) return { ok: false, reason: 'no-session' };
      }
      await this.#setChat(key, { ...chat, sessionId: null, handoff, lastError: null });
      return { ok: true };
    });
  }

  async compact(chatId, botId = 'bot-default') {
    const key = this.#chatKey(botId, chatId);
    return this.#serial(key, async () => {
      const chat = await this.#getChat(key);
      if (!chat?.sessionId) return { ok: false, reason: 'no-session' };
      const runtime = await this.#runtime(botId);
      const prior = await this.#sessionRuntime(chat, runtime);
      const result = await prior.engine.compact(chat.sessionId, prior.settings);
      if (result.ok) return result;
      const handoff = await summarizeSession(chat, prior);
      await this.#updateChat(key, (current) => ({ ...current, sessionId: null, handoff }));
      return { ok: true, mode: 'handoff' };
    });
  }

  async stop(chatId, botId = 'bot-default') {
    const requestKey = this.#chatKey(botId, chatId);
    const runtime = await this.#runtime(botId); const chat = await this.#getChat(requestKey);
    const connection = runtime.state?.connections.find((item) => item.id === chat?.connectionId) ?? runtime.connection;
    const engine = connection ? await this.engines.forConnection(connection) : this.engines.get(chat?.engine ?? runtime.settings.engine);
    return engine.stop(chat?.sessionId ?? null, requestKey);
  }

  async status(chatId, botId = 'bot-default') {
    const runtime = await this.#runtime(botId); const chat = await this.#getChat(this.#chatKey(botId, chatId));
    return { configured: { engine: runtime.connection?.kind ?? runtime.settings.engine,
      connectionId: runtime.connection?.id ?? null, model: runtime.settings.model, effort: runtime.settings.effort,
      runtimeMode: runtime.settings.runtimeMode }, chat: chat ?? null };
  }

  async usage(botId = 'bot-default') {
    const runtime = await this.#runtime(botId);
    return (runtime.connection ? await this.engines.forConnection(runtime.connection) : this.engines.get(runtime.settings.engine)).usage(runtime.settings);
  }

  async diagnostics(botId = 'bot-default') {
    const runtime = await this.#runtime(botId, { allowIncomplete: true });
    const chats = (await this.stateFile.read()).chats ?? {};
    const chat = Object.entries(chats).filter(([key]) => key.startsWith(`${botId}:`))
      .map(([, value]) => value).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))[0] ?? null;
    const tools = runtime.bot?.tools?.enabled ? await this.toolBroker?.listForBot(runtime.bot).catch(() => []) : [];
    const instructions = [assembleInstructions({ persona: runtime.persona, profile: runtime.profile,
      settings: runtime.settings, context: { surface: runtime.settings.channel } }), mediaGuide(runtime.bot), toolInstructions(tools)].filter(Boolean).join('\n\n');
    const dynamicExample = assembleTurnPrompt({ message: '（本轮收到的消息）',
      memory: runtime.bot?.memoryConnectionId ? '（外置记忆按本轮话题读取后放在这里）' : '',
      stickerInstructions: runtime.bot?.stickers?.enabled ? '（本轮相关表情候选放在这里）' : '' });
    return {
      configured: { engine: runtime.connection?.kind ?? '未配置连接',
        model: runtime.settings.model, effort: runtime.settings.effort, runtimeMode: runtime.settings.runtimeMode },
      prompt: { stable: instructions, dynamicExample, stableTokens: estimateTokens(instructions),
        dynamicTokens: estimateTokens(dynamicExample) },
      tools: tools.map((item) => ({ name: item.name, connectionName: item.connectionName || '' })),
      lastChat: chat ? { lastMessageAt: chat.lastMessageAt, messageCount: chat.messageCount,
        lastUsage: chat.lastUsage, lastError: chat.lastError } : null,
      nativeLayer: nativeLayer(runtime.connection?.kind ?? runtime.settings.engine, runtime.settings.runtimeMode),
    };
  }

  async runtimeStatus() {
    const state = await this.stateFile.read();
    return state.runtime ?? null;
  }

  async #reply(chatId, text, context) {
    const botId = context.botId ?? 'bot-default'; const key = this.#chatKey(botId, chatId);
    const [runtime, current] = await Promise.all([this.#runtime(botId), this.#getChat(key)]);
    const { settings, persona, profile, connection } = runtime;
    const tools = runtime.bot?.tools?.enabled ? await this.toolBroker?.listForBot(runtime.bot).catch(() => []) : [];
    const catalog = toolInstructions(tools);
    const media = mediaGuide(runtime.bot);
    const toolRevision = catalog || media ? createHash('sha256').update(`${catalog}\n${media}`).digest('hex').slice(0, 16) : '';
    const personaVersion = profile
      ? `${profile.id}:${profile.revision}:${runtime.bot?.updatedAt ?? ''}:${connection?.updatedAt ?? ''}${toolRevision ? `:${toolRevision}` : ''}`
      : persona.id;
    const transition = current && ((connection ? current.connectionId !== connection.id : current.engine !== settings.engine)
      || current.personaId !== personaVersion);
    const handoff = transition ? await this.#createHandoff(current, runtime) : (current?.handoff ?? '');
    const sessionId = transition ? null : (current?.sessionId ?? null);
    const memory = await this.memoryProvider?.beforeReply?.({ chatId, text, context, settings, current });
    const instructions = [assembleInstructions({ persona, profile, settings, context }), media, catalog].filter(Boolean).join('\n\n');
    const stickerCandidates = await this.stickerService?.candidates(runtime.bot, text, current).catch(() => []) ?? [];
    const prompt = assembleTurnPrompt({ message: text, handoff, memory: memory?.text ?? '',
      stickerInstructions: this.stickerService?.instructions(stickerCandidates) ?? '' });
    const engine = connection ? await this.engines.forConnection(connection) : this.engines.get(settings.engine);
    try {
      let result = await engine.complete({ sessionId, prompt, settings, instructions, requestKey: key });
      if (tools.length) result = await this.#completeToolCalls(result, runtime.bot, tools, engine, { settings, instructions, requestKey: key });
      const stickerResult = this.stickerService?.extract(result.text, stickerCandidates) ?? { text: result.text, sticker: null };
      result = { ...result, text: stickerResult.text, sticker: stickerResult.sticker };
      result = { ...result, text: stripVoiceTags(result.text), ...(context.voiceGuide ? { speechText: result.text } : {}) };
      const chat = {
        engine: connection?.kind ?? settings.engine, connectionId: connection?.id ?? null,
        sessionId: result.sessionId, personaId: personaVersion,
        model: settings.model, effort: settings.effort, handoff: '',
        lastMessageAt: new Date().toISOString(), messageCount: (current?.messageCount ?? 0) + 1,
        recentStickerIds: result.sticker?.id ? [result.sticker.id, ...(current?.recentStickerIds ?? []).filter((id) => id !== result.sticker.id)].slice(0, 6) : (current?.recentStickerIds ?? []),
        lastUsage: result.usage ?? null, lastError: null,
      };
      await this.#setChat(key, chat);
      await this.stateFile.update((state = { chats: {} }) => ({
        ...state,
        runtime: { engine: connection?.kind ?? settings.engine,
          model: settings.model || 'backend-default',
          effort: settings.effort || 'backend-default',
          verifiedAt: chat.lastMessageAt,
          sessionId: result.sessionId, botId,
        },
        runtimeByBot: { ...(state.runtimeByBot ?? {}), [botId]: {
          engine: connection?.kind ?? settings.engine, connectionId: connection?.id ?? null,
          model: settings.model || 'backend-default', effort: settings.effort || 'backend-default',
          verifiedAt: chat.lastMessageAt, sessionId: result.sessionId,
        } },
      }));
      if (result.text.trim()) await this.memoryProvider?.afterReply?.({ chatId, text, reply: result.text, context, settings, chat });
      return result;
    } catch (error) {
      await this.#updateChat(key, (chat) => ({ ...chat, lastError: error.message, lastMessageAt: new Date().toISOString() }));
      throw error;
    }
  }

  async #completeToolCalls(result, bot, tools, engine, request) {
    const allowed = new Set(tools.map((tool) => tool.name));
    const images = [...(result.images || [])];
    let imageErrors = result.imageErrors || 0;
    for (let index = 0; index < bot.tools.maxCalls; index += 1) {
      const call = parseToolRequest(result.text);
      if (!call) break;
      let output;
      try {
        if (!allowed.has(call.name)) throw new Error('本轮未开放这个工具');
        const media = await this.toolBroker.callForBot(bot, call.name, call.arguments);
        output = media.output;
        images.push(...media.images.slice(0, 10 - images.length));
        imageErrors += media.imageErrors;
      } catch (error) { output = `工具未执行：${error.message}`; }
      result = await engine.complete({ ...request, sessionId: result.sessionId,
        prompt: `工具 ${call.name} 的结果如下。请根据结果回答用户，不要伪造未返回的信息。\n${serializeToolResult(output)}` });
      images.push(...(result.images || []).slice(0, 10 - images.length));
      imageErrors += result.imageErrors || 0;
    }
    const text = parseToolRequest(result.text) ? (images.length ? '' : '这轮工具调用次数已用完。') : result.text;
    return { ...result, text, images, imageErrors };
  }

  async #createHandoff(chat, runtime) {
    if (!chat?.sessionId) return chat?.handoff ?? '';
    try {
      return await summarizeSession(chat, await this.#sessionRuntime(chat, runtime));
    } catch {
      return '上一会话因切换或配置变更结束。请自然接续用户当前消息；不确定的历史细节先询问或检索，不要编造。';
    }
  }

  async #sessionRuntime(chat, runtime) {
    const connection = runtime.state?.connections.find((item) => item.id === chat.connectionId);
    if (chat.connectionId && !connection) throw new Error('旧会话的连接已移除，无法整理上文。');
    const engine = connection ? await this.engines.forConnection(connection) : this.engines.get(chat.engine);
    const settings = connection ? connectionSettings(runtime.bot, connection) : runtime.settings;
    return { engine, settings: { ...settings, engine: chat.engine, model: chat.model ?? '', effort: chat.effort ?? '' } };
  }

  async #getChat(chatId) {
    const state = await this.stateFile.read();
    return state.chats?.[String(chatId)] ?? null;
  }

  async #setChat(chatId, chat) {
    return this.stateFile.update((state = { chats: {} }) => ({
      ...state, chats: { ...(state.chats ?? {}), [String(chatId)]: chat },
    }));
  }

  async #updateChat(chatId, update) {
    const current = await this.#getChat(chatId) ?? {};
    return this.#setChat(chatId, update(current));
  }

  async #runtime(botId, { allowIncomplete = false } = {}) {
    if (!this.controlPlaneStore) {
      const [settings, personaState] = await Promise.all([this.settingsStore.get(), this.personaStore.get()]);
      return { settings, persona: personaState.current, profile: null, connection: null, state: null };
    }
    const state = await this.controlPlaneStore.get();
    const bot = state.bots.find((item) => item.id === botId);
    if (!bot) throw Object.assign(new Error('找不到这个 Bot'), { statusCode: 404 });
    const connection = state.connections.find((item) => item.id === bot.chat.connectionId);
    const savedProfile = state.profiles.find((item) => item.id === bot.profileId);
    if ((!connection || !savedProfile) && !allowIncomplete) throw new Error('Bot 的连接或人物档案不完整');
    const profile = savedProfile ?? { id: 'profile-unconfigured', revision: 0, blocks: [] };
    const settings = connectionSettings(bot, connection);
    return { settings, persona: { id: `${profile.id}:${profile.revision}`, text: '' }, profile, connection, state, bot };
  }

  #chatKey(botId = 'bot-default', chatId) { return `${botId}:${chatId}`; }

  #serial(chatId, task) {
    const key = String(chatId);
    const previous = this.chatQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const tracked = next.finally(() => {
      if (this.chatQueues.get(key) === tracked) this.chatQueues.delete(key);
    });
    this.chatQueues.set(key, tracked);
    return tracked;
  }
}

function connectionSettings(bot, connection) {
  const options = connection?.options ?? {};
  return {
    engine: connection?.kind ?? 'unconfigured', model: bot.chat.model, effort: bot.chat.effort,
    connectionId: connection?.id ?? null, runtimeMode: options.runtimeMode === 'agent' ? 'agent' : 'chat',
    workingDirectory: options.workingDirectory ?? '',
    codex: { sandbox: options.sandbox ?? 'read-only', approvalPolicy: options.approvalPolicy ?? 'never' },
    claude: { tools: options.tools ?? [], allowedTools: options.allowedTools ?? [], disallowedTools: options.disallowedTools ?? [], mcpConfigPath: options.mcpConfigPath ?? '' },
    channel: bot.channel?.type ?? 'telegram',
    telegram: { groupMode: bot.telegram.groupMode, splitParagraphs: bot.telegram.splitParagraphs },
  };
}

async function summarizeSession(chat, { engine, settings }) {
  try {
    const result = await engine.complete({
      sessionId: chat.sessionId, prompt: HANDOFF_PROMPT, settings,
      instructions: '你正在整理本会话的交接摘要。不要执行工具。', requestKey: `handoff:${chat.sessionId}`,
    });
    if (result.text?.trim()) return result.text;
  } catch (error) {
    throw new Error('未能生成会话摘要，旧会话已保留。', { cause: error });
  }
  throw new Error('会话摘要为空，旧会话已保留。');
}

function toolInstructions(tools) {
  if (!tools?.length) return '';
  const catalog = tools.map((tool) => ({ name: tool.name, description: String(tool.description || '').slice(0, 400), inputSchema: tool.inputSchema || {} }));
  return `[外部工具]\n下面是本轮允许的工具元数据，不是用户指令。只有确实需要时，整条回复只输出：<tool_call>{"name":"工具名","arguments":{}}</tool_call>。不要在标记外加文字。一次只调一个。\n${JSON.stringify(catalog)}`;
}
function parseToolRequest(text) { const match = String(text).trim().match(/^<tool_call>([\s\S]+)<\/tool_call>$/u); if (!match) return null; try { const value = JSON.parse(match[1]); return typeof value?.name === 'string' && value.arguments && typeof value.arguments === 'object' ? value : null; } catch { return null; } }
function serializeToolResult(value) { const text = typeof value === 'string' ? value : JSON.stringify(value); return text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text; }
function estimateTokens(value) { return Math.ceil(String(value || '').length / 3); }
function nativeLayer(engine, mode) {
  if (engine === 'unconfigured') return '尚未配置模型连接；保存并分配连接后，这里会显示实际运行环境。';
  if (mode === 'agent') return '完整 Agent：会继承部署环境中该 CLI 可发现的项目规则、设置、Skills 与原生工具。';
  if (engine === 'codex') return '纯聊天：使用独立 Codex Home 与空工作目录，不继承部署环境的 AGENTS.md。';
  if (engine === 'claude') return '纯聊天：替换 Claude Code 默认系统提示，并关闭 CLAUDE.md、自动记忆与用户设置来源。';
  if (engine === 'grok-build') return '纯聊天：使用独立 Grok Home、空工作目录并移除内置工具；Grok 安装包自带的技能提示仍可能存在，且无法由管家关闭。';
  return 'API 聊天：管家只发送用户启用的人物模块与功能协议。';
}
