import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateImageRoute, ImageService } from '../src/image/image-service.mjs';

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from([1, 2, 3])]);

test('image profile falls back without copying connection credentials into the bot', async () => {
  const state = { imageProfiles: [{ id: 'art', primary: { connectionId: 'bad' }, fallbacks: [{ connectionId: 'good' }] }], connections: [
    { id: 'bad', name: 'bad route', kind: 'openai-compatible', baseUrl: 'https://bad.test', options: {} },
    { id: 'good', name: 'good route', kind: 'openai-compatible', baseUrl: 'https://good.test', options: {} },
  ] };
  const service = new ImageService({ controlPlaneStore: { async get() { return state; } }, secretStore: { async read() { return 'secret'; } },
    fetchImpl: async (url) => url.includes('bad') ? Response.json({ error: { message: 'down' } }, { status: 500 })
      : Response.json({ data: [{ b64_json: png.toString('base64') }] }) });
  const result = await service.generate('art', 'a moon');
  assert.equal(result.connectionId, 'good'); assert.equal(result.mime, 'image/png'); assert.match(result.fallbackNote, /bad route/);
});

test('ComfyUI route inserts the prompt, polls history, and downloads the output', async () => {
  const calls = [];
  const result = await generateImageRoute({
    connection: { kind: 'comfyui', baseUrl: 'http://comfy.test', options: {} },
    route: { options: { workflow: { 6: { inputs: { text: '' } } }, promptNodeId: '6' } }, prompt: 'red fox',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      if (String(url).endsWith('/prompt')) return Response.json({ prompt_id: 'job' });
      if (String(url).includes('/history/')) return Response.json({ job: { outputs: { 9: { images: [{ filename: 'out.png' }] } } } });
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(JSON.parse(calls[0].body).prompt['6'].inputs.text, 'red fox');
  assert.match(calls.at(-1).url, /\/view\?/); assert.deepEqual(result.image, png);
});

test('Vertex image route accepts inline image data', async () => {
  const result = await generateImageRoute({ connection: { kind: 'vertex-ai', baseUrl: 'https://vertex.test', options: { authStyle: 'api-key' } },
    route: { model: 'image-model' }, prompt: 'garden', secret: 'key',
    fetchImpl: async (_url, init) => { assert.equal(init.headers['x-goog-api-key'], 'key'); return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }); } });
  assert.equal(result.mime, 'image/png');
});

test('NovelAI route extracts an image from a ZIP response', async () => {
  const zipped = storedZip('image.png', png);
  const result = await generateImageRoute({ connection: { kind: 'novelai', baseUrl: 'https://novel.test', options: {} },
    route: { size: '832x1216' }, prompt: 'character', secret: 'token',
    fetchImpl: async (_url, init) => { assert.equal(init.headers.Authorization, 'Bearer token'); return new Response(zipped, { headers: { 'content-type': 'application/zip' } }); } });
  assert.deepEqual(result.image, png);
});

test('Codex subscription images are collected from CODEX_HOME generated_images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-home-')); const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = root;
  try {
    const result = await generateImageRoute({ connection: { kind: 'codex', options: {} }, route: {}, prompt: 'gentian',
      runImpl: async () => {
        const output = join(root, 'generated_images', 'thread', 'result.png');
        await mkdir(join(root, 'generated_images', 'thread'), { recursive: true }); await writeFile(output, png);
      } });
    assert.deepEqual(result.image, png); assert.equal(result.mime, 'image/png');
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

function storedZip(name, data) {
  const filename = Buffer.from(name); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const directoryOffset = local.length + filename.length + data.length; const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
