import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFile } from '../src/storage/json-file.mjs';
import { EMPTY_PERSONA_STATE, PersonaStore } from '../src/persona/persona-store.mjs';

test('persona saves versions and rollback creates a new version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-steward-persona-'));
  const store = new PersonaStore(new JsonFile(join(dir, 'persona.json'), EMPTY_PERSONA_STATE));
  const first = await store.save({ text: '第一版', source: 'test' });
  const firstId = first.current.id;
  const second = await store.save({ text: '第二版', source: 'test' });
  assert.equal(second.history[0].id, firstId);
  const rolled = await store.rollback(firstId);
  assert.equal(rolled.current.text, '第一版');
  assert.match(rolled.current.source, /^rollback:/);
  assert.notEqual(rolled.current.id, firstId);
});

test('persona rejects empty text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-steward-persona-'));
  const store = new PersonaStore(new JsonFile(join(dir, 'persona.json'), EMPTY_PERSONA_STATE));
  await assert.rejects(() => store.save({ text: '   ' }), /不能为空/);
});
