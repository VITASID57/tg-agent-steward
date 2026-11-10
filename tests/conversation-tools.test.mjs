import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationManager } from '../src/conversations/conversation-manager.mjs';

class MemoryFile {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async write(value) { this.value = structuredClone(value); return value; }
  async update(fn) { return this.write(await fn(await this.read())); }
}

test('enabled MCP tools complete a model tool-request loop before the Telegram reply', async () => {
  const calls = []; const engine = { async complete(input) { calls.push(input); return calls.length === 1
    ? { text: '<tool_call>{"name":"weather","arguments":{"city":"杭州"}}</tool_call>', sessionId: 's1' }
    : { text: '杭州今天晴。', sessionId: 's1' }; }, async usage() { return {}; }, async stop() { return { ok: true }; } };
  const state = { connections: [{ id: 'chat', kind: 'openai-compatible', options: {} }], profiles: [{ id: 'p', revision: 1, blocks: [] }], bots: [{
    id: 'bot', profileId: 'p', chat: { connectionId: 'chat', model: '', effort: '' }, telegram: { groupMode: false, splitParagraphs: true },
    tools: { enabled: true, maxCalls: 2 },
  }] };
  const images = [{ image: Buffer.from([1]), mime: 'image/png', extension: 'png' }];
  const toolBroker = { async listForBot() { return [
    ...Array.from({ length: 35 }, (_, i) => ({ name: `other_${i}`, inputSchema: { type: 'object', description: 'A'.repeat(500) } })),
    { name: 'weather', description: 'weather lookup', inputSchema: { type: 'object' } },
  ]; },
  async callForBot(_bot, name, args) {
    assert.equal(name, 'weather'); assert.equal(args.city, '杭州');
    return { output: { temperature: 21 }, images, imageErrors: 0 };
  } };
  const manager = new ConversationManager({ settingsStore: {}, personaStore: {}, controlPlaneStore: { async get() { return state; } },
    stateFile: new MemoryFile({ chats: {} }), engines: { async forConnection() { return engine; } }, toolBroker });
  const result = await manager.reply('42', '天气如何', { botId: 'bot' });
  const catalog = JSON.parse(calls[0].instructions.split('\n').find((line) => line.startsWith('[{"name"')));
  assert.equal(catalog.at(-1).name, 'weather');
  assert.equal(catalog.length, 36);
  assert.equal(result.text, '杭州今天晴。');
  assert.match(calls[1].prompt, /temperature/);
  assert.deepEqual(result.images, images);
});
