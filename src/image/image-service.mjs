import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { runProcess } from './process-runner.mjs';
import { firstImageFromZip } from './zip-image.mjs';

const MAX_IMAGE = 25 * 1024 * 1024;

export class ImageService {
  constructor({ controlPlaneStore, secretStore, fetchImpl = fetch, runImpl = runProcess }) {
    this.controlPlaneStore = controlPlaneStore; this.secretStore = secretStore; this.fetch = fetchImpl; this.run = runImpl;
  }

  async generate(profileId, prompt, signal) {
    const state = await this.controlPlaneStore.get(); const profile = state.imageProfiles.find((item) => item.id === profileId);
    if (!profile) throw new Error('找不到生图路线');
    const errors = [];
    for (const route of [profile.primary, ...profile.fallbacks].filter(Boolean)) {
      const connection = state.connections.find((item) => item.id === route.connectionId);
      if (!connection) continue;
      try {
        const secret = await this.secretStore.read(`connection:${connection.id}`);
        const result = await generateImageRoute({ connection, route, prompt, secret, signal, fetchImpl: this.fetch, runImpl: this.run });
        return { ...result, connectionId: connection.id, fallbackNote: errors.length ? errors.join('；') : null };
      } catch (error) { errors.push(`${connection.name}：${error.message}`); }
    }
    throw new Error(errors.join('；') || '没有可用的生图线路');
  }
}

export async function generateImageRoute(input) {
  const { connection } = input;
  if (connection.kind === 'openai-compatible') return openAiImage(input);
  if (connection.kind === 'vertex-ai') return vertexImage(input);
  if (connection.kind === 'comfyui') return comfyImage(input);
  if (connection.kind === 'novelai') return novelAiImage(input);
  if (connection.kind === 'codex' || connection.kind === 'grok-build') return subscriptionImage(input);
  throw new Error(`不支持的生图连接：${connection.kind}`);
}

async function openAiImage({ connection, route, prompt, secret, signal, fetchImpl }) {
  const response = await timedFetch(fetchImpl, endpoint(connection.baseUrl, '/v1/images/generations'), {
    method: 'POST', signal, headers: jsonHeaders(secret, connection.options),
    body: JSON.stringify({ model: route.model || undefined, prompt, size: route.size || undefined,
      response_format: 'b64_json', ...(route.options || {}) }),
  });
  const data = await response.json().catch(() => null); assertResponse(response, data);
  const item = data?.data?.[0];
  if (item?.b64_json) return checked(Buffer.from(item.b64_json, 'base64'));
  if (item?.url) return downloadImage(fetchImpl, item.url, signal);
  throw new Error('接口没有返回图片');
}

async function vertexImage({ connection, route, prompt, secret, signal, fetchImpl }) {
  const model = route.model || 'gemini-2.5-flash-image';
  const url = connection.baseUrl.includes(':generateContent') ? connection.baseUrl : endpoint(connection.baseUrl, `/models/${model}:generateContent`);
  const response = await timedFetch(fetchImpl, url, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders(secret, connection.options) },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(route.options || {}) } }),
  });
  const data = await response.json().catch(() => null); assertResponse(response, data);
  const inline = data?.candidates?.[0]?.content?.parts?.find((part) => part?.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('Vertex 没有返回图片');
  return checked(Buffer.from(inline.data, 'base64'), inline.mimeType);
}

async function novelAiImage({ connection, route, prompt, secret, signal, fetchImpl }) {
  const url = connection.baseUrl || 'https://image.novelai.net/ai/generate-image';
  const options = route.options || {}; const [width, height] = parseSize(route.size);
  const response = await timedFetch(fetchImpl, url, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ input: prompt, model: route.model || 'nai-diffusion-4-full', action: 'generate',
      parameters: { width, height, scale: 5, sampler: 'k_euler_ancestral', steps: 28, n_samples: 1, ...options } }),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '凭据未被接受' : `NovelAI HTTP ${response.status}`);
  const type = response.headers.get('content-type') || ''; const raw = Buffer.from(await response.arrayBuffer());
  return checked(type.includes('zip') ? firstImageFromZip(raw) : raw, type);
}

