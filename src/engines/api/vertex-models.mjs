const CHAT = [
  ['gemini-4-carbon', 'Gemini 4 Carbon'], ['gemini-4-argon', 'Gemini 4 Argon'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.7-flash', 'Gemini 3.7 Flash'],
  ['gemini-3.6-flash', 'Gemini 3.6 Flash'], ['gemini-3.5-flash', 'Gemini 3.5 Flash'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'], ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro'],
  ['gemini-3-flash-preview', 'Gemini 3 Flash'], ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'],
];
const CANDIDATES = {
  chat: CHAT, stt: CHAT,
  tts: [['gemini-3.8-flash-tts'], ['gemini-3.8-flash-lite-tts'], ['gemini-2.5-flash-tts'], ['gemini-2.5-pro-tts']],
  image: [['gemini-nano-banana-2.1'], ['gemini-3.1-flash-image'], ['gemini-3.1-flash-lite-image'],
    ['gemini-3-pro-image'], ['gemini-2.5-flash-image']],
};
const STANDARD_EFFORTS = ['low', 'medium', 'high'];
const PROBE_LIMIT = 40;

export async function vertexCapabilities({ connection, secret, fetchImpl, purpose, verify }) {
  const candidates = merge((CANDIDATES[purpose] || []).map(([id, name]) => ({ id, name })),
    (connection.cachedModels || []).filter((id) => matchesPurpose(id, purpose)).map((id) => ({ id })));
  let models = candidates;
  let source = 'built-in';
  let liveError = '';
  let catalogNote = '显示 Vertex 候选模型。点「重新拉取」可用当前连接检查模型。';
  if (connection.baseUrl && secret) {
    if (authType(connection) === 'bearer') {
      try {
        const listed = await publisherModels(connection, secret, fetchImpl, purpose);
        if (listed.length) {
          models = listed;
          source = 'live';
          catalogNote = '已读取 Google 发布者目录，项目权限以实际调用为准。';
        }
      } catch { liveError = 'Google 发布者目录未能读取'; }
    } else {
      catalogNote = 'API Key 不能列举 Google 发布者目录。点「重新拉取」可用当前连接检查候选模型。';
    }
    if (verify) {
      const checked = await probeModels(merge(candidates, models), connection, secret, fetchImpl);
      models = checked.models;
      source = 'verified';
      liveError = checked.transient ? '有部分模型未能完成检查' : '';
      catalogNote = models.length
        ? `通过当前连接的免费 token 计数检查（${checked.attempted} 个候选）。实际生成权限和配额以调用为准。`
        : `本次检查的 ${checked.attempted} 个候选均未返回 token 计数。已保存的模型仍可保留。`;
    }
  }
  const efforts = purpose === 'chat' ? STANDARD_EFFORTS : [];
  return { available: true, source, liveError, catalogNote, supportsManualModel: false, efforts,
    models: models.map((model) => ({ id: model.id, name: model.name || model.id,
      efforts: /^gemini-2\./u.test(model.id) ? [] : efforts })) };
}

export function vertexModelTarget(connection, secret, model, method) {
  const url = new URL(connection.baseUrl);
  const path = url.pathname.replace(/\/models(?:\/[^/]+)?\/?$/u, '').replace(/\/+$/u, '');
  url.pathname = `${path}/models/${encodeURIComponent(model)}:${method}`;
  const headers = withAuth(url, connection, secret);
  return { url: url.href, headers };
}

function withAuth(url, connection, secret) {
  if (!secret) return {};
  const type = authType(connection);
  if (type === 'bearer') return { Authorization: `Bearer ${secret}` };
  if (type === 'query') { url.searchParams.set(connection.options?.authName || 'key', secret); return {}; }
  if (type === 'header') return { [connection.options?.authName || 'X-API-Key']: secret };
  return { 'x-goog-api-key': secret };
}

function authType(connection) { return connection.options?.authStyle || connection.options?.authType || 'api-key'; }

async function publisherModels(connection, secret, fetchImpl, purpose) {
  const base = new URL(connection.baseUrl);
  if (base.protocol !== 'https:' || !/^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/u.test(base.hostname)) return [];
  const location = base.pathname.match(/\/locations\/([\w-]+)/u)?.[1];
  const host = location && location !== 'global' ? `${location}-aiplatform.googleapis.com` : 'us-central1-aiplatform.googleapis.com';
  const url = new URL(`https://${host}/v1/publishers/google/models?listAllVersions=false&pageSize=100`);
  const headers = withAuth(url, connection, secret);
  const models = [];
  for (let page = 0; page < 10; page += 1) {
    const response = await fetchImpl(url.href, { headers, redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('Vertex 模型目录读取失败');
    const body = await response.json();
    for (const item of body.publisherModels || body.models || []) {
      const id = String(item.name || item.id || '').split('/').at(-1);
      if (matchesPurpose(id, purpose)) models.push({ id, name: item.displayName });
    }
    if (!body.nextPageToken) break;
    url.searchParams.set('pageToken', body.nextPageToken);
  }
  return merge(models, []);
}

async function probeModels(candidates, connection, secret, fetchImpl) {
  const selected = candidates.slice(0, PROBE_LIMIT);
  const models = [];
  let transient = false;
  for (let index = 0; index < selected.length; index += 6) {
    const group = selected.slice(index, index + 6);
    const results = await Promise.all(group.map(async (model) => {
      try {
        const { url, headers } = vertexModelTarget(connection, secret, model.id, 'countTokens');
        const response = await fetchImpl(url, { method: 'POST', redirect: 'error',
          signal: AbortSignal.timeout(5_000), headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{"contents":[{"role":"user","parts":[{"text":"Hi"}]}]}' });
        if (response.status === 429 || response.status >= 500) transient = true;
        return response.ok && Number.isFinite((await response.json()).totalTokens) ? model : null;
      } catch { transient = true; return null; }
    }));
    models.push(...results.filter(Boolean));
  }
  return { models, transient, attempted: selected.length };
}

function matchesPurpose(id, purpose) {
  if (purpose === 'image' && /^imagen-[\w.-]+$/u.test(id)) return true;
  if (!/^gemini-[\w.-]+$/u.test(id)) return false;
  if (purpose === 'image') return /image|nano-banana/u.test(id);
  if (purpose === 'tts') return /-tts(?:-|$)/u.test(id);
  return !/(?:image|nano-banana|-tts(?:-|$)|embedding|live|omni|robotics|cyber)/u.test(id);
}

function merge(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback].filter(({ id }) => !seen.has(id) && seen.add(id));
}
