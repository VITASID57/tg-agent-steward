import { McpRemoteClient } from '../tools/mcp-remote-client.mjs';

const DEFAULT_TIMEOUT = 12_000;

export class HttpMemoryProvider {
  constructor({ controlPlaneStore, secretStore, fetchImpl = fetch, logger = console }) {
    this.controlPlaneStore = controlPlaneStore; this.secretStore = secretStore;
    this.fetch = fetchImpl; this.logger = logger;
  }

  async beforeReply({ chatId, text, context, current }) {
    if (context.group === true) return null;
    const target = await this.#target(context.botId);
    if (!target) return null;
    try {
      const mode = context.wake === true || isAwakening(current, target.connection.options?.idleHours) ? 'awakening' : 'continuity';
      const request = {
        actor: target.connection.options?.actor || context.botId || 'telegram-agent',
        botId: context.botId || 'bot-default', chatId: String(chatId), mode, query: String(text),
        limitTokens: Number(target.connection.options?.limitTokens) || 2500,
      };
      const data = target.connection.kind === 'memory-mcp'
        ? await this.#mcp(target).callTool(target.connection.options?.contextTool || 'get_briefing', request)
        : await this.#post(target, target.connection.options?.contextPath || '/v1/context', request);
      const memoryText = target.connection.kind === 'memory-mcp' ? mcpText(data) : (data?.contextText ?? data?.text ?? data?.briefing);
      return typeof memoryText === 'string' && memoryText.trim() ? { text: memoryText.trim(), mode } : null;
    } catch (error) {
      this.logger.error(`Memory read ${context.botId || 'bot-default'}: ${error.message}`); return null;
    }
  }

  async afterReply({ chatId, text, reply, context }) {
    if (context.group === true) return;
    const target = await this.#target(context.botId);
    if (!target || target.connection.options?.writeEnabled !== true) return;
    try {
      const payload = {
        actor: target.connection.options?.actor || context.botId || 'telegram-agent',
        botId: context.botId || 'bot-default', chatId: String(chatId),
        userText: String(text), assistantText: String(reply), surface: context.surface || 'telegram',
      };
      if (target.connection.kind === 'memory-mcp') await this.#mcp(target).callTool(target.connection.options?.writeTool || 'store_memory', payload);
      else await this.#post(target, target.connection.options?.writePath || '/v1/turns', payload);
    } catch (error) { this.logger.error(`Memory write ${context.botId || 'bot-default'}: ${error.message}`); }
  }

  async #target(botId = 'bot-default') {
    const state = await this.controlPlaneStore.get(); const bot = state.bots.find((item) => item.id === botId);
    const connection = state.connections.find((item) => item.id === bot?.memoryConnectionId);
    if (!connection || !['memory-http', 'memory-mcp'].includes(connection.kind) || !connection.baseUrl) return null;
    return { connection, secret: await this.secretStore.read(`connection:${connection.id}`) };
  }

  async #post(target, path, body) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(target.connection.options?.timeoutMs) || DEFAULT_TIMEOUT);
    try {
      const response = await this.fetch(endpoint(target.connection.baseUrl, path), { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(target.secret ? { Authorization: `Bearer ${target.secret}` } : {}) },
        body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`HTTP ${response.status}${data?.error ? `：${data.error}` : ''}`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  #mcp(target) { return new McpRemoteClient({ connection: { ...target.connection, options: { ...target.connection.options,
    authType: target.connection.options?.authType || 'bearer' } }, secret: target.secret, fetchImpl: this.fetch }); }
}

function mcpText(value) {
  if (typeof value === 'string') return value;
  return value?.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || value?.structuredContent?.contextText || '';
}

function endpoint(base, path) {
  const root = String(base).replace(/\/+$/u, ''); const suffix = String(path || '').startsWith('/') ? path : `/${path}`;
  return root.endsWith(suffix) ? root : `${root}${suffix}`;
}

function isAwakening(current, configuredHours) {
  if (!current?.lastMessageAt) return true;
  const hours = Number(configuredHours) || 6;
  return Date.now() - Date.parse(current.lastMessageAt) >= hours * 60 * 60 * 1000;
}
