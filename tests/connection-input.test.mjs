import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareConnectionInput } from '../src/control/connection-input.mjs';

test('query secrets are moved out of the public connection URL', () => {
  const result = prepareConnectionInput({ baseUrl: 'https://memory.test/mcp?token=private-value', options: {} });
  assert.equal(result.body.baseUrl, 'https://memory.test/mcp');
  assert.equal(result.body.options.authType, 'query'); assert.equal(result.body.options.authName, 'token');
  assert.equal(result.secret, 'private-value');
});
