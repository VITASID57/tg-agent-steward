import { spawn } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const TIMEOUT_MS = 10 * 60_000;
const CHAT_DISABLED_TOOLS = [
  'run_terminal_command', 'run_terminal_cmd', 'read_file', 'search_replace', 'write', 'list_dir', 'grep',
  'kill_command_or_subagent', 'todo_write', 'get_command_or_subagent_output', 'scheduler_create',
  'scheduler_delete', 'scheduler_list', 'monitor', 'search_tool', 'use_tool', 'workflow', 'enter_plan_mode',
  'exit_plan_mode', 'ask_user_question', 'send_feedback', 'image_gen', 'image_edit', 'image_to_video',
  'reference_to_video', 'web_search', 'web_fetch', 'spawn_subagent', 'task', 'Agent',
];

export class GrokEngine {
  id = 'grok-build';
  constructor({ command = process.env.GROK_COMMAND || 'grok', runtimeRoot, spawnProcess = spawn } = {}) {
    this.command = command; this.runtimeRoot = runtimeRoot; this.spawnProcess = spawnProcess; this.active = new Map();
  }
  async capabilities() {
    const output = await runText(this.spawnProcess, this.command, ['models']);
    const models = output.split(/\r?\n/u).map((line) => line.match(/^\s*[-*]\s+([^\s]+)/u)?.[1]).filter(Boolean);
    const efforts = ['low', 'medium', 'high', 'xhigh'];
    return { available: true, models: models.map((id) => ({ id, name: id, efforts })), efforts };
  }
  async complete({ sessionId, prompt, settings, instructions, requestKey }) {
    const mode = settings.runtimeMode === 'agent' ? 'agent' : 'chat';
    const args = ['--no-auto-update'];
    if (mode === 'chat') args.push('--no-subagents', '--no-memory', '--disable-web-search', '--no-ask-user',
      '--max-turns', '1', '--disallowed-tools', CHAT_DISABLED_TOOLS.join(','));
    if (settings.model) args.push('--model', settings.model);
    if (settings.effort) args.push('--effort', settings.effort);
    args.push(mode === 'chat' ? '--system-prompt-override' : '--rules', instructions, 'agent', 'stdio');
    const connectionId = safeName(settings.connectionId || 'default');
    const workdir = mode === 'agent' ? (settings.workingDirectory || process.cwd()) : join(this.runtimeRoot, 'workdirs', connectionId);
    const env = mode === 'agent' ? process.env : await isolatedEnvironment(this.runtimeRoot, connectionId);
    const result = await runAcp(this.spawnProcess, this.command, args, {
      cwd: workdir, env, prompt, sessionId, requestKey,
      onStart: (child, key) => this.active.set(key, child), onDone: (key) => this.active.delete(key),
    });
    return { text: result.text, sessionId: result.sessionId, usage: result.usage };
  }
  async compact() { return { ok: false, reason: 'handoff-required' }; }
  async stop(sessionId, requestKey) {
    const child = this.active.get(requestKey) ?? this.active.get(sessionId);
    if (!child) return { ok: false, reason: 'idle' };
    child.kill(); return { ok: true };
  }
  async usage() { return { rateLimits: null, accountUsage: null, note: 'Grok Build 当前未提供统一订阅额度接口。' }; }
}

function runAcp(spawnProcess, command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const key = options.requestKey || options.sessionId || `new:${Date.now()}`; options.onStart(child, key);
    let nextId = 1; let text = ''; let stderr = ''; let settled = false;
    const pending = new Map();
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); options.onDone(key); if (!child.killed) child.kill();
      if (error) reject(error); else resolve(value);
    };
    const request = (method, params) => new Promise((accept, decline) => {
      const id = nextId++; pending.set(id, { accept, decline });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method === 'session/update') {
        const update = message.params?.update;
        if (update?.sessionUpdate === 'agent_message_chunk') text += typeof update.content === 'string' ? update.content : update.content?.text ?? '';
        return;
      }
      const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id);
      if (message.error) waiter.decline(new Error(message.error.message ?? 'Grok ACP 请求失败')); else waiter.accept(message.result ?? {});
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => finish(new Error(stderr.trim() || `Grok Build 已退出（${code}）`)));
    const timer = setTimeout(() => finish(new Error('Grok Build 回复超时')), TIMEOUT_MS);
    void (async () => {
      try {
        const init = await request('initialize', { protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'tg-agent-steward', version: '0.2.0' } });
        const methods = init.authMethods ?? init.authenticationMethods ?? [];
        const ids = methods.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean);
        const methodId = ids.includes('cached_token') ? 'cached_token' : ids[0];
        if (!methodId) throw new Error('Grok Build 尚未登录');
        await request('authenticate', { methodId, _meta: { headless: true } });
        let id = options.sessionId;
        if (id) { await request('session/load', { sessionId: id, cwd: options.cwd, mcpServers: [] }); text = ''; }
        else id = (await request('session/new', { cwd: options.cwd, mcpServers: [] })).sessionId;
        const done = await request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: options.prompt }] });
        if (!text.trim()) throw new Error('Grok Build 没有返回文字');
        finish(null, { text: text.trim(), sessionId: id, usage: done?.usage ?? done?._meta?.usage ?? null });
      } catch (error) { finish(error); }
    })();
  });
}

async function isolatedEnvironment(runtimeRoot, connectionId) {
  const home = join(runtimeRoot, 'homes', connectionId);
  const workdir = join(runtimeRoot, 'workdirs', connectionId);
  await Promise.all([mkdir(home, { recursive: true }), mkdir(workdir, { recursive: true })]);
  const sourceAuth = join(homedir(), '.grok', 'auth.json');
  const targetAuth = join(home, 'auth.json');
  try {
    const [sourceStat, targetStat] = await Promise.all([stat(sourceAuth), stat(targetAuth).catch(() => null)]);
    if (!targetStat || sourceStat.mtimeMs > targetStat.mtimeMs) await copyFile(sourceAuth, targetAuth);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...process.env, GROK_HOME: home };
}

function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/gu, '_').slice(0, 120) || 'default'; }

function runText(spawnProcess, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(output.trim() || `命令失败（${code}）`)));
  });
}
