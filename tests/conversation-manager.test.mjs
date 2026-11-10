import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationManager } from '../src/conversations/conversation-manager.mjs';
import { defaultControlPlane } from '../src/control/defaults.mjs';

class MemoryFile {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async write(value) { this.value = structuredClone(value); return value; }
  async update(fn) { return this.write(await fn(await this.read())); }
}

class FakeEngine {
  constructor(id) { this.id = id; this.calls = []; }
  async complete(input) {
    this.calls.push(input);
    if (input.prompt.includes('交接摘要')) return { text: '旧会话摘要', sessionId: input.sessionId };
    return { text: `${this.id} 回复`, sessionId: input.sessionId || `${this.id}-new`, usage: { total: 1 } };
  }
  async compact() { return { ok: true }; }
  async stop() { return { ok: true }; }
  async usage() { return {}; }
}

test('engine switch summarizes old session and starts a new one', async () => {
  let settings = { engine: 'codex', model: 'm1', effort: 'high', telegram: { splitParagraphs: true, groupMode: false } };
  const codex = new FakeEngine('codex');
  const claude = new FakeEngine('claude');
  const manager = new ConversationManager({
    settingsStore: { get: async () => structuredClone(settings) },
    personaStore: { get: async () => ({ current: { id: 'p1', text: '人物' } }) },
    stateFile: new MemoryFile({ chats: {} }),
    engines: { get: (id) => id === 'codex' ? codex : claude },
  });
  const first = await manager.reply('1', '第一句');
  assert.equal(first.sessionId, 'codex-new');
  settings = { ...settings, engine: 'claude' };
  const second = await manager.reply('1', '继续');
  assert.equal(second.sessionId, 'claude-new');
  assert.equal(codex.calls.at(-1).sessionId, 'codex-new');
  assert.doesNotMatch(claude.calls.at(-1).instructions, /旧会话摘要/);
  assert.match(claude.calls.at(-1).prompt, /【上一会话交接】\n旧会话摘要/);
});

test('diagnostics remain available before a bot has a model connection', async () => {
  const state = defaultControlPlane();
  const manager = new ConversationManager({
    settingsStore: { get: async () => ({}) },
    personaStore: { get: async () => ({ current: { id: 'unused', text: '' } }) },
    controlPlaneStore: { get: async () => structuredClone(state) },
    stateFile: new MemoryFile({ chats: {} }),
    engines: { get() { throw new Error('diagnostics should not create an engine'); } },
  });

  const result = await manager.diagnostics('bot-default');

  assert.equal(result.configured.engine, '未配置连接');
  assert.equal(result.configured.connectionId, undefined);
  assert.match(result.prompt.dynamicExample, /本轮收到的消息/);
  assert.deepEqual(result.tools, []);
});

test('a new session clears the old Claude session after an in-flight reply finishes', async () => {
  const engine = new FakeEngine('claude');
  const firstStarted = Promise.withResolvers();
  const finishFirst = Promise.withResolvers();
  const original = engine.complete.bind(engine);
  engine.complete = async (input) => {
    if (input.prompt.includes('旧窗最后一句')) {
      firstStarted.resolve();
      await finishFirst.promise;
    }
    return original(input);
  };
  const manager = new ConversationManager({
    settingsStore: { get: async () => ({ engine: 'claude', telegram: {} }) },
    personaStore: { get: async () => ({ current: { id: 'p1', text: '人物' } }) },
    stateFile: new MemoryFile({ chats: {} }),
    engines: { get: () => engine },
  });
  const oldReply = manager.reply('1', '旧窗最后一句');
  await firstStarted.promise;
  const reset = manager.newSession('1');
  const newReply = manager.reply('1', '新窗第一句');
  finishFirst.resolve();
  await Promise.all([oldReply, reset, newReply]);
  assert.equal(engine.calls.at(-1).sessionId, null);
  assert.doesNotMatch(engine.calls.at(-1).prompt, /旧窗最后一句|上一会话交接/u);
});

