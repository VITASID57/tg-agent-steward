import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import readline from 'node:readline';
import { parseClaudeLine } from './parse-events.mjs';

const TURN_TIMEOUT_MS = 5 * 60_000;

export class ClaudeEngine {
  id = 'claude';

  constructor({ command = process.env.CLAUDE_COMMAND || 'claude', runtimeRoot, spawnProcess = spawn } = {}) {
    this.command = command;
    this.runtimeRoot = runtimeRoot;
    this.spawnProcess = spawnProcess;
    this.active = new Map();
    this.helpPromise = null;
  }

  async capabilities() {
    const help = await this.#help();
    const effortText = help.match(/--effort[^\n]+\(([^)]+)\)/)?.[1] ?? 'low, medium, high, xhigh, max';
    return {
      available: true,
      models: ['default', 'best', 'sonnet', 'opus', 'haiku', 'fable', 'sonnet[1m]', 'opus[1m]']
        .map((id) => ({ id, name: id, efforts: [] })),
      efforts: effortText.split(',').map((item) => item.trim()).filter(Boolean),
      supportsPromptSnapshot: help.includes('--system-prompt-snapshot'),
    };
  }

  async complete({ sessionId, prompt, settings, instructions, requestKey }) {
    const runtimeKey = safeName(requestKey || sessionId || `new-${Date.now()}`);
    const workdir = settings.runtimeMode === 'agent'
      ? (settings.workingDirectory || process.cwd())
      : join(this.runtimeRoot, 'workdirs', safeName(settings.connectionId || 'default'));
    await mkdir(workdir, { recursive: true });
    const args = await this.#args({ sessionId, settings, instructions, runtimeKey });
    const env = settings.runtimeMode === 'agent' ? process.env : {
      ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    };
    const child = this.spawnProcess(this.command, args, {
      cwd: workdir, env,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const key = requestKey || sessionId || `new:${Date.now()}`;
    this.active.set(key, child);
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })}\n`);
    try {
      return await collect(child, TURN_TIMEOUT_MS);
    } finally {
      this.active.delete(key);
    }
  }

  async compact() {
    return { ok: false, reason: 'handoff-required' };
  }

  async stop(sessionId, requestKey) {
    const child = this.active.get(requestKey) ?? this.active.get(sessionId);
    if (!child) return { ok: false, reason: 'idle' };
    child.kill();
    return { ok: true };
  }

  async usage() {
    return { rateLimits: null, accountUsage: null, note: 'Claude Code 用量以每轮 stream-json 结果为准。' };
  }

  async #args({ sessionId, settings, instructions, runtimeKey }) {
    const help = await this.#help();
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
    if (settings.model && settings.model !== 'default') args.push('--model', settings.model);
    if (settings.effort) args.push('--effort', settings.effort);
    const mode = settings.runtimeMode === 'agent' ? 'agent' : 'chat';
    const promptFlag = mode === 'agent' ? '--append-system-prompt' : '--system-prompt';
    const fileFlag = mode === 'agent' ? '--append-system-prompt-file' : '--system-prompt-file';
    if (help.includes(fileFlag)) {
      const promptPath = join(this.runtimeRoot, 'prompts', `${runtimeKey}.md`);
      await mkdir(join(this.runtimeRoot, 'prompts'), { recursive: true });
      await writeFile(promptPath, `${instructions}\n`, { mode: 0o600 });
      args.push(fileFlag, promptPath);
    } else {
      if (instructions.length > 20_000) throw new Error('当前 Claude Code 版本不支持提示词文件，人物与规则请先缩短到约 2 万字以内或升级 CLI。');
      args.push(promptFlag, instructions);
    }
    args.push('--permission-mode', 'dontAsk');
    const claude = settings.claude ?? {};
    if (mode === 'chat') {
      args.push('--setting-sources', 'project', '--tools', '');
    } else {
      args.push('--tools', claude.tools?.length ? claude.tools.join(',') : '');
    }
    if (claude.allowedTools?.length) args.push('--allowedTools', claude.allowedTools.join(','));
    if (claude.disallowedTools?.length) args.push('--disallowedTools', claude.disallowedTools.join(','));
    if (claude.mcpConfigPath) args.push('--mcp-config', claude.mcpConfigPath, '--strict-mcp-config');
    if (sessionId) args.push('--resume', sessionId);
    return args;
  }

  #help() {
    this.helpPromise ??= runHelp(this.spawnProcess, this.command);
    return this.helpPromise;
  }
}

function runHelp(spawnProcess, command) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`claude --help 失败（${code}）`)));
  });
}

function collect(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const state = { sessionId: null, parts: [], result: '', usage: null, costUsd: null, durationMs: null, error: null };
    let stderr = '';
    readline.createInterface({ input: child.stdout }).on('line', (line) => parseClaudeLine(line, state));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude Code 回复超时')); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (state.error) return reject(new Error(state.error));
      if (code !== 0) return reject(new Error(stderr.trim() || `Claude Code 已退出（${code}）`));
      resolve({ text: (state.result || state.parts.join('')).trim(), sessionId: state.sessionId, usage: state.usage,
        costUsd: state.costUsd, durationMs: state.durationMs });
    });
  });
}

function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/gu, '_').slice(0, 160) || 'default'; }
