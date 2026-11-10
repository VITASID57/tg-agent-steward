import { randomUUID } from 'node:crypto';
import { listToolPages } from './mcp-tool-pages.mjs';

export class McpRemoteClient {
  constructor({ connection, secret, fetchImpl = fetch }) {
    this.connection = connection; this.secret = secret; this.fetch = fetchImpl; this.sessionId = '';
  }

  async listTools(signal) {
    await this.#initialize(signal);
    return listToolPages((method, params) => this.#request(method, params, signal));
  }

  async callTool(name, args, signal) {
    await this.#initialize(signal); return this.#request('tools/call', { name, arguments: args }, signal);
  }

  async #initialize(signal) {
    if (this.sessionId) return;
    await this.#request('initialize', { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'tg-agent-steward', version: '0.3.0' } }, signal);
    await this.#notify('notifications/initialized', {}, signal);
  }

  #notify(method, params, signal) { return this.#send({ jsonrpc: '2.0', method, params }, signal, false); }
  async #request(method, params, signal) {
    const id = randomUUID(); const response = await this.#send({ jsonrpc: '2.0', id, method, params }, signal, true);
    if (response?.error) throw new Error(response.error.message || `MCP ${method} 失败`);
    return response?.result;
  }

  async #send(payload, signal, expectResponse) {
    const { url, headers } = requestTarget(this.connection, this.secret); const controller = new AbortController();
    const stop = () => controller.abort(); signal?.addEventListener('abort', stop, { once: true }); const timer = setTimeout(stop, Number(this.connection.options?.timeoutMs) || 30_000);
    try {
      const response = await this.fetch(url, { method: 'POST', signal: controller.signal, headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers,
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'MCP 凭据未被接受' : `MCP HTTP ${response.status}`);
      this.sessionId = response.headers.get('mcp-session-id') || this.sessionId;
      if (!expectResponse || response.status === 202) return null;
      const text = await response.text(); return parseMcpResponse(text, response.headers.get('content-type'));
    } catch (error) { if (controller.signal.aborted) throw new Error(signal?.aborted ? 'MCP 调用已停止' : 'MCP 连接超时'); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  }
}

function requestTarget(connection, secret) {
  const url = new URL(connection.baseUrl); const type = connection.options?.authType || 'bearer'; const headers = {};
  if (secret && type === 'query') url.searchParams.set(connection.options?.authName || 'key', secret);
  else if (secret && type === 'header') headers[connection.options?.authName || 'X-API-Key'] = secret;
  else if (secret && type === 'api-key') headers['x-goog-api-key'] = secret;
  else if (secret && type === 'bearer') headers.Authorization = `Bearer ${secret}`;
  return { url, headers };
}

function parseMcpResponse(text, type = '') {
  if (!text.trim()) return null;
  if (!type?.includes('text/event-stream')) return JSON.parse(text);
  const payloads = text.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter((line) => line && line !== '[DONE]');
  if (!payloads.length) throw new Error('MCP SSE 没有返回数据');
  return JSON.parse(payloads.at(-1));
}
