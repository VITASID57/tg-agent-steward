import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class AppServerClient extends EventEmitter {
  constructor({ command = process.env.CODEX_COMMAND || 'codex', requestTimeoutMs = 30_000,
    spawnProcess = spawn, env = process.env, cwd } = {}) {
    super();
    this.command = command;
    this.requestTimeoutMs = requestTimeoutMs;
    this.spawnProcess = spawnProcess;
    this.env = env;
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
    this.startPromise = null;
  }

  async start() {
    if (this.process) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start();
    try { await this.startPromise; } finally { this.startPromise = null; }
  }

  async #start() {
    const child = this.spawnProcess(this.command, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: this.env, ...(this.cwd ? { cwd: this.cwd } : {}),
    });
    this.process = child;
    child.once('error', (error) => this.#close(error));
    child.once('exit', (code) => this.#close(new Error(`Codex App Server 已退出（${code ?? 'unknown'}）`)));
    child.stderr.on('data', (chunk) => this.emit('diagnostic', chunk.toString()));
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.#onLine(line));
    await this.request('initialize', {
      clientInfo: { name: 'tg_agent_steward', title: 'TG Agent Steward', version: '0.1.0' },
      capabilities: {},
    });
    this.notify('initialized', {});
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.process && method !== 'initialize') return this.start().then(() => this.request(method, params, timeoutMs));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 等待 App Server 超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#send({ method, id, params });
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  async close() {
    const child = this.process;
    this.process = null;
    if (child && !child.killed) child.kill();
  }

  #send(message) {
    if (!this.process?.stdin?.writable) throw new Error('Codex App Server 未运行');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return this.emit('diagnostic', `无法解析 App Server 输出：${line}`); }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit(message.method, message.params ?? {});
  }

  #close(error) {
    this.process = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('closed', error);
  }
}
