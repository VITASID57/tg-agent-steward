import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpChatEngine } from '../src/engines/api/http-chat-engine.mjs';

function sessions() {
  const values = new Map(); let serial = 0;
  return {
    async create(connectionId, instructions) { const id = `s${++serial}`; values.set(id, { connectionId, instructions, messages: [] }); return id; },
    async get(id) { return structuredClone(values.get(id)); },
    async append(id, ...messages) { values.get(id).messages.push(...messages); },
  };
}

test('OpenAI-compatible connection sends the selected model and reasoning effort', async () => {
  let request;
  const engine = new HttpChatEngine({ connection: { id: 'api', kind: 'openai-compatible', baseUrl: 'https://relay.test/v1', cachedModels: [], options: {} },
    secret: 'secret', sessions: sessions(), fetchImpl: async (url, init) => { request = { url, init, body: JSON.parse(init.body) };
      return Response.json({ choices: [{ message: { content: 'hello' } }] }); } });
  const result = await engine.complete({ prompt: 'hi', instructions: 'system', settings: { model: 'model-a', effort: 'high' } });
  assert.equal(result.text, 'hello'); assert.equal(request.url, 'https://relay.test/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer secret'); assert.equal(request.body.model, 'model-a');
  assert.equal(request.body.reasoning_effort, 'high'); assert.equal(request.body.messages[0].content, 'system');
});

test('Vertex connection uses the configured publisher URL and Google key header', async () => {
  let request;
  const engine = new HttpChatEngine({ connection: { id: 'vertex', kind: 'vertex-ai', baseUrl: 'https://aiplatform.test/v1/projects/p/locations/global/publishers/google', cachedModels: [], options: {} },
    secret: 'google-key', sessions: sessions(), fetchImpl: async (url, init) => { request = { url, init, body: JSON.parse(init.body) };
      return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }); } });
  const result = await engine.complete({ prompt: 'hi', instructions: 'system', settings: { model: 'gemini-test', effort: 'high' } });
  assert.equal(result.text, 'ok'); assert.match(request.url, /publishers\/google\/models\/gemini-test:generateContent$/u);
  assert.equal(request.init.headers['x-goog-api-key'], 'google-key'); assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
});

test('Vertex connection can use an OAuth bearer token', async () => {
  let authorization = '';
  const engine = new HttpChatEngine({ connection: { id: 'vertex', kind: 'vertex-ai', baseUrl: 'https://vertex.test', cachedModels: [], options: { authType: 'bearer' } },
    secret: 'oauth-token', sessions: sessions(), fetchImpl: async (_url, init) => { authorization = init.headers.Authorization;
      return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }); } });
  await engine.complete({ prompt: 'hi', instructions: 'system', settings: { model: 'gemini-test', effort: '' } });
  assert.equal(authorization, 'Bearer oauth-token');
});

test('Vertex OAuth follows regional publisher catalog pagination without mixing built-in candidates', async () => {
  const requested = [];
  const engine = new HttpChatEngine({ connection: { id: 'vertex', kind: 'vertex-ai',
    baseUrl: 'https://aiplatform.googleapis.com/v1/projects/project-1/locations/global/publishers/google', cachedModels: [], options: { authStyle: 'bearer' } },
  secret: 'oauth', sessions: sessions(), fetchImpl: async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer oauth');
    requested.push(String(url));
    return requested.length === 1
      ? Response.json({ publisherModels: [{ name: 'publishers/google/models/gemini-3.8-flash' }], nextPageToken: 'page2' })
      : Response.json({ publisherModels: [{ name: 'publishers/google/models/gemini-4-argon' }, { name: 'publishers/google/models/gemini-3.8-flash-tts' }] });
  } });
  const result = await engine.capabilities({ purpose: 'chat' });
  assert.equal(result.source, 'live');
  assert.deepEqual(result.models.map(({ id }) => id), ['gemini-3.8-flash', 'gemini-4-argon']);
  assert.equal(requested[0], 'https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models?listAllVersions=false&pageSize=100');
  assert.match(requested[1], /pageToken=page2/u);
});

test('Vertex fallback exposes current Gemini models with valid Argon thinking levels', async () => {
  const engine = new HttpChatEngine({ connection: { id: 'vertex', kind: 'vertex-ai',
    baseUrl: 'https://aiplatform.googleapis.com/v1/projects/project-1/locations/global/publishers/google', cachedModels: [], options: {} },
  secret: 'bad-key', sessions: sessions(), fetchImpl: async () => Response.json({ error: { message: 'bad key' } }, { status: 401 }) });
  const result = await engine.capabilities({ purpose: 'chat' });
  const argon = result.models.find((item) => item.id === 'gemini-4-argon');
  assert.equal(result.source, 'built-in');
  assert.deepEqual(argon.efforts, ['low', 'medium', 'high']);
  assert.match(result.catalogNote, /重新拉取/u);
});

