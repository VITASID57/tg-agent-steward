import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexEngine } from '../src/engines/codex/codex-engine.mjs';
import { EngineRegistry } from '../src/engines/engine-registry.mjs';

test('Codex reports its live chat catalog and a distinct built-in image route', async () => {
  let requests = 0;
  const client = { on() {}, async start() {}, async request(method) {
    requests += 1; assert.equal(method, 'model/list');
    return { data: [{ model: 'gpt-test', displayName: 'GPT Test', description: '',
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high', isDefault: true }], nextCursor: null };
  } };
  const engine = new CodexEngine(client);
  const chat = await engine.capabilities({ purpose: 'chat' });
  assert.equal(chat.source, 'live'); assert.equal(chat.models[0].id, 'gpt-test');
  const image = await engine.capabilities({ purpose: 'image' });
  assert.equal(image.source, 'built-in'); assert.equal(image.models[0].id, 'subscription-imagegen'); assert.equal(requests, 1);
});

test('failed live catalogs identify cached models as saved instead of implying a live result', async () => {
  const registry = new EngineRegistry([{ id: 'codex', async capabilities() { throw new Error('offline'); } }]);
  const result = await registry.capabilityFor({ kind: 'codex', cachedModels: ['saved-model'] });
  assert.equal(result.source, 'saved'); assert.equal(result.liveError, 'offline'); assert.equal(result.models[0].id, 'saved-model');
});
