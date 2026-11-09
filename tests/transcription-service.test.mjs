import assert from 'node:assert/strict';
import test from 'node:test';
import { transcribeRoute } from '../src/voice/transcription-service.mjs';

test('Vertex transcription sends inline audio and returns only transcript text', async () => {
  const audio = Buffer.from([1, 2, 3]);
  const text = await transcribeRoute({ connection: { kind: 'vertex-ai', baseUrl: 'https://vertex.test', options: { authStyle: 'api-key' } },
    secret: 'key', audio, mime: 'audio/ogg', fetchImpl: async (_url, init) => {
      assert.equal(init.headers['x-goog-api-key'], 'key'); const body = JSON.parse(init.body);
      assert.equal(body.contents[0].parts[1].inlineData.data, audio.toString('base64'));
      return Response.json({ candidates: [{ content: { parts: [{ text: '你好呀' }] } }] });
    } });
  assert.equal(text, '你好呀');
});

test('OpenAI-compatible transcription uses multipart and selected model', async () => {
  const text = await transcribeRoute({ connection: { kind: 'openai-compatible', baseUrl: 'https://relay.test', options: { transcriptionModel: 'whisper-x' } },
    secret: 'key', audio: Buffer.from([1]), mime: 'audio/ogg', fetchImpl: async (url, init) => {
      assert.equal(url, 'https://relay.test/v1/audio/transcriptions'); assert.equal(init.body.get('model'), 'whisper-x');
      return Response.json({ text: 'transcript' });
    } });
  assert.equal(text, 'transcript');
});
