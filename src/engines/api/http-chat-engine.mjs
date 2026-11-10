const TIMEOUT_MS = 5 * 60_000;

export class HttpChatEngine {
  constructor({ connection, secret, sessions, fetchImpl = fetch }) {
    this.id = connection.kind;
    this.connection = connection;
    this.secret = secret;
    this.sessions = sessions;
    this.fetch = fetchImpl;
    this.active = new Map();
  }

  async capabilities({ purpose = 'chat' } = {}) {
    let models = []; let source = 'saved'; let liveError = ''; let catalogNote = '';
    try {
      models = await this.#liveModels(purpose);
      if (models.length) source = 'live';
    } catch (error) {
      liveError = error.message;
      if (this.connection.kind === 'vertex-ai' && /API keys are not supported by this API/iu.test(liveError)) {
        catalogNote = 'Google 的实时模型目录只接受 OAuth；API Key 仍可用于模型调用，当前显示内置 Vertex 模型。';
      }
    }
    if (this.connection.kind === 'vertex-ai') models = mergeModels(models, builtInModels(this.connection.kind, purpose));
    if (!models.length) models = this.connection.cachedModels.map((id) => ({ id, name: id }));
    if (!models.length) { models = builtInModels(this.connection.kind, purpose); source = 'built-in'; }
    else if (this.connection.kind === 'vertex-ai' && source !== 'live') source = 'built-in';
    const efforts = this.connection.kind === 'vertex-ai'
      ? ['minimal', 'low', 'medium', 'high'] : ['low', 'medium', 'high'];
    return { available: true, models: models.map((item) => ({ id: item.id, name: item.name || item.id,
      efforts: item.efforts || (purpose === 'chat' ? efforts : []) })), efforts: purpose === 'chat' ? efforts : [],
      supportsManualModel: false, source, liveError, catalogNote };
  }

  async complete({ sessionId, prompt, settings, instructions }) {
    let id = sessionId; let session = id ? await this.sessions.get(id) : null;
    if (!session || session.connectionId !== this.connection.id) {
      id = await this.sessions.create(this.connection.id, instructions);
      session = await this.sessions.get(id);
    }
    const controller = new AbortController(); this.active.set(id, controller);
    try {
      const text = await this.#request({ prompt, settings, session, signal: controller.signal });
      await this.sessions.append(id, { role: 'user', content: prompt }, { role: 'assistant', content: text });
      return { text, sessionId: id, usage: null };
    } finally { this.active.delete(id); }
  }

  async compact() { return { ok: false, reason: 'handoff-required' }; }
  async stop(sessionId) {
    const controller = this.active.get(sessionId) ?? [...this.active.values()][0];
    if (!controller) return { ok: false, reason: 'idle' };
    controller.abort(); return { ok: true };
  }
  async usage() { return { rateLimits: null, accountUsage: null, note: '这个 API 连接没有提供统一的账户额度接口。' }; }

