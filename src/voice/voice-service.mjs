import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSpeechText, supportsVoiceTags, voiceTagGuide } from './speech-text.mjs';

const MAX_TEXT = 10_000;
const MAX_AUDIO = 32 * 1024 * 1024;

export class VoiceService {
  constructor({ controlPlaneStore, secretStore, fetchImpl = fetch, spawnProcess = spawn }) {
    this.controlPlaneStore = controlPlaneStore; this.secretStore = secretStore;
    this.fetch = fetchImpl; this.spawnProcess = spawnProcess;
  }

  async synthesize(voiceProfileId, text, signal) {
    const state = await this.controlPlaneStore.get();
    const profile = state.voiceProfiles.find((item) => item.id === voiceProfileId);
    if (!profile) throw new Error('声音预设已经不存在');
    const routes = [profile.primary, ...profile.fallbacks].filter(Boolean); const errors = [];
    for (const route of routes) {
      const connection = state.connections.find((item) => item.id === route.connectionId);
      if (!connection) continue;
      try {
        const secret = await this.secretStore.read(`connection:${connection.id}`);
        const result = await synthesizeRoute({ connection, route, secret, text, signal,
          fetchImpl: this.fetch, spawnProcess: this.spawnProcess });
        return { ...result, connectionId: connection.id, connectionName: connection.name,
          fallbackNote: errors.length ? errors.join('；') : '' };
      } catch (error) { errors.push(`${connection.name}：${error.message}`); }
    }
    throw new Error(errors.join('；') || '没有可用的语音线路');
  }

  async instruction(voiceProfileId) {
    const state = await this.controlPlaneStore.get(); const profile = state.voiceProfiles.find((item) => item.id === voiceProfileId);
    const route = profile?.primary; const connection = state.connections.find((item) => item.id === route?.connectionId);
    return route && connection && supportsVoiceTags(connection, route) ? voiceTagGuide(connection, route) : '';
  }
}

export async function synthesizeRoute({ connection, route, secret, text, signal, fetchImpl = fetch, spawnProcess = spawn }) {
  const content = prepareSpeechText(String(text).trim(), connection, route);
  if (!content) throw new Error('没有可生成语音的文字');
  if (content.length > MAX_TEXT) throw new Error('回复太长，暂时不能生成语音');
  if (connection.kind === 'elevenlabs') return elevenLabs(connection, route, secret, content, signal, fetchImpl);
  if (connection.kind === 'minimax') return miniMax(connection, route, secret, content, signal, fetchImpl);
  if (connection.kind === 'gpt-sovits') return gptSovits(connection, route, content, signal, fetchImpl);
  if (connection.kind === 'vertex-ai') return vertexSpeech(connection, route, secret, content, signal, fetchImpl);
  if (connection.kind === 'edge-tts') return edgeTts(connection, route, content, spawnProcess);
  throw new Error(`连接不支持语音合成：${connection.kind}`);
}

async function elevenLabs(connection, route, secret, text, signal, fetchImpl) {
  if (!secret) throw new Error('尚未保存密钥');
  if (!route.voiceId) throw new Error('尚未选择音色');
  const response = await timedFetch(fetchImpl, endpoint(connection.baseUrl, `/text-to-speech/${encodeURIComponent(route.voiceId)}`), {
    method: 'POST', signal, headers: { 'xi-api-key': secret, Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: route.model || 'eleven_v4' }),
  });
  if (!response.ok) throw await elevenLabsFailure(response);
  return binary(response, 'audio/mpeg', 'mp3');
}

async function elevenLabsFailure(response) {
  const data = await response.json().catch(() => null);
  const code = data?.detail?.status || data?.detail?.code || data?.error?.code;
  if (code === 'api_key_id_used_as_api_key') {
    return new Error('填入的是 API Key ID，不是真实 API Key；请在 ElevenLabs 创建或轮换密钥，并填写仅显示一次的 sk_… 密钥');
  }
  if (response.status === 401 || response.status === 403) return new Error('凭据未被接受');
  const message = data?.detail?.message || data?.error?.message;
  return new Error(message ? `ElevenLabs：${message}` : `语音生成失败（HTTP ${response.status}）`);
}

