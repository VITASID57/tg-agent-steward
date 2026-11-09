import { McpRemoteClient } from './mcp-remote-client.mjs';
import { McpStdioClient } from './mcp-stdio-client.mjs';

export class ToolBroker {
  constructor({ controlPlaneStore, secretStore, fetchImpl = fetch, spawnImpl }) {
    this.controlPlaneStore = controlPlaneStore; this.secretStore = secretStore; this.fetch = fetchImpl; this.spawn = spawnImpl;
    this.cache = new Map();
  }

  async listForBot(bot, signal) {
    if (!bot.tools.enabled) return [];
    const state = await this.controlPlaneStore.get(); const allowed = new Set(bot.tools.allowedToolNames);
    const result = [];
    for (const id of bot.tools.connectionIds) {
      const connection = state.connections.find((item) => item.id === id); if (!connection) continue;
      const tools = await this.#list(connection, signal);
      for (const tool of tools) if (!allowed.size || allowed.has(tool.name)) result.push({ ...tool, connectionId: id, connectionName: connection.name });
    }
    return result;
  }

  async callForBot(bot, name, args, { signal, manual = false } = {}) {
    if (!bot.tools.enabled) throw new Error('这个 Bot 没有启用工具');
    if (bot.tools.allowedToolNames.length && !bot.tools.allowedToolNames.includes(name)) throw new Error('这个工具不在 Bot 白名单中');
    const state = await this.controlPlaneStore.get();
    for (const id of bot.tools.connectionIds) {
      const connection = state.connections.find((item) => item.id === id); if (!connection) continue;
      const client = await this.#client(connection); const tool = (await this.#list(connection, signal)).find((item) => item.name === name);
      if (!tool) continue;
      const readOnly = tool.annotations?.readOnlyHint === true || connection.options?.accessMode === 'read-only';
      if (!readOnly && !bot.tools.allowWrites) throw new Error('这个工具可能产生下单、付款或写入；请先在控制页明确允许写操作。');
      if (!manual && sensitiveAction(name, tool.description)) throw new Error('付款、结账或最终下单必须由人在 Telegram 里明确执行 /tool，不能自动代办。');
      const result = await client.callTool(name, args, signal);
      return normalizeResult(result);
    }
    throw new Error(`没有找到工具：${name}`);
  }

  async listConnection(connectionId, signal) {
    const state = await this.controlPlaneStore.get(); const connection = state.connections.find((item) => item.id === connectionId);
    if (!connection?.capabilities?.includes('tools')) throw new Error('连接不存在或不支持工具');
    return (await this.#list(connection, signal)).map((tool) => ({ ...tool, connectionId }));
  }

  async #list(connection, signal) {
    const hit = this.cache.get(connection.id); if (hit && hit.expiresAt > Date.now()) return hit.tools;
    const tools = await (await this.#client(connection)).listTools(signal);
    this.cache.set(connection.id, { tools, expiresAt: Date.now() + 300_000 }); return tools;
  }

  async #client(connection) {
    const secret = await this.secretStore.read(`connection:${connection.id}`);
    if (['mcp-remote', 'memory-mcp'].includes(connection.kind)) return new McpRemoteClient({ connection, secret, fetchImpl: this.fetch });
    if (connection.kind === 'mcp-stdio') return new McpStdioClient({ connection, secret, spawnImpl: this.spawn });
    throw new Error(`不是 MCP 连接：${connection.kind}`);
  }
}

function normalizeResult(result) {
  if (result?.isError) throw new Error(result.content?.map((item) => item.text || '').join('\n') || '工具执行失败');
  const text = result?.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  return text || result?.structuredContent || result || '工具已完成。';
}
function sensitiveAction(name, description = '') { return /(?:pay|payment|checkout|confirm[_-]?order|submit[_-]?order|付款|支付|结账|确认下单)/iu.test(`${name} ${description}`); }