  async #request({ prompt, settings, session, signal }) {
    if (!this.connection.baseUrl) throw new Error('API 连接还没有填写地址');
    if (!this.secret) throw new Error('API 连接还没有保存密钥');
    if (!settings.model) throw new Error('API 连接需要指定模型');
    if (this.connection.kind === 'vertex-ai') return this.#vertex(prompt, settings, session, signal);
    if (this.connection.kind === 'anthropic-compatible') return this.#anthropic(prompt, settings, session, signal);
    return this.#openAi(prompt, settings, session, signal);
  }

  async #openAi(prompt, settings, session, signal) {
    const style = this.connection.options?.apiStyle === 'responses' ? 'responses' : 'chat-completions';
    const url = endpoint(this.connection.baseUrl, style === 'responses' ? '/responses' : '/chat/completions');
    const messages = [{ role: 'system', content: session.instructions }, ...session.messages, { role: 'user', content: prompt }];
    const body = style === 'responses'
      ? { model: settings.model, input: messages, ...(settings.effort ? { reasoning: { effort: settings.effort } } : {}) }
      : { model: settings.model, messages, ...(settings.effort ? { reasoning_effort: settings.effort } : {}) };
    const data = await requestJson(this.fetch, url, {
      method: 'POST', headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, signal);
    const text = style === 'responses' ? responseText(data) : data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('API 没有返回可用文字');
    return text.trim();
  }

  async #anthropic(prompt, settings, session, signal) {
    const data = await requestJson(this.fetch, endpoint(this.connection.baseUrl, '/messages'), {
      method: 'POST', headers: { 'x-api-key': this.secret, 'anthropic-version': this.connection.options?.anthropicVersion || '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, max_tokens: Number(this.connection.options?.maxTokens) || 4096,
        system: session.instructions, messages: [...session.messages, { role: 'user', content: prompt }] }),
    }, signal);
    const text = Array.isArray(data?.content) ? data.content.filter((part) => part?.type === 'text').map((part) => part.text).join('') : '';
    if (!text.trim()) throw new Error('Anthropic 兼容 API 没有返回可用文字');
    return text.trim();
  }

  async #vertex(prompt, settings, session, signal) {
    const url = endpoint(this.connection.baseUrl, `/models/${encodeURIComponent(settings.model)}:generateContent`);
    const contents = [...session.messages, { role: 'user', content: prompt }].map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
    }));
    const generationConfig = settings.effort ? { thinkingConfig: { thinkingLevel: settings.effort.toUpperCase() } } : {};
    const data = await requestJson(this.fetch, url, {
      method: 'POST', headers: { ...vertexHeaders(this.secret, this.connection.options), 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: session.instructions }] }, contents, generationConfig }),
    }, signal);
    const text = data?.candidates?.[0]?.content?.parts?.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('') ?? '';
    if (!text.trim()) throw new Error('Vertex AI 没有返回可用文字');
    return text.trim();
  }

  async #liveModels(purpose) {
    if (this.connection.kind === 'openai-compatible') return this.#openAiModels();
    if (this.connection.kind === 'anthropic-compatible') return this.#anthropicModels();
    if (this.connection.kind === 'elevenlabs') return this.#elevenLabsModels(purpose);
    if (this.connection.kind === 'vertex-ai') return this.#vertexModels(purpose);
    if (this.connection.kind === 'comfyui') return this.#comfyModels();
    return [];
  }

  async #openAiModels() {
    if (!this.connection.baseUrl || !this.secret) return [];
    const data = await requestJson(this.fetch, endpoint(this.connection.baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${this.secret}` },
    }, undefined, 30_000);
    return modelItems(data?.data);
  }

  async #anthropicModels() {
    if (!this.connection.baseUrl || !this.secret) return [];
    const data = await requestJson(this.fetch, endpoint(this.connection.baseUrl, '/models?limit=1000'), {
      headers: { Authorization: `Bearer ${this.secret}`, 'x-api-key': this.secret,
        'anthropic-version': this.connection.options?.anthropicVersion || '2023-06-01' },
    }, undefined, 30_000);
    return modelItems(data?.data, 'display_name');
  }

  async #elevenLabsModels(purpose) {
    const base = this.connection.baseUrl || 'https://api.elevenlabs.io';
    const data = await requestJson(this.fetch, elevenLabsEndpoint(base, '/models'), {
      headers: this.secret ? { 'xi-api-key': this.secret } : {},
    }, undefined, 30_000);
    return (Array.isArray(data) ? data : []).filter((item) => purpose !== 'tts' || item?.can_do_text_to_speech !== false)
      .map((item) => ({ id: item?.model_id, name: item?.name || item?.model_id })).filter((item) => item.id);
  }

  async #vertexModels(purpose) {
    if (!this.connection.baseUrl || !this.secret) return [];
    const data = await requestJson(this.fetch, vertexCatalogUrl(this.connection.baseUrl), {
      headers: vertexHeaders(this.secret, this.connection.options),
    }, undefined, 30_000);
    const entries = Array.isArray(data?.publisherModels) ? data.publisherModels
      : (Array.isArray(data?.models) ? data.models : data?.data);
    return modelItems(entries, 'displayName').map((item) => ({ ...item, id: item.id.split('/').at(-1) }))
      .filter((item) => purpose !== 'tts' || /tts|audio|speech/iu.test(item.id))
      .filter((item) => purpose !== 'image' || /image|imagen/iu.test(item.id));
  }

  async #comfyModels() {
    if (!this.connection.baseUrl) return [];
    const data = await requestJson(this.fetch, endpoint(this.connection.baseUrl, '/object_info'), {}, undefined, 30_000);
    const names = [data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0], data?.UNETLoader?.input?.required?.unet_name?.[0]]
      .flatMap((item) => Array.isArray(item) ? item : []).filter((item) => typeof item === 'string');
    return [...new Set(names)].map((id) => ({ id, name: id }));
  }
}

function modelItems(items, nameKey = 'name') {
  return (Array.isArray(items) ? items : []).map((item) => typeof item === 'string'
    ? { id: item, name: item }
    : { id: item?.id || item?.name, name: item?.[nameKey] || item?.display_name || item?.id || item?.name })
    .filter((item) => typeof item.id === 'string' && item.id);
}

function builtInModels(kind, purpose) {
  const catalogs = {
    minimax: { tts: ['speech-2.8-hd', 'speech-2.8-turbo'] },
    elevenlabs: { tts: ['eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'], stt: ['scribe_v2'] },
    'vertex-ai': {
      chat: [
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'] },
        'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
        'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash',
      ],
      tts: ['gemini-2.5-flash-tts'], image: ['gemini-2.5-flash-image', 'imagen-4.0-generate-001'],
    },
    novelai: { image: ['nai-diffusion-4-full'] },
  };
  return (catalogs[kind]?.[purpose] || []).map((item) => typeof item === 'string'
    ? { id: item, name: item } : item);
}

function mergeModels(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback].filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

async function requestJson(fetchImpl, url, init, signal, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController(); let timedOut = false;
  const stop = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`API HTTP ${response.status}${data?.error?.message ? `：${data.error.message}` : ''}`);
    return data;
  } catch (error) {
    if (timedOut) throw new Error('API 请求超时');
    if (signal?.aborted) throw new Error('回复已停止');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

function endpoint(base, suffix) {
  const value = base.replace(/\/+$/u, '');
  return value.endsWith(suffix) ? value : `${value}${suffix}`;
}
function elevenLabsEndpoint(base, suffix) {
  const value = String(base || '').replace(/\/+$/u, '');
  return /\/v1$/u.test(value) ? `${value}${suffix}` : `${value}/v1${suffix}`;
}
function vertexCatalogUrl(base) {
  const url = new URL(base);
  const match = url.pathname.match(/^\/v1\/projects\/[^/]+\/locations\/([^/]+)\/publishers\/google(?:\/models(?:\/[^/:]+(?::[^/]+)?)?)?$/u);
  const requestedLocation = match?.[1] || 'us-central1';
  const location = requestedLocation === 'global' ? 'us-central1' : requestedLocation;
  return `${url.protocol}//${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models?listAllVersions=false`;
}
function vertexHeaders(secret, options = {}) { return (options.authStyle || options.authType || 'api-key') === 'bearer' ? { Authorization: `Bearer ${secret}` } : { 'x-goog-api-key': secret }; }
function responseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  return Array.isArray(data?.output) ? data.output.flatMap((item) => item?.content ?? [])
    .filter((part) => part?.type === 'output_text').map((part) => part.text).join('') : '';
}
