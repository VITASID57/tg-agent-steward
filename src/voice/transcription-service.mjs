import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_AUDIO = 25 * 1024 * 1024;

export class TranscriptionService {
  constructor({ controlPlaneStore, secretStore, fetchImpl = fetch, spawnProcess = spawn }) {
    this.controlPlaneStore = controlPlaneStore; this.secretStore = secretStore; this.fetch = fetchImpl; this.spawn = spawnProcess;
  }

  async transcribe(connectionId, audio, mime = 'audio/ogg', signal) {
    if (!Buffer.isBuffer(audio) || !audio.length) throw new Error('语音为空');
    if (audio.length > MAX_AUDIO) throw new Error('语音超过 25 MB');
    const state = await this.controlPlaneStore.get(); const connection = state.connections.find((item) => item.id === connectionId);
    if (!connection?.capabilities?.includes('stt')) throw new Error('转写连接不存在或不支持语音识别');
    const secret = await this.secretStore.read(`connection:${connection.id}`);
    return transcribeRoute({ connection, secret, audio, mime, signal, fetchImpl: this.fetch, spawnProcess: this.spawn });
  }
}

export async function transcribeRoute(input) {
  if (input.connection.kind === 'elevenlabs') return elevenLabs(input);
  if (input.connection.kind === 'openai-compatible') return openAi(input);
  if (input.connection.kind === 'vertex-ai') return vertex(input);
  if (input.connection.kind === 'whisper-local') return localWhisper(input);
  throw new Error(`不支持的转写连接：${input.connection.kind}`);
}

async function elevenLabs({ connection, secret, audio, mime, signal, fetchImpl }) {
  const form = audioForm(audio, mime); form.set('model_id', connection.options?.transcriptionModel || 'scribe_v2');
  const response = await timedFetch(fetchImpl, endpoint(connection.baseUrl || 'https://api.elevenlabs.io', '/v1/speech-to-text'), {
    method: 'POST', signal, headers: secret ? { 'xi-api-key': secret } : {}, body: form,
  });
  return responseText(response, (data) => data?.text);
}

async function openAi({ connection, secret, audio, mime, signal, fetchImpl }) {
  const form = audioForm(audio, mime); form.set('model', connection.options?.transcriptionModel || 'whisper-1');
  if (connection.options?.language) form.set('language', connection.options.language);
  const response = await timedFetch(fetchImpl, endpoint(connection.baseUrl, '/v1/audio/transcriptions'), {
    method: 'POST', signal, headers: secret ? { Authorization: `Bearer ${secret}` } : {}, body: form,
  });
  return responseText(response, (data) => data?.text);
}

async function vertex({ connection, secret, audio, mime, signal, fetchImpl }) {
  const model = connection.options?.transcriptionModel || 'gemini-2.5-flash';
  const url = connection.baseUrl.includes(':generateContent') ? connection.baseUrl : endpoint(connection.baseUrl, `/models/${model}:generateContent`);
  const headers = { 'Content-Type': 'application/json', ...vertexHeaders(secret, connection.options) };
  const response = await timedFetch(fetchImpl, url, { method: 'POST', signal, headers,
    body: JSON.stringify({ contents: [{ role: 'user', parts: [
      { text: '请准确转写这段语音。只输出转写正文，不要解释；保留原语言。' },
      { inlineData: { mimeType: mime, data: audio.toString('base64') } },
    ] }] }),
  });
  return responseText(response, (data) => data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim());
}

async function localWhisper({ connection, audio, mime, spawnProcess }) {
  const folder = await mkdtemp(join(tmpdir(), 'tg-steward-stt-')); const input = join(folder, `input.${extension(mime)}`);
  const output = join(folder, 'result.txt');
  try {
    await writeFile(input, audio);
    const command = connection.options?.command || 'whisper';
    const args = Array.isArray(connection.options?.args) && connection.options.args.length
      ? connection.options.args.map((item) => String(item).replaceAll('{input}', input).replaceAll('{output}', output))
      : [input, '--model', connection.options?.transcriptionModel || 'small', '--output_format', 'txt', '--output_dir', folder];
    await run(spawnProcess, command, args);
    const configured = connection.options?.args?.some((item) => String(item).includes('{output}'));
    const path = configured ? output : join(folder, 'input.txt');
    const text = (await readFile(path, 'utf8')).trim(); if (!text) throw new Error('本地 Whisper 没有返回文字'); return text;
  } finally { await rm(folder, { recursive: true, force: true }); }
}

function audioForm(audio, mime) { const form = new FormData(); form.set('file', new Blob([audio], { type: mime }), `voice.${extension(mime)}`); return form; }
function extension(mime) { if (mime.includes('wav')) return 'wav'; if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'; if (mime.includes('webm')) return 'webm'; return 'ogg'; }
async function responseText(response, pick) { const data = await response.json().catch(() => null); if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '凭据未被接受' : (data?.detail?.message || data?.error?.message || `转写 HTTP ${response.status}`)); const text = pick(data); if (!text) throw new Error('转写服务没有返回文字'); return text; }
function endpoint(base, suffix) { const value = String(base || '').replace(/\/+$/u, ''); return value.endsWith(suffix) ? value : `${value}${suffix}`; }
function vertexHeaders(secret, options = {}) { return (options.authStyle || options.authType || 'api-key') === 'bearer' ? { Authorization: `Bearer ${secret}` } : { 'x-goog-api-key': secret }; }
async function timedFetch(fetchImpl, url, init) { if (!url) throw new Error('转写地址为空'); const controller = new AbortController(); const stop = () => controller.abort(); init.signal?.addEventListener('abort', stop, { once: true }); const timer = setTimeout(stop, 90_000); try { return await fetchImpl(url, { ...init, signal: controller.signal }); } catch (error) { if (controller.signal.aborted) throw new Error(init.signal?.aborted ? '转写已停止' : '转写超时'); throw error; } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', stop); } }
function run(spawnProcess, command, args) { return new Promise((resolve, reject) => { const child = spawnProcess(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); let stderr = ''; child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); }); child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Whisper 已退出（${code}）`))); }); }