test('Vertex API-key refresh verifies candidates with CountTokens on the saved project endpoint', async () => {
  const checked = [];
  const engine = new HttpChatEngine({ connection: { id: 'vertex', kind: 'vertex-ai',
    baseUrl: 'https://aiplatform.googleapis.com/v1/projects/project-1/locations/global/publishers/google/models/old:generateContent',
    cachedModels: ['gemini-2.5-pro', 'gemini-custom-preview', 'claude-fable-5-2', 'gemini-3.8-flash-tts'], options: {} },
  secret: 'working-key', sessions: sessions(), fetchImpl: async (url, init) => {
    assert.match(url, /projects\/project-1\/locations\/global\/publishers\/google\/models\/[^/]+:countTokens$/u);
    assert.equal(init.headers['x-goog-api-key'], 'working-key');
    const model = /\/models\/([^:]+)/u.exec(url)[1];
    checked.push(model);
    return ['gemini-4-carbon', 'gemini-custom-preview'].includes(model)
      ? Response.json({ totalTokens: 1 }) : Response.json({}, { status: 404 });
  } });
  const initial = await engine.capabilities({ purpose: 'chat' });
  assert.equal(initial.source, 'built-in');
  assert.deepEqual(checked, []);
  assert.match(initial.catalogNote, /API Key 不能列举/u);
  const result = await engine.capabilities({ purpose: 'chat', verify: true });
  assert.equal(result.source, 'verified');
  assert.deepEqual(result.models.map(({ id }) => id), ['gemini-4-carbon', 'gemini-custom-preview']);
  assert.ok(checked.includes('gemini-2.5-pro'));
  assert.ok(!checked.includes('claude-fable-5-2') && !checked.includes('gemini-3.8-flash-tts'));
});

test('ElevenLabs voice catalog is pulled and filtered for text to speech', async () => {
  const engine = new HttpChatEngine({ connection: { id: 'voice', kind: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io', cachedModels: [], options: {} },
    secret: 'voice-key', sessions: sessions(), fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.elevenlabs.io/v1/models'); assert.equal(init.headers['xi-api-key'], 'voice-key');
      return Response.json([{ model_id: 'eleven_v4', name: 'Eleven v4', can_do_text_to_speech: true },
        { model_id: 'scribe_v2', name: 'Scribe', can_do_text_to_speech: false }]);
    } });
  const catalog = await engine.capabilities({ purpose: 'tts' });
  assert.equal(catalog.source, 'live'); assert.deepEqual(catalog.models.map((item) => item.id), ['eleven_v4']);
});

test('ElevenLabs model catalog does not duplicate v1 when the saved base URL already includes it', async () => {
  let requested = '';
  const engine = new HttpChatEngine({ connection: { id: 'voice', kind: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', cachedModels: [], options: {} },
    secret: 'voice-key', sessions: sessions(), fetchImpl: async (url) => { requested = String(url); return Response.json([]); } });
  await engine.capabilities({ purpose: 'tts' });
  assert.equal(requested, 'https://api.elevenlabs.io/v1/models');
});

test('failed ElevenLabs catalogs fall back by purpose instead of mixing cached TTS and STT models', async () => {
  const engine = new HttpChatEngine({ connection: { id: 'voice', kind: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1',
    cachedModels: ['eleven_v4', 'scribe_v2'], options: {} }, secret: 'wrong', sessions: sessions(),
  fetchImpl: async () => Response.json({ detail: { status: 'invalid_api_key' } }, { status: 401 }) });
  const tts = await engine.capabilities({ purpose: 'tts' }); const stt = await engine.capabilities({ purpose: 'stt' });
  assert.equal(tts.source, 'built-in'); assert.ok(tts.models.some((item) => item.id === 'eleven_v4'));
  assert.equal(stt.source, 'built-in'); assert.deepEqual(stt.models.map((item) => item.id), ['scribe_v2']);
});

test('providers without a live catalog expose selectable built-in routes instead of free text', async () => {
  const engine = new HttpChatEngine({ connection: { id: 'minimax', kind: 'minimax', baseUrl: '', cachedModels: [], options: {} },
    secret: '', sessions: sessions(), fetchImpl: async () => { throw new Error('should not fetch'); } });
  const catalog = await engine.capabilities({ purpose: 'tts' });
  assert.equal(catalog.source, 'built-in'); assert.deepEqual(catalog.models.map((item) => item.id), ['speech-2.8-hd', 'speech-2.8-turbo']);
});