async function comfyImage({ connection, route, prompt, signal, fetchImpl }) {
  const workflow = structuredClone(route.options?.workflow || connection.options?.workflow || {});
  const nodeId = String(route.options?.promptNodeId || connection.options?.promptNodeId || '');
  const inputKey = route.options?.promptInputKey || connection.options?.promptInputKey || 'text';
  if (!nodeId || !workflow[nodeId]?.inputs) throw new Error('ComfyUI 需要工作流与正向提示词节点');
  workflow[nodeId].inputs[inputKey] = prompt;
  const queued = await timedFetch(fetchImpl, endpoint(connection.baseUrl, '/prompt'), { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) });
  const queuedData = await queued.json().catch(() => null); assertResponse(queued, queuedData);
  const promptId = queuedData?.prompt_id; if (!promptId) throw new Error('ComfyUI 没有返回任务 ID');
  const deadline = Date.now() + (Number(connection.options?.timeoutMs) || 180_000);
  while (Date.now() < deadline) {
    const history = await timedFetch(fetchImpl, endpoint(connection.baseUrl, `/history/${promptId}`), { signal }, 15_000);
    const data = await history.json().catch(() => ({})); const item = data?.[promptId];
    const output = pickComfyImage(item?.outputs, route.options?.outputNodeId);
    if (output) {
      const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'output' });
      return downloadImage(fetchImpl, `${String(connection.baseUrl).replace(/\/+$/u, '')}/view?${params}`, signal);
    }
    await wait(800, signal);
  }
  throw new Error('ComfyUI 生图超时');
}

async function subscriptionImage({ connection, prompt, signal, runImpl }) {
  const folder = await mkdtemp(join(tmpdir(), 'tg-steward-image-'));
  try {
    const env = stripApiCredentials(process.env); const command = connection.options?.command || (connection.kind === 'codex' ? 'codex' : 'grok');
    const instruction = `Generate exactly one image for this prompt: ${prompt}\nSave the final PNG or JPEG in the current working directory.`;
    const args = connection.kind === 'codex'
      ? ['exec', '-s', 'workspace-write', '-C', folder, '--skip-git-repo-check', '--ephemeral', `$imagegen ${instruction}`]
      : ['--cwd', folder, '-p', `Use Grok Imagine. ${instruction}`];
    await runImpl(command, args, { cwd: folder, env, signal, timeoutMs: Number(connection.options?.timeoutMs) || 240_000 });
    const files = await findImages(folder); if (!files.length) throw new Error('订阅生图完成但没有找到输出图片');
    return checked(await readFile(files[0]));
  } finally { await rm(folder, { recursive: true, force: true }); }
}

async function findImages(folder) {
  const items = await readdir(folder, { withFileTypes: true, recursive: true });
  return items.filter((item) => item.isFile() && ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(item.name).toLowerCase()))
    .map((item) => join(item.parentPath || item.path || folder, item.name));
}
function stripApiCredentials(env) { const next = { ...env }; for (const key of Object.keys(next)) if (/(?:API_KEY|TOKEN|SECRET)$/iu.test(key)) delete next[key]; return next; }
function parseSize(value) { const match = String(value || '').match(/^(\d{2,5})x(\d{2,5})$/u); return match ? [Number(match[1]), Number(match[2])] : [1024, 1024]; }
function pickComfyImage(outputs, preferred) { const groups = outputs && typeof outputs === 'object' ? outputs : {}; const node = preferred ? groups[preferred] : null; return node?.images?.[0] || Object.values(groups).find((item) => item?.images?.length)?.images[0] || null; }
function jsonHeaders(secret, options = {}) { return { 'Content-Type': 'application/json', ...authHeaders(secret, options) }; }
function authHeaders(secret, options = {}) { if (!secret) return {}; const style = options.authStyle || options.authType || 'bearer'; if (style === 'api-key') return { 'x-goog-api-key': secret }; if (style === 'header') return { [options.authName || 'X-API-Key']: secret }; return { Authorization: `Bearer ${secret}` }; }
function assertResponse(response, data) { if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '凭据未被接受' : (data?.error?.message || `HTTP ${response.status}`)); }
async function downloadImage(fetchImpl, url, signal) { const response = await timedFetch(fetchImpl, url, { signal }); if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`); return checked(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type')); }
function checked(image, hintedMime = '') { if (!image.length) throw new Error('返回了空图片'); if (image.length > MAX_IMAGE) throw new Error('返回图片超过 25 MB'); const mime = detectMime(image, hintedMime); if (!mime) throw new Error('返回内容不是可识别的图片'); return { image, mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] }; }
function detectMime(buffer, hinted = '') { if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'; if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'; if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp'; return /^image\/(?:png|jpeg|webp)$/u.test(hinted) ? hinted : ''; }
function endpoint(base, suffix) { const value = String(base || '').replace(/\/+$/u, ''); return value.endsWith(suffix) ? value : `${value}${suffix}`; }
function wait(ms, signal) { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('生图已停止')); }, { once: true }); }); }
async function timedFetch(fetchImpl, url, init, timeoutMs = 60_000) { if (!url) throw new Error('连接地址为空'); const controller = new AbortController(); const stop = () => controller.abort(); init.signal?.addEventListener('abort', stop, { once: true }); const timer = setTimeout(stop, timeoutMs); try { return await fetchImpl(url, { ...init, signal: controller.signal }); } catch (error) { if (controller.signal.aborted) throw new Error(init.signal?.aborted ? '生图已停止' : '生图连接超时'); throw error; } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', stop); } }
