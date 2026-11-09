import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonFile } from '../src/storage/json-file.mjs';

test('JsonFile serializes concurrent updates instead of losing one', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tg-steward-json-'));
  const path = join(folder, 'state.json'); const file = new JsonFile(path, { values: [] });
  await Promise.all(Array.from({ length: 20 }, (_, index) => file.update(async (state) => {
    await new Promise((resolve) => setTimeout(resolve, index % 3));
    return { values: [...state.values, index] };
  })));
  const state = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(state.values.length, 20);
  assert.deepEqual([...state.values].sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index));
});
