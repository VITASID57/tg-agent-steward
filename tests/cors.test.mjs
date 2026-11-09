import assert from 'node:assert/strict';
import test from 'node:test';
import { corsHeaders } from '../src/http/cors.mjs';

test('browser requests from the address used to open the steward are accepted', () => {
  for (const host of ['127.0.0.1:8798', '192.168.31.242:8798']) {
    const origin = `http://${host}`;
    const headers = corsHeaders({ headers: { origin, host } }, new Set());
    assert.equal(headers['access-control-allow-origin'], origin);
  }
});

test('an unrelated web origin is still rejected unless explicitly allowed', () => {
  const request = { headers: { origin: 'https://unrelated.example', host: '192.168.31.242:8798' } };
  assert.throws(() => corsHeaders(request, new Set()), /不允许的网页来源/);
  assert.equal(corsHeaders(request, new Set(['https://unrelated.example']))['access-control-allow-origin'], 'https://unrelated.example');
});