test('switching a WeChat Bot uses the old connection to summarize, then starts the new engine with only the summary', async () => {
  const state = defaultControlPlane();
  const bot = state.bots[0];
  bot.channel.type = 'wechat-clawbot';
  bot.chat.connectionId = 'old';
  state.connections = [
    { id: 'old', kind: 'grok-build', options: { runtimeMode: 'chat' } },
    { id: 'new', kind: 'codex', options: { runtimeMode: 'agent', workingDirectory: '/new-runtime' } },
  ];
  const old = new FakeEngine('grok-build');
  const next = new FakeEngine('codex');
  const manager = new ConversationManager({
    controlPlaneStore: { get: async () => structuredClone(state) },
    stateFile: new MemoryFile({ chats: {} }),
    engines: { forConnection: async (connection) => connection.id === 'old' ? old : next },
  });
  await manager.reply('1', '旧窗第一句', { surface: 'wechat' });
  bot.chat.connectionId = 'new';
  await manager.reply('1', '继续', { surface: 'wechat' });
  const handoff = old.calls.at(-1);
  assert.equal(handoff.sessionId, 'grok-build-new');
  assert.equal(handoff.settings.connectionId, 'old');
  assert.equal(handoff.settings.runtimeMode, 'chat');
  assert.equal(next.calls[0].sessionId, null);
  assert.match(next.calls[0].prompt, /旧会话摘要/u);
  assert.doesNotMatch(next.calls[0].prompt, /旧窗第一句/u);
});

test('opening a new session can carry the previous summary or discard it, even after changing engines', async () => {
  let engine = 'grok-build';
  const old = new FakeEngine(engine);
  const next = new FakeEngine('codex');
  const manager = new ConversationManager({
    settingsStore: { get: async () => ({ engine }) },
    personaStore: { get: async () => ({ current: { id: 'p1', text: '' } }) },
    stateFile: new MemoryFile({ chats: {} }),
    engines: { get: (id) => id === 'grok-build' ? old : next },
  });
  const carry = { carrySummary: true };
  assert.deepEqual(await manager.newSession('1', undefined, carry), { ok: false, reason: 'no-session' });
  await manager.reply('1', '旧窗原文');
  await manager.reply('2', '另一个聊天的旧窗');
  engine = 'codex';
  await manager.newSession('1', undefined, carry);
  await manager.newSession('1', undefined, carry);
  assert.equal(old.calls.length, 3);
  assert.equal(old.calls.at(-1).sessionId, 'grok-build-new');
  await manager.newSession('2', undefined, { carrySummary: false });
  await manager.reply('1', '带摘要的新窗');
  await manager.reply('2', '不带摘要的新窗');
  assert.equal(old.calls.length, 3);
  assert.equal(next.calls[0].sessionId, null);
  assert.match(next.calls[0].prompt, /旧会话摘要/u);
  assert.doesNotMatch(next.calls[0].prompt, /旧窗原文/u);
  assert.equal(next.calls[1].sessionId, null);
  assert.doesNotMatch(next.calls[1].prompt, /上一会话交接/u);
});

test('manual summary compaction preserves the old session on failure and serializes the next reply', async () => {
  const stateFile = new MemoryFile({ chats: {} });
  const engine = new FakeEngine('grok-build');
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const original = engine.complete.bind(engine);
  engine.compact = async () => ({ ok: false, reason: 'handoff-required' });
  engine.complete = async (input) => {
    if (input.prompt.includes('交接摘要')) throw new Error('provider unavailable');
    return original(input);
  };
  const manager = new ConversationManager({
    settingsStore: { get: async () => ({ engine: 'grok-build' }) },
    personaStore: { get: async () => ({ current: { id: 'p1', text: '' } }) },
    stateFile, engines: { get: () => engine },
  });
  await manager.reply('1', '旧窗');
  await assert.rejects(manager.newSession('1', undefined, { carrySummary: true }), /旧会话已保留/u);
  assert.equal((await manager.status('1')).chat.sessionId, 'grok-build-new');
  await assert.rejects(manager.compact('1'), /旧会话已保留/u);
  assert.equal((await manager.status('1')).chat.sessionId, 'grok-build-new');
  engine.complete = async (input) => {
    if (input.prompt.includes('交接摘要')) { started.resolve(); await finish.promise; }
    return original(input);
  };
  const compacting = manager.compact('1');
  await started.promise;
  const next = manager.reply('1', '续聊');
  finish.resolve();
  assert.deepEqual(await compacting, { ok: true, mode: 'handoff' });
  await next;
  assert.equal(engine.calls.at(-1).sessionId, null);
  assert.match(engine.calls.at(-1).prompt, /旧会话摘要/u);
});
