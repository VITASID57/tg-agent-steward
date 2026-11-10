import { McpRemoteClient } from './mcp-remote-client.mjs';
import { McpStdioClient } from './mcp-stdio-client.mjs';
import { mcpImages } from '../media/image-payload.mjs';

export class ToolBroker {
  constructor({ controlPlaneStore, secretStore, fetchImpl = fetch, spawnImpl }) {
    this.controlPlaneStore = controlPlaneStore; this.secretStore = secretStore; this.fetch = fetchImpl; this.spawn = spawnImpl;
    this.cache = new Map();
  }

  async listForBot(bot, signal) {
    if (!bot.tools.enabled) return [];
    const sources = await this.#sources(bot, signal);
    const result = new Map();
    for (const { connection, tools } of sources) {
      for (const tool of tools) {
        if (!result.has(tool.name) && allowedFor(bot, connection, tool.name) && canWrite(bot, connection, tool)
          && !sensitiveAction(tool.name, tool.description)) {
          result.set(tool.name, { ...tool, connectionId: connection.id, connectionName: connection.name });
        }
      }
    }
    return [...result.values()];
  }

  async callForBot(bot, name, args, { signal, manual = false } = {}) {
    if (!bot.tools.enabled) throw new Error('这个 Bot 没有启用工具');
    if (bot.tools.allowedToolNames?.length && !bot.tools.allowedToolNames.includes(name)) throw new Error('这个工具不在 Bot 白名单中');
    let blocked = '';
    for (const { connection, tools } of await this.#sources(bot, signal)) {
      const tool = tools.find((item) => item.name === name);
      if (!tool) continue;
      if (!allowedFor(bot, connection, name)) { blocked ||= '这个工具已在 Bot 设置中关闭'; continue; }
      if (!canWrite(bot, connection, tool)) { blocked ||= '这个工具可能产生下单、付款或写入；请先在控制页明确允许写操作。'; continue; }
      if (!manual && sensitiveAction(name, tool.description)) { blocked ||= '付款、结账或最终下单必须由人在 Telegram 里明确执行 /tool，不能自动代办。'; continue; }
      const client = await this.#client(connection);
      const result = await client.callTool(name, args, signal);
      return normalizeResult(result);
    }
    throw new Error(blocked || `没有找到工具：${name}`);
  }

  async listConnection(connectionId, signal) {
    const state = await this.controlPlaneStore.get(); const connection = state.connections.find((item) => item.id === connectionId);
    if (!connection?.capabilities?.includes('tools')) throw new Error('连接不存在或不支持工具');
    return (await this.#list(connection, signal)).map((tool) => ({ ...tool, connectionId }));
  }

  async #sources(bot, signal) {
    const state = await this.controlPlaneStore.get();
    const selected = bot.tools.connectionIds.map((id) => state.connections.find((item) => item.id === id)).filter(Boolean);
    const sources = await Promise.allSettled(selected.map(async (connection) => ({ connection, tools: await this.#list(connection, signal) })));
    signal?.throwIfAborted();
    return sources.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  }

  async #list(connection, signal) {
    const hit = this.cache.get(connection.id); if (hit?.updatedAt === connection.updatedAt && hit?.expiresAt > Date.now()) return hit.tools;
    const tools = await (await this.#client(connection)).listTools(signal);
    this.cache.set(connection.id, { tools, updatedAt: connection.updatedAt, expiresAt: Date.now() + 300_000 }); return tools;
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
  const content = Array.isArray(result?.content) ? result.content : [];
  const media = mcpImages(content);
  const text = content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n');
  const output = media.images.length || media.imageErrors
    ? (text || (media.images.length ? '工具已返回图片附件。' : '工具返回的图片无法读取。'))
    : (text || result?.structuredContent || result || '工具已完成。');
  return { output, ...media };
}

function allowedFor(bot, connection, name) {
  return (!bot.tools.allowedToolNames?.length || bot.tools.allowedToolNames.includes(name))
    && !bot.tools.disabledByConnection?.[connection.id]?.includes(name);
}

function canWrite(bot, connection, tool) {
  return bot.tools.allowWrites || tool.annotations?.readOnlyHint === true || connection.options?.accessMode === 'read-only';
}
function sensitiveAction(name, description = '') { return /(?:pay|payment|checkout|confirm[_-]?order|submit[_-]?order|付款|支付|结账|确认下单)/iu.test(`${name} ${description}`); }
