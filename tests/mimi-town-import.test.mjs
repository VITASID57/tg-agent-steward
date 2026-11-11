import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiHandler } from '../src/api/api-handler.mjs';
import { createMimiTownImport, mimiTownTokenPath } from '../src/api/mimi-town-import.mjs';
import { ControlPlaneStore } from '../src/control/control-plane-store.mjs';
import { bearerAuth } from '../src/http/auth.mjs';
import { startHttpServer } from '../src/http/http-server.mjs';
import { SecretStore } from '../src/storage/secret-store.mjs';

function memoryFile() {
  let value = {};
  return {
    async read() { return structuredClone(value); },
    async update(transform) { value = await transform(structuredClone(value)); return structuredClone(value); },
  };
}

test('the town import token only checks status and creates new profiles', async (t) => {
  const credentials = memoryFile();
  const controlPlaneStore = new ControlPlaneStore(memoryFile());
  const secretStore = new SecretStore(credentials);
  const mimiTown = createMimiTownImport({ controlPlaneStore, secretStore, now: () => new Date('2026-11-11T12:00:00Z') });
  const logs = [];
  const server = await startHttpServer({
    host: '127.0.0.1', port: 0, allowedOrigins: new Set(), mimiTown, authenticate: bearerAuth('fixture-admin'),
    apiHandler: createApiHandler({ mimiTown, controlPlaneStore, secretStore }), serveStatic: () => false,
    logger: { error: value => logs.push(value) },
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const statusPath = '/api/integrations/mimi-town/status';
  const profilePath = '/api/integrations/mimi-town/profiles';
  const call = (path, { method = 'GET', token, body, source } = {}) => fetch(`${origin}${path}`, {
    method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(source ? { Origin: source } : {}),
    }, body: body ? JSON.stringify(body) : undefined,
  });

  const health = await call('/healthz', { source: 'null' });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), 'null');
  assert.equal((await call(statusPath, { source: 'null', method: 'OPTIONS' })).status, 204);
  assert.equal((await call('/api/control-plane', { source: 'null' })).headers.get('access-control-allow-origin'), null);
  assert.equal((await call(mimiTownTokenPath, { method: 'POST', source: 'null', token: 'fixture-admin' })).status, 403);

  const manage = (method) => call(mimiTownTokenPath, { method, token: 'fixture-admin' });
  const { token } = await (await manage('POST')).json();
  assert.match(token, /^mt_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await (await manage('GET')).json(), { configured: true });
  assert.equal(JSON.stringify(await credentials.read()).includes(token), false);
  assert.equal((await call(statusPath, { token, source: 'null' })).status, 200);
  assert.equal((await call(statusPath, { token: 'fixture-admin', source: 'null' })).status, 401);
  assert.equal((await call(mimiTownTokenPath, { method: 'POST', token })).status, 401);
  assert.equal((await call('/api/control-plane', { token })).status, 401);

  await controlPlaneStore.get();
  const before = await controlPlaneStore.get();
  const importPack = (body) => call(profilePath, { method: 'POST', token, source: 'null', body });
  const resident = { residentId: 'resident-test', displayName: '样例居民' };
  assert.equal((await importPack({ schemaVersion: 1, resident })).status, 400);
  const body = { schemaVersion: 1, resident, persona: { personality: '安静', appearance: '  ', aboutUser: '朋友' },
    id: before.profiles[0].id, chat: { model: 'ignored' } };
  const response = await importPack(body);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('access-control-allow-origin'), 'null');
  const imported = await response.json();
  const repeated = await (await importPack(body)).json();
  assert.notEqual(imported.id, repeated.id);
  assert.equal(imported.name, '样例居民 · 来自棉棉云小镇 · 2026-11-11');
  const after = await controlPlaneStore.get();
  assert.deepEqual(after.bots, before.bots);
  assert.deepEqual(after.profiles.slice(0, before.profiles.length), before.profiles);
  assert.deepEqual(after.profiles.find(({ id }) => id === imported.id).blocks.map(({ title, body }) => [title, body]),
    [['性格', '安静'], ['关于你', '朋友']]);

  const rotated = (await (await manage('POST')).json()).token;
  assert.equal((await call(statusPath, { token, source: 'null' })).status, 401);
  assert.equal((await call(statusPath, { token: rotated, source: 'null' })).status, 200);
  await manage('DELETE');
  assert.equal((await call(statusPath, { token: rotated, source: 'null' })).status, 401);
  assert.equal(logs.some((entry) => entry.includes(token) || entry.includes(rotated)), false);
});
