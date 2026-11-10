import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ClaudeEngine } from '../src/engines/claude/claude-engine.mjs';

test('Claude pure chat replaces the system prompt and sends user text through stdin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'steward-claude-'));
  const calls = [];
  const engine = new ClaudeEngine({ runtimeRoot: root, spawnProcess: fakeSpawn(calls) });
  try {
    const result = await engine.complete({ prompt: '-不要把我当命令行参数', instructions: '人物设定', requestKey: 'bot:chat',
      settings: { runtimeMode: 'chat', connectionId: 'c1', model: 'default', effort: '', claude: {} } });
    assert.equal(result.text, '回复');
    const call = calls[1];
    assert.ok(call.args.includes('--system-prompt'));
    assert.ok(call.args.includes('--setting-sources'));
    assert.ok(call.args.includes('project'));
    assert.deepEqual(call.args.slice(call.args.indexOf('--strict-mcp-config'), call.args.indexOf('--mcp-config') + 2),
      ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']);
    assert.ok(!call.args.includes('--append-system-prompt'));
    assert.ok(!call.args.includes('-不要把我当命令行参数'));
    assert.equal(call.options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
    assert.equal(call.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.match(call.stdin, /不要把我当命令行参数/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Claude retries a failed CLI check and rejects an incomplete turn', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'steward-claude-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const engine = new ClaudeEngine({ runtimeRoot: root, spawnProcess: fakeSpawn(calls, { failFirstHelp: true, incompleteTurn: true }) });
  await assert.rejects(engine.capabilities(), /claude --help/u);
  assert.equal((await engine.capabilities()).available, true);
  await assert.rejects(engine.complete({ prompt: '你好', instructions: '', settings: {} }), /没有返回本轮结果/u);
});

function fakeSpawn(calls, { failFirstHelp = false, incompleteTurn = false } = {}) {
  return (_command, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new PassThrough(); child.killed = false; child.kill = () => { child.killed = true; };
    const call = { args, options, stdin: '' }; calls.push(call);
    child.stdin.on('data', (chunk) => { call.stdin += chunk.toString(); });
    process.nextTick(() => {
      if (failFirstHelp && calls.length === 1 && args.includes('--help')) {
        child.stdout.end();
        child.emit('close', 1);
        return;
      }
      child.emit('exit', 0);
      if (args.includes('--help')) child.stdout.end('--system-prompt <prompt>\n--append-system-prompt <prompt>\n--input-format <format>\n');
      else {
        child.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' })}\n`);
        if (incompleteTurn) child.stdout.end();
        else child.stdout.end(`${JSON.stringify({ type: 'result', result: '回复', usage: { input_tokens: 2 } })}\n`);
      }
      child.emit('close', 0);
    });
    return child;
  };
}
