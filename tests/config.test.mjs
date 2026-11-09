import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/config/validate.mjs';

test('settings normalize unsafe and malformed values', () => {
  const value = normalizeSettings({
    engine: 'claude', model: 'opus', effort: 'high',
    codex: { sandbox: 'full-access', approvalPolicy: 'always' },
    telegram: { allowedChatIds: [123, '123', '', null], mergeDelayMs: 99_999 },
  });
  assert.equal(value.engine, 'claude');
  assert.equal(value.codex.sandbox, 'read-only');
  assert.equal(value.codex.approvalPolicy, 'never');
  assert.deepEqual(value.telegram.allowedChatIds, ['123']);
  assert.equal(value.telegram.mergeDelayMs, 10_000);
});
