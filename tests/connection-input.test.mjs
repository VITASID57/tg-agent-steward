import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareConnectionInput } from '../src/control/connection-input.mjs';

test('query secrets are moved out of the public connection URL', () => {
  const result = prepareConnectionInput({ baseUrl: 'https://memory.test/mcp?token=private-value', options: {} });
  assert.equal(result.body.baseUrl, 'https://memory.test/mcp');
  assert.equal(result.body.options.authType, 'query'); assert.equal(result.body.options.authName, 'token');
  assert.equal(result.secret, 'private-value');
});

test('Vertex rejects a service-account email in the URL field', () => {
  assert.throws(() => prepareConnectionInput({ kind: 'vertex-ai', baseUrl: 'bot@example.iam.gserviceaccount.com' }),
    /服务账号邮箱不能填在这里/u);
});
