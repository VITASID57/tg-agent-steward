import assert from 'node:assert/strict';
import test from 'node:test';
import { synthesizeRoute, VoiceService } from '../src/voice/voice-service.mjs';

test('voice profile falls back to the next real route', async () => {
  const state = {
    voiceProfiles: [{ id: 'voice', primary: { connectionId: 'bad', voiceId: 'a' }, fallbacks: [{ connectionId: 'good', voiceId: 'b' }] }],
    connections: [
      { id: 'bad', name: 'first', kind: 'elevenlabs', baseUrl: 'https://first.test', options: {} },
      { id: 'good', name: 'second', kind: 'elevenlabs', baseUrl: 'https://second.test', options: {} },
    ],
  };
  const service = new VoiceService({ controlPlaneStore: { async get() { return state; } },
    secretStore: { async read() { return 'secret'; } },
    fetchImpl: async (url) => url.includes('first')
      ? new Response('{}', { status: 500 })
      : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }) });
  const result = await service.synthesize('voice', 'hello');
  assert.equal(result.connectionId, 'good');
  assert.equal(result.audio.length, 3);
  assert.match(result.fallbackNote, /first/);
});

test('ElevenLabs uses v4 by default and keeps supported expressive tags', async () => {
  let requestBody;
  const result = await synthesizeRoute({
    connection: { kind: 'elevenlabs', baseUrl: 'https://eleven.test/v1', options: {} },
    route: { voiceId: 'voice-id' }, secret: 'secret', text: '[curious] 你好',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    },
  });
  assert.equal(requestBody.model_id, 'eleven_v4');
  assert.equal(requestBody.text, '[curious] 你好');
  assert.equal(result.mime, 'audio/mpeg');
});

test('Vertex raw 24 kHz PCM is wrapped as a playable WAV file', async () => {
  const pcm = Buffer.from([0, 0, 1, 0]);
  const result = await synthesizeRoute({
    connection: { kind: 'vertex-ai', baseUrl: 'https://vertex.test', options: {} },
    route: { model: 'gemini-tts', voiceId: 'Kore' }, secret: 'secret', text: 'hello',
    fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: {
      mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64'),
    } }] } }] }),
  });
  assert.equal(result.mime, 'audio/wav');
  assert.equal(result.audio.subarray(0, 4).toString(), 'RIFF');
  assert.equal(result.audio.readUInt32LE(24), 24_000);
  assert.deepEqual(result.audio.subarray(44), pcm);
});
