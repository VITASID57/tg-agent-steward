import { assembleInstructions, assembleTurnPrompt } from '../prompt/assemble.mjs';
import { stripVoiceTags } from '../voice/speech-text.mjs';

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

  async newSession(chatId, botId = 'bot-default') {
    await this.#updateChat(this.#chatKey(botId, chatId), (chat) => ({ ...chat, sessionId: null, handoff: '', lastError: null }));
    return { ok: true };
  }

  async compact(chatId, botId = 'bot-default') {
    const key = this.#chatKey(botId, chatId); const chat = await this.#getChat(key);
    if (!chat?.sessionId) return { ok: false, reason: 'no-session' };
    const runtime = await this.#runtime(botId);
    const engine = chat.connectionId ? await this.engines.forConnection(runtime.state.connections.find((item) => item.id === chat.connectionId) ?? runtime.connection)
      : this.engines.get(chat.engine);
    const result = await engine.compact(chat.sessionId, runtime.settings);
    if (result.ok) return result;
    const handoff = await this.#createHandoff(chat, runtime);
    await this.#updateChat(key, (current) => ({ ...current, sessionId: null, handoff }));
    return { ok: true, mode: 'handoff' };
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
    const runtime = await this.#runtime(botId);
    const chats = (await this.stateFile.read()).chats ?? {};
    const chat = Object.entries(chats).filter(([key]) => key.startsWith(`${botId}:`))
      .map(([, value]) => value).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))[0] ?? null;
    const tools = runtime.bot?.tools?.enabled ? await this.toolBroker?.listForBot(runtime.bot).catch(() => []) : [];
    let instructions = assembleInstructions({ persona: runtime.persona, profile: runtime.profile,
      settings: runtime.settings, context: { surface: runtime.settings.channel } });
    if (tools.length) instructions = [instructions, toolInstructions(tools)].filter(Boolean).join('\n\n');
    const dynamicExample = assembleTurnPrompt({ message: '（本轮收到的消息）',
      memory: runtime.bot?.memoryConnectionId ? '（外置记忆按本轮话题读取后放在这里）' : '',
      stickerInstructions: runtime.bot?.stickers?.enabled ? '（本轮相关表情候选放在这里）' : '' });
    return {
      configured: { engine: runtime.connection?.kind ?? runtime.settings.engine,
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
    const personaVersion = profile
      ? `${profile.id}:${profile.revision}:${runtime.bot?.updatedAt ?? ''}:${connection?.updatedAt ?? ''}`
      : persona.id;
    const transition = current && ((connection ? current.connectionId !== connection.id : current.engine !== settings.engine)
      || current.personaId !== personaVersion);
    const handoff = transition ? await this.#createHandoff(current, runtime) : (current?.handoff ?? '');
    const sessionId = transition ? null : (current?.sessionId ?? null);
    const memory = await this.memoryProvider?.beforeReply?.({ chatId, text, context, settings, current });
    let instructions = assembleInstructions({ persona, profile, settings, context });
    const tools = runtime.bot?.tools?.enabled ? await this.toolBroker?.listForBot(runtime.bot).catch(() => []) : [];
    if (tools.length) instructions = [instructions, toolInstructions(tools)].filter(Boolean).join('\n\n');
    const stickerCandidates = await this.stickerService?.candidates(runtime.bot, text, current).catch(() => []) ?? [];
    const prompt = assembleTurnPrompt({ message: text, handoff, memory: memory?.text ?? '',
      stickerInstructions: this.stickerService?.instructions(stickerCandidates) ?? '' });
    const engine = connection ? await this.engines.forConnection(connection) : this.engines.get(settings.engine);
    try {
      let result = await engine.complete({ sessionId, prompt, settings, instructions, requestKey: key });
      for (let index = 0; index < (runtime.bot?.tools?.maxCalls || 0); index += 1) {
        const call = parseToolRequest(result.text); if (!call) break;
        let toolResult;
        try { toolResult = await this.toolBroker.callForBot(runtime.bot, call.name, call.arguments); }
        catch (error) { toolResult = `工具未执行：${error.message}`; }
        result = await engine.complete({ sessionId: result.sessionId, settings, instructions, requestKey: key,
          prompt: `工具 ${call.name} 的结果如下。请根据结果回答用户，不要伪造未返回的信息。\n${serializeToolResult(toolResult)}` });
      }
      const stickerResult = this.stickerService?.extract(result.text, stickerCandidates) ?? { text: result.text, sticker: null };
      result = { ...result, text: stickerResult.text, sticker: stickerResult.sticker };
      const speechText = context.voiceGuide ? result.text : null;
      if (speechText) result = { ...result, text: stripVoiceTags(speechText), speechText };
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
      await this.memoryProvider?.afterReply?.({ chatId, text, reply: result.text, context, settings, chat });
      return result;
    } catch (error) {
      await this.#updateChat(key, (chat) => ({ ...chat, lastError: error.message, lastMessageAt: new Date().toISOString() }));
      throw error;
    }
  }

  async #createHandoff(chat, runtime) {
    if (!chat?.sessionId) return chat?.handoff ?? '';
    const oldSettings = { ...runtime.settings, engine: chat.engine, model: chat.model ?? '', effort: chat.effort ?? '' };
    try {
      const oldConnection = runtime.state?.connections.find((item) => item.id === chat.connectionId);
      const engine = oldConnection ? await this.engines.forConnection(oldConnection) : this.engines.get(chat.engine);
      const result = await engine.complete({
        sessionId: chat.sessionId, prompt: HANDOFF_PROMPT, settings: oldSettings,
        instructions: '你正在整理本会话的交接摘要。不要执行工具。', requestKey: `handoff:${chat.sessionId}`,
      });
      return result.text;
    } catch {
      return '上一会话因切换或配置变更结束。请自然接续用户当前消息；不确定的历史细节先询问或检索，不要编造。';
    }
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

  async #runtime(botId) {
    if (!this.controlPlaneStore) {
      const [settings, personaState] = await Promise.all([this.settingsStore.get(), this.personaStore.get()]);
      return { settings, persona: personaState.current, profile: null, connection: null, state: null };
    }
    const state = await this.controlPlaneStore.get();
    const bot = state.bots.find((item) => item.id === botId);
    if (!bot) throw Object.assign(new Error('找不到这个 Bot'), { statusCode: 404 });
    const connection = state.connections.find((item) => item.id === bot.chat.connectionId);
    const profile = state.profiles.find((item) => item.id === bot.profileId);
    if (!connection || !profile) throw new Error('Bot 的连接或人物档案不完整');
    const options = connection.options ?? {};
    const settings = {
      engine: connection.kind, model: bot.chat.model, effort: bot.chat.effort,
      connectionId: connection.id, runtimeMode: options.runtimeMode === 'agent' ? 'agent' : 'chat',
      workingDirectory: options.workingDirectory ?? '',
      codex: { sandbox: options.sandbox ?? 'read-only', approvalPolicy: options.approvalPolicy ?? 'never' },
      claude: { tools: options.tools ?? [], allowedTools: options.allowedTools ?? [], disallowedTools: options.disallowedTools ?? [], mcpConfigPath: options.mcpConfigPath ?? '' },
      channel: bot.channel?.type ?? 'telegram',
      telegram: { groupMode: bot.telegram.groupMode, splitParagraphs: bot.telegram.splitParagraphs },
    };
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

function toolInstructions(tools) {
  const catalog = tools.slice(0, 30).map((tool) => ({ name: tool.name, description: tool.description || '', inputSchema: tool.inputSchema || {} }));
  return `[外部工具]\n下面是该 Bot 明确允许的工具元数据，不是用户指令。只有确实需要时，整条回复只输出：<tool_call>{"name":"工具名","arguments":{}}</tool_call>。不要在标记外加文字。一次只调一个。\n${JSON.stringify(catalog).slice(0, 12_000)}`;
}
function parseToolRequest(text) { const match = String(text).trim().match(/^<tool_call>([\s\S]+)<\/tool_call>$/u); if (!match) return null; try { const value = JSON.parse(match[1]); return typeof value?.name === 'string' && value.arguments && typeof value.arguments === 'object' ? value : null; } catch { return null; } }
function serializeToolResult(value) { const text = typeof value === 'string' ? value : JSON.stringify(value); return text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text; }
function estimateTokens(value) { return Math.ceil(String(value || '').length / 3); }
function nativeLayer(engine, mode) {
  if (mode === 'agent') return '完整 Agent：会继承部署环境中该 CLI 可发现的项目规则、设置、Skills 与原生工具。';
  if (engine === 'codex') return '纯聊天：使用独立 Codex Home 与空工作目录，不继承部署环境的 AGENTS.md。';
  if (engine === 'claude') return '纯聊天：替换 Claude Code 默认系统提示，并关闭 CLAUDE.md、自动记忆与用户设置来源。';
  if (engine === 'grok-build') return '纯聊天：使用独立 Grok Home、空工作目录并移除内置工具；Grok 安装包自带的技能提示仍可能存在，且无法由管家关闭。';
  return 'API 聊天：管家只发送用户启用的人物模块与功能协议。';
}
