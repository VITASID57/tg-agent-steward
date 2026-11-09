import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeEventStore } from '../src/runtime/runtime-event-store.mjs';

function memoryFile(initial = { bots: {} }) {
  let value = structuredClone(initial);
  return {
    async read() { return structuredClone(value); },
    async update(mutator) { value = structuredClone(await mutator(structuredClone(value))); return value; },
  };
}

test('runtime timeline redacts secrets, deduplicates noise, and removes bot history', async () => {
  let now = new Date('2026-11-09T10:00:00Z'); const file = memoryFile();
  const store = new RuntimeEventStore(file, { now: () => now });
  await store.record('bot-a', { kind: 'reply', status: 'error', title: '发送失败', detail: 'Bearer abc.def secret' });
  now = new Date('2026-11-09T10:00:30Z');
  await store.record('bot-a', { kind: 'reply', status: 'error', title: '发送失败', detail: 'Bearer abc.def secret' });
  const events = await store.list('bot-a');
  assert.equal(events.length, 1); assert.match(events[0].detail, /\[已隐藏\]/u); assert.doesNotMatch(events[0].detail, /abc\.def/u);
  await store.removeBot('bot-a'); assert.deepEqual(await store.list('bot-a'), []);
});
