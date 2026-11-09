import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class McpStdioClient {
  constructor({ connection, secret, spawnImpl = spawn }) { this.connection = connection; this.secret = secret; this.spawn = spawnImpl; }
  listTools(signal) { return this.#run('tools/list', {}, signal).then((result) => result?.tools || []); }
  callTool(name, args, signal) { return this.#run('tools/call', { name, arguments: args }, signal); }

  async #run(method, params, signal) {
    const options = this.connection.options || {}; if (!options.command) throw new Error('本机 MCP 没有配置命令');
    const env = { ...process.env, ...(options.env || {}) };
    if (this.secret && options.secretEnv) env[options.secretEnv] = this.secret;
    const child = this.spawn(options.command, Array.isArray(options.args) ? options.args : [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    const pending = new Map(); let nextId = 1; let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => { try { const message = JSON.parse(line); pending.get(message.id)?.(message); } catch {} });
    const stop = () => child.kill('SIGTERM'); signal?.addEventListener('abort', stop, { once: true });
    const request = (requestMethod, requestParams) => new Promise((resolve, reject) => {
      const id = nextId++; const timer = setTimeout(() => { pending.delete(id); reject(new Error('本机 MCP 响应超时')); }, Number(options.timeoutMs) || 30_000);
      pending.set(id, (message) => { clearTimeout(timer); pending.delete(id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: requestMethod, params: requestParams })}\n`);
    });
    child.once('error', (error) => { for (const resolve of pending.values()) resolve({ error: { message: error.message } }); });
    try {
      await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tg-agent-steward', version: '0.3.0' } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      return await request(method, params);
    } catch (error) { throw new Error(error.message || stderr.trim() || '本机 MCP 调用失败'); }
    finally { signal?.removeEventListener('abort', stop); lines.close(); stop(); }
  }
}
