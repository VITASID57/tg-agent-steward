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

test('Vertex model catalog uses the official regional Model Garden list endpoint', async () => {
  let requested = '';
  const engine = new HttpChatEngine({ connection: { id: 'vertex', kind: 'vertex-ai',
    baseUrl: 'https://aiplatform.googleapis.com/v1/projects/project-1/locations/global/publishers/google', cachedModels: [], options: {} },
  secret: 'google-key', sessions: sessions(), fetchImpl: async (url) => {
    requested = String(url); return Response.json({ publisherModels: [{ name: 'publishers/google/models/gemini-2.5-flash', displayName: 'Gemini Flash' }] });
  } });
  const result = await engine.capabilities({ purpose: 'chat' });
  assert.equal(result.source, 'live'); assert.equal(result.models[0].id, 'gemini-2.5-flash');
  assert.equal(requested, 'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?listAllVersions=false');
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

test('providers without a live catalog expose selectable built-in routes instead of free text', async () => {
  const engine = new HttpChatEngine({ connection: { id: 'minimax', kind: 'minimax', baseUrl: '', cachedModels: [], options: {} },
    secret: '', sessions: sessions(), fetchImpl: async () => { throw new Error('should not fetch'); } });
  const catalog = await engine.capabilities({ purpose: 'tts' });
  assert.equal(catalog.source, 'built-in'); assert.deepEqual(catalog.models.map((item) => item.id), ['speech-2.8-hd', 'speech-2.8-turbo']);
});