async function miniMax(connection, route, secret, text, signal, fetchImpl) {
  if (!secret) throw new Error('尚未保存密钥');
  if (!route.voiceId) throw new Error('尚未选择音色');
  const base = endpoint(connection.baseUrl, '/t2a_v2');
  const url = connection.options?.groupId ? `${base}?GroupId=${encodeURIComponent(connection.options.groupId)}` : base;
  const response = await timedFetch(fetchImpl, url, {
    method: 'POST', signal, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: route.model || 'speech-2.8-hd', text, stream: false, output_format: 'hex',
      voice_setting: { voice_id: route.voiceId, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 } }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.base_resp?.status_code) throw new Error(response.status === 401 || response.status === 403 ? '凭据未被接受' : '语音生成失败');
  const hex = data?.data?.audio;
  if (typeof hex !== 'string' || !hex || hex.length % 2 || !/^[\da-f]+$/iu.test(hex)) throw new Error('返回的音频编码不完整');
  return checked(Buffer.from(hex, 'hex'), 'audio/mpeg', 'mp3');
}

async function gptSovits(connection, route, text, signal, fetchImpl) {
  if (!route.referenceAudio) throw new Error('尚未配置参考音频');
  const response = await timedFetch(fetchImpl, endpoint(connection.baseUrl, '/tts'), {
    method: 'POST', signal, headers: { Accept: 'audio/wav', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, text_lang: route.language || 'zh', ref_audio_path: route.referenceAudio,
      prompt_text: route.referenceText, prompt_lang: route.language || 'zh', text_split_method: 'cut5',
      batch_size: 1, media_type: 'wav', streaming_mode: false }),
  });
  return binary(response, 'audio/wav', 'wav');
}

async function vertexSpeech(connection, route, secret, text, signal, fetchImpl) {
  if (!secret) throw new Error('尚未保存密钥');
  const model = route.model || 'gemini-2.5-flash-tts';
  const response = await timedFetch(fetchImpl, endpoint(connection.baseUrl, `/models/${encodeURIComponent(model)}:generateContent`), {
    method: 'POST', signal, headers: { ...vertexHeaders(secret, connection.options), 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: route.voiceId || 'Kore' } } } } }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '凭据未被接受' : '语音生成失败');
  const inline = data?.candidates?.[0]?.content?.parts?.find((part) => part?.inlineData?.data)?.inlineData;
  if (typeof inline?.data !== 'string') throw new Error('没有返回音频');
  const raw = Buffer.from(inline.data, 'base64'); const mime = String(inline.mimeType || '').toLowerCase();
  if (mime.includes('l16') || mime.includes('pcm')) {
    const rate = Number(mime.match(/rate[=:-](\d+)/u)?.[1]) || 24_000;
    return checked(pcmToWav(raw, rate), 'audio/wav', 'wav');
  }
  if (mime.includes('mpeg') || mime.includes('mp3')) return checked(raw, 'audio/mpeg', 'mp3');
  return checked(raw, 'audio/wav', 'wav');
}

async function edgeTts(connection, route, text, spawnProcess) {
  const folder = await mkdtemp(join(tmpdir(), 'tg-steward-tts-')); const output = join(folder, 'voice.mp3');
  try {
    await run(spawnProcess, connection.options?.command || 'edge-tts', ['--text', text, '--voice', route.voiceId || 'zh-CN-YunxiNeural', '--write-media', output]);
    return checked(await readFile(output), 'audio/mpeg', 'mp3');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

async function timedFetch(fetchImpl, url, init, timeoutMs = 45_000) {
  if (!url) throw new Error('连接地址为空');
  const controller = new AbortController(); let timedOut = false;
  const stop = () => controller.abort();
  if (init.signal?.aborted) controller.abort(); else init.signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
  catch (error) { if (timedOut) throw new Error('语音生成超时'); if (init.signal?.aborted) throw new Error('语音生成已停止'); throw new Error('语音服务暂时连不上'); }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', stop); }
}
async function binary(response, mime, extension) {
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '凭据未被接受' : '语音生成失败');
  return checked(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type')?.split(';')[0] || mime, extension);
}
function checked(audio, mime, extension) { if (!audio.length) throw new Error('返回了空音频'); if (audio.length > MAX_AUDIO) throw new Error('返回的音频过大'); return { audio, mime, extension }; }
function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44); const bytesPerSecond = sampleRate * 2;
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(bytesPerSecond, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
function endpoint(base, suffix) { const value = String(base || '').replace(/\/+$/u, ''); return value.endsWith(suffix) ? value : `${value}${suffix}`; }
function vertexHeaders(secret, options = {}) { return (options.authStyle || options.authType || 'api-key') === 'bearer' ? { Authorization: `Bearer ${secret}` } : { 'x-goog-api-key': secret }; }
function run(spawnProcess, command, args) { return new Promise((resolve, reject) => { const child = spawnProcess(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); let error = ''; child.stderr.on('data', (chunk) => { error += chunk; }); child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `TTS 已退出（${code}）`))); }); }
