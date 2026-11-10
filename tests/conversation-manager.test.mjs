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
