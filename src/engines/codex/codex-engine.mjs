const TURN_TIMEOUT_MS = 20 * 60_000;

export class CodexEngine {
  id = 'codex';

  constructor(clientOrClients, { chatWorkdir = '' } = {}) {
    this.clients = clientOrClients?.chat
      ? { chat: clientOrClients.chat, agent: clientOrClients.agent ?? clientOrClients.chat }
      : { chat: clientOrClients, agent: clientOrClients };
    this.chatWorkdir = chatWorkdir;
    this.loadedThreads = new Map();
    this.turns = new Map();
    this.usageByThread = new Map();
    this.requestThreads = new Map();
    for (const client of new Set(Object.values(this.clients))) {
      client.on('item/agentMessage/delta', (event) => this.#onDelta(event));
      client.on('turn/completed', (event) => this.#onCompleted(event));
      client.on('thread/tokenUsage/updated', (event) => this.usageByThread.set(event.threadId, event.tokenUsage));
      client.on('closed', (error) => this.#failClient(client, error));
    }
  }

  async capabilities() {
    const client = this.clients.agent;
    await client.start();
    const models = [];
    let cursor = null;
    do {
      const page = await client.request('model/list', { cursor, limit: 100, includeHidden: false });
      models.push(...page.data.map((model) => ({
        id: model.model, name: model.displayName, description: model.description,
        efforts: model.supportedReasoningEfforts.map((item) => item.reasoningEffort),
        defaultEffort: model.defaultReasoningEffort, isDefault: model.isDefault,
      })));
      cursor = page.nextCursor;
    } while (cursor);
    return { available: true, models, efforts: [...new Set(models.flatMap((model) => model.efforts))] };
  }

  async complete({ sessionId, prompt, settings, instructions, requestKey }) {
    const mode = settings.runtimeMode === 'agent' ? 'agent' : 'chat';
    const client = this.clients[mode];
    await client.start();
    const threadId = sessionId
      ? await this.#resume(client, mode, sessionId, settings, instructions)
      : await this.#startThread(client, mode, settings, instructions);
    if (requestKey) this.requestThreads.set(requestKey, threadId);
    const result = this.#waitForTurn(client, threadId, requestKey);
    try {
      const response = await client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
      });
      const state = this.turns.get(threadId);
      if (state) state.turnId = response.turn?.id ?? null;
    } catch (error) {
      const state = this.turns.get(threadId);
      if (state) {
        clearTimeout(state.timer);
        this.turns.delete(threadId);
        if (state.requestKey) this.requestThreads.delete(state.requestKey);
        state.reject(error);
      }
      throw error;
    }
    const completed = await result;
    return { ...completed, sessionId: threadId, usage: this.usageByThread.get(threadId) ?? null };
  }

  async compact(sessionId, settings = {}) {
    const mode = settings.runtimeMode === 'agent' ? 'agent' : 'chat';
    const client = this.clients[mode];
    await client.start();
    await this.#resume(client, mode, sessionId, settings, '');
    await client.request('thread/compact/start', { threadId: sessionId });
    return { ok: true };
  }

  async stop(sessionId, requestKey) {
    const activeThreadId = requestKey ? this.requestThreads.get(requestKey) : sessionId;
    const turnId = this.turns.get(activeThreadId)?.turnId;
    if (!turnId) return { ok: false, reason: 'idle' };
    await this.turns.get(activeThreadId).client.request('turn/interrupt', { threadId: activeThreadId, turnId });
    return { ok: true };
  }

  async usage(settings = {}) {
    const client = this.clients[settings.runtimeMode === 'agent' ? 'agent' : 'chat'];
    await client.start();
    const [limits, account] = await Promise.allSettled([
      client.request('account/rateLimits/read', { excludeResetCreditDetails: true }),
      client.request('account/usage/read', {}),
    ]);
    return {
      rateLimits: limits.status === 'fulfilled' ? limits.value : null,
      accountUsage: account.status === 'fulfilled' ? account.value : null,
    };
  }

  async #startThread(client, mode, settings, instructions) {
    const cwd = mode === 'chat' ? this.chatWorkdir : settings.workingDirectory;
    const response = await client.request('thread/start', {
      ...(settings.model ? { model: settings.model } : {}),
      ...(cwd ? { cwd } : {}),
      developerInstructions: instructions,
      approvalPolicy: settings.codex?.approvalPolicy ?? 'never',
      sandbox: settings.codex?.sandbox ?? 'read-only',
    });
    this.loadedThreads.set(response.thread.id, { client, mode });
    return response.thread.id;
  }

  async #resume(client, mode, threadId, settings, instructions) {
    if (this.loadedThreads.get(threadId)?.client === client) return threadId;
    const cwd = mode === 'chat' ? this.chatWorkdir : settings.workingDirectory;
    await client.request('thread/resume', {
      threadId, excludeTurns: true,
      ...(settings.model ? { model: settings.model } : {}),
      ...(cwd ? { cwd } : {}),
      ...(instructions ? { developerInstructions: instructions } : {}),
    });
    this.loadedThreads.set(threadId, { client, mode });
    return threadId;
  }

  #waitForTurn(client, threadId, requestKey) {
    if (this.turns.has(threadId)) throw Object.assign(new Error('这个会话仍在回复中'), { statusCode: 409 });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turns.delete(threadId);
        if (requestKey) this.requestThreads.delete(requestKey);
        reject(new Error('Codex 回复超时'));
      }, TURN_TIMEOUT_MS);
      this.turns.set(threadId, { text: '', turnId: null, resolve, reject, timer, client, requestKey });
    });
  }

  #onDelta(event) {
    const state = this.turns.get(event.threadId);
    if (state) state.text += event.delta ?? '';
  }

  #onCompleted(event) {
    const state = this.turns.get(event.threadId);
    if (!state) return;
    clearTimeout(state.timer);
    this.turns.delete(event.threadId);
    if (state.requestKey) this.requestThreads.delete(state.requestKey);
    if (event.turn?.status === 'completed') state.resolve({ text: state.text.trim(), turnId: event.turn.id });
    else state.reject(new Error(event.turn?.error?.message ?? `Codex turn ${event.turn?.status ?? 'failed'}`));
  }

  #failClient(client, error) {
    for (const [threadId, loaded] of this.loadedThreads) if (loaded.client === client) this.loadedThreads.delete(threadId);
    for (const [threadId, state] of this.turns) {
      if (state.client !== client) continue;
      clearTimeout(state.timer);
      if (state.requestKey) this.requestThreads.delete(state.requestKey);
      state.reject(error);
      this.turns.delete(threadId);
    }
  }
}
