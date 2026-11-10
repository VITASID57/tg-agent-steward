import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { CodexEngine } from '../src/engines/codex/codex-engine.mjs';

test('Codex compaction waits for the completed turn after the start acknowledgement', async () => {
  const client = new EventEmitter();
  const acknowledged = Promise.withResolvers();
  client.start = async () => {};
  client.request = async (method, params) => {
    assert.equal(params.threadId, 'thread-test');
    if (method === 'thread/resume') return {};
    assert.equal(method, 'thread/compact/start');
    acknowledged.resolve();
    return {};
  };
  const engine = new CodexEngine(client);
  let finished = false;
  const result = engine.compact('thread-test').then((value) => { finished = true; return value; });
  await acknowledged.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  client.emit('turn/completed', { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed', items: [] } });
  assert.deepEqual(await result, { ok: true, mode: 'native' });
});
