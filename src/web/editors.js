import { api, jsonBody } from './api.js';
import { $, csv, id, options, toast } from './dom.js';
import { bindImageEditor, fillImageEditor } from './image-editors.js';
import { bindStickerEditor, fillStickerEditor, refreshStickerPicker } from './sticker-editors.js';
import { bindBotSections, refreshBotSections } from './bot-sections.js';
import { bindBotCards, refillBotEditor, botSaved, botDraftSaved } from './bot-cards.js';
import { bindBotAvatar, resetAvatarFeedback } from './bot-avatar.js';
import { bindWechatEditor, fillWechatEditor } from './wechat-editor.js';
import { bindRuntimeUi, fillRuntimeMode, refreshRuntimeExplanation } from './runtime-diagnostics.js';
import { bindProfileEditor, fillProfileEditor, refreshProfileEditor } from './profile-editor.js';
import { bindConnectionCatalog, fillConnectionCatalog } from './connection-catalog.js';
import { bindConnectionTest, fillConnectionTest } from './connection-health.js';
import { bindModelRefresh, loadModelPicker } from './model-picker.js';
import { bindResourceBrowsers, refreshResourceBrowsers, resourceSaved, resourceRemoved } from './resource-browser.js';
import { createResourceDefinitions } from './resource-definitions.js';
import { bindToolSwitches, fillToolSwitches, disabledToolSettings } from './tool-switches.js';

const KINDS = [
  ['codex', 'Codex 订阅 / CLI'], ['claude', 'Claude Code 订阅 / CLI'], ['grok-build', 'Grok Build 订阅 / CLI'],
  ['openai-compatible', 'OpenAI 兼容 API / 中转站'], ['anthropic-compatible', 'Anthropic 兼容 API / 中转站'],
  ['vertex-ai', 'Google Vertex AI'], ['minimax', 'MiniMax TTS'], ['elevenlabs', 'ElevenLabs TTS'],
  ['gpt-sovits', '本地 GPT-SoVITS'], ['edge-tts', '免费 Edge TTS'], ['whisper-local', '本地 Whisper STT'],
  ['memory-http', '外置记忆 HTTP'], ['memory-mcp', '外置记忆 MCP（记忆 + 工具）'],
  ['novelai', 'NovelAI 生图'], ['comfyui', '本地 / 远程 ComfyUI'],
  ['mcp-remote', '远程 MCP（HTTP）'], ['mcp-stdio', '本机 MCP（stdio）'],
];

export function bindEditors(app) {
  options($('#connection-kind'), KINDS.map(([value, label]) => ({ value, label })));
  $('#connection-picker').onchange = () => fillConnection(app, $('#connection-picker').value);
  $('#new-connection').onclick = () => fillConnection(app, '');
  $('#connection-form').onsubmit = (event) => saveConnection(event, app);
  $('#delete-connection').onclick = () => removeConnection(app);
  bindConnectionCatalog();
  bindConnectionTest();
  bindBotCards(app, fillBot); bindBotSections(); bindBotAvatar();
  bindToolSwitches();
  bindWechatEditor(app, () => saveBotDraft(app));
  bindRuntimeUi();
  $('#connection-kind').onchange = showConnectionFields;
  $('#bot-form').onsubmit = (event) => saveBot(event, app);
  $('#delete-bot').onclick = () => removeBot(app);
  $('#pair-button').onclick = () => pair(app);
  $('#bot-chat-connection').onchange = () => loadModels('', '');
  $('#bot-model').onchange = () => updateBotEfforts('');
  bindModelRefresh($('#bot-model-refresh'), (verify) => loadModels(undefined, undefined, verify));
  $('#bot-voice-probability').oninput = showProbability;
  $('#bot-sticker-probability').oninput = showStickerProbability;
  $('#bot-wake-mode').onchange = showWakeSchedule;
  $('#bot-wake-quiet-enabled').onchange = showWakeSchedule;
  bindProfileEditor(app);
  $('#voice-picker').onchange = () => fillVoice(app, $('#voice-picker').value);
  $('#new-voice').onclick = () => fillVoice(app, '');
  $('#add-voice-route').onclick = () => $('#voice-routes').append(routeCard(app));
  $('#voice-form').onsubmit = (event) => saveVoice(event, app);
  bindImageEditor(app);
  bindStickerEditor(app);
  bindResourceBrowsers(app, createResourceDefinitions({ kinds: KINDS, fillConnection, fillProfile: fillProfileEditor,
    fillVoice, fillImage: fillImageEditor, fillSticker: fillStickerEditor }));
}

export function fillEditors(app) {
  const label = (item) => ({ value: item.id, label: item.name });
  options($('#connection-picker'), app.data.connections.map(label), $('#connection-id').value, '新建连接');
  options($('#voice-picker'), app.data.voiceProfiles.map(label), $('#voice-id').value, '新建声音');
  options($('#image-picker'), app.data.imageProfiles.map(label), $('#image-id').value, '新建生图路线');
  refreshStickerPicker(app);
  refillBotEditor(app, fillBot);
  refreshProfileEditor(app);
  refreshResourceBrowsers(app);
}

function fillConnection(app, itemId) {
  const item = app.data.connections.find((entry) => entry.id === itemId);
  $('#connection-picker').value = item?.id || '';
  $('#connection-id').value = item?.id || ''; $('#connection-name').value = item?.name || '';
  $('#connection-kind').value = item?.kind || 'openai-compatible'; $('#connection-url').value = item?.baseUrl || '';
  $('#connection-secret').value = '';
  $('#connection-workdir').value = item?.options?.workingDirectory || ''; $('#connection-api-style').value = item?.options?.apiStyle || 'chat-completions';
  $('#connection-group-id').value = item?.options?.groupId || ''; $('#connection-command').value = item?.options?.command || '';
  $('#connection-tools').value = item?.options?.tools?.join(', ') || ''; $('#connection-mcp').value = item?.options?.mcpConfigPath || '';
  $('#connection-allowed-tools').value = item?.options?.allowedTools?.join(', ') || '';
  $('#connection-disallowed-tools').value = item?.options?.disallowedTools?.join(', ') || '';
  $('#connection-sandbox').value = item?.options?.sandbox || 'read-only'; $('#connection-approval').value = item?.options?.approvalPolicy || 'never';
  $('#connection-memory-context').value = item?.options?.contextPath || ''; $('#connection-memory-write').value = item?.options?.writePath || '';
  $('#connection-memory-context-tool').value = item?.options?.contextTool || ''; $('#connection-memory-write-tool').value = item?.options?.writeTool || '';
  $('#connection-memory-idle').value = item?.options?.idleHours || 6; $('#connection-memory-write-enabled').checked = item?.options?.writeEnabled === true;
  $('#connection-auth-type').value = item?.options?.authType || (item?.kind === 'vertex-ai' ? 'api-key' : 'bearer'); $('#connection-auth-name').value = item?.options?.authName || '';
  $('#connection-access-mode').value = item?.options?.accessMode || 'approval'; $('#connection-stt-model').value = item?.options?.transcriptionModel || '';
  $('#connection-args').value = (item?.options?.args || []).join('\n'); $('#connection-secret-env').value = item?.options?.secretEnv || '';
  $('#connection-secret-state').textContent = item?.hasSecret ? '密钥已保存；留空不会覆盖' : '尚未保存密钥';
  $('#delete-connection').disabled = !item;
  fillRuntimeMode(item); fillConnectionCatalog(item); fillConnectionTest(item); showConnectionFields();
}

function showConnectionFields() {
  $('#connection-api-format').hidden = $('#connection-kind').value !== 'openai-compatible';
  $('#connection-url-help').textContent = $('#connection-kind').value === 'vertex-ai'
    ? 'Gemini 4 Argon 请使用 global 发布者地址；密钥放置选 Google x-goog-api-key，并填写同一 Google Cloud 项目创建的 API Key。服务账号邮箱不是地址或密钥，Bearer 只适合仍有效的 OAuth access token。'
    : 'API / MCP 填服务地址；订阅 CLI 与本机命令可以留空。';
  refreshRuntimeExplanation();
}

async function saveConnection(event, app) {
  event.preventDefault(); const existingId = $('#connection-id').value;
  const existing = app.data.connections.find((item) => item.id === existingId);
  const body = { name: $('#connection-name').value, kind: $('#connection-kind').value, baseUrl: $('#connection-url').value,
    secret: $('#connection-secret').value, cachedModels: csv($('#connection-models').value), options: { ...(existing?.options || {}),
      runtimeMode: $('#connection-runtime-mode').value,
      workingDirectory: $('#connection-workdir').value, apiStyle: $('#connection-api-style').value,
      groupId: $('#connection-group-id').value, command: $('#connection-command').value,
      tools: csv($('#connection-tools').value), mcpConfigPath: $('#connection-mcp').value,
      allowedTools: csv($('#connection-allowed-tools').value), disallowedTools: csv($('#connection-disallowed-tools').value),
      sandbox: $('#connection-sandbox').value, approvalPolicy: $('#connection-approval').value,
      contextPath: $('#connection-memory-context').value, writePath: $('#connection-memory-write').value,
      contextTool: $('#connection-memory-context-tool').value, writeTool: $('#connection-memory-write-tool').value,
      idleHours: Number($('#connection-memory-idle').value) || 6, writeEnabled: $('#connection-memory-write-enabled').checked,
      authType: $('#connection-auth-type').value, authName: $('#connection-auth-name').value,
      accessMode: $('#connection-access-mode').value, transcriptionModel: $('#connection-stt-model').value,
      args: $('#connection-args').value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean), secretEnv: $('#connection-secret-env').value,
    } };
  const saved = await api(existingId ? `/api/connections/${encodeURIComponent(existingId)}` : '/api/connections', { method: existingId ? 'PUT' : 'POST', body: jsonBody(body) });
  resourceSaved('connections', saved.id); toast('连接预设已保存'); await app.reload();
}

async function removeConnection(app) {
  const itemId = $('#connection-id').value; if (!itemId || !confirm('删除这个连接预设？被 Bot 或声音引用时不会允许删除。')) return;
  await api(`/api/connections/${encodeURIComponent(itemId)}`, { method: 'DELETE' }); resourceRemoved('connections'); toast('连接已删除'); await app.reload();
}

function fillBot(app, itemId) {
  const item = app.data.bots.find((entry) => entry.id === itemId); const chatConnections = app.data.connections.filter((entry) => entry.capabilities.includes('chat'));
  const memoryConnections = app.data.connections.filter((entry) => entry.capabilities.includes('memory'));
  const sttConnections = app.data.connections.filter((entry) => entry.capabilities.includes('stt'));
  const toolConnections = app.data.connections.filter((entry) => entry.capabilities.includes('tools'));
  $('#bot-id').value = item?.id || ''; $('#bot-name').value = item?.name || ''; $('#bot-token').value = '';
  $('#bot-channel').value = item?.channel?.type || 'telegram';
  $('#bot-avatar').value = item?.avatar || ''; resetAvatarFeedback();
  $('#bot-enabled').checked = item?.enabled ?? true; $('#bot-group').checked = item?.telegram?.groupMode ?? false;
  options($('#bot-profile'), app.data.profiles.map(named), item?.profileId); options($('#bot-chat-connection'), chatConnections.map(named), item?.chat?.connectionId);
  options($('#bot-voice-profile'), app.data.voiceProfiles.map(named), item?.voice?.voiceProfileId || '', '不使用语音');
  const usableVoices = app.data.voiceProfiles.filter((voice) => voice.primary?.connectionId);
  $('#bot-voice-profile-help').textContent = usableVoices.length
    ? '声音连接保存服务账号；声音预设只选择音色、模型和备用顺序。'
    : '目前没有配置完成的声音预设。请先到“声音”页为预设选择首选连接、模型和音色 ID。';
  options($('#bot-memory'), memoryConnections.map(named), item?.memoryConnectionId || '', '不接外置记忆');
  options($('#bot-transcription'), sttConnections.map(named), item?.voice?.transcriptionConnectionId || '', '不接语音转写');
  options($('#bot-image-profile'), app.data.imageProfiles.map(named), item?.image?.imageProfileId || '', '不使用生图');
  multiOptions($('#bot-sticker-packs'), app.data.stickerPacks, item?.stickers?.packIds || []);
  multiOptions($('#bot-tool-connections'), toolConnections, item?.tools?.connectionIds || []);
  $('#bot-model').value = ''; $('#bot-effort').value = '';
  $('#bot-voice-enabled').checked = item?.voice?.enabled ?? false;
  $('#bot-voice-text').checked = item?.voice?.telegramSendTextWithVoice ?? false;
  $('#bot-wechat-voice-text').checked = item?.voice?.wechatSendTextWithVoice ?? false;
  $('#bot-voice-probability').value = item?.voice?.replyProbability ?? 0; $('#bot-allowed').value = item?.telegram?.allowedChatIds?.join(', ') || '';
  $('#bot-telegram-typing').checked = item?.telegram?.typingIndicator ?? true;
  $('#bot-telegram-split').checked = item?.telegram?.splitParagraphs ?? true;
  $('#bot-telegram-long-split').checked = item?.telegram?.longMessageSplit ?? true;
  $('#bot-telegram-merge').checked = item?.telegram?.mergeBurst ?? true;
  $('#bot-wechat-allowed').value = item?.wechat?.allowedUserIds?.join(', ') || '';
  $('#bot-wechat-typing').checked = item?.wechat?.typingIndicator ?? true;
  $('#bot-wechat-transcription').checked = item?.wechat?.usePlatformTranscription ?? true;
  $('#bot-wechat-split').checked = item?.wechat?.splitParagraphs ?? true;
  $('#bot-wechat-long-split').checked = item?.wechat?.longMessageSplit ?? true;
  $('#bot-merge-delay').value = item?.telegram?.mergeDelayMs ?? 1800; $('#pair-code').textContent = ''; $('#wechat-pair-code').textContent = '';
  $('#bot-image-enabled').checked = item?.image?.enabled ?? false; $('#bot-tools-enabled').checked = item?.tools?.enabled ?? false;
  $('#bot-stickers-enabled').checked = item?.stickers?.enabled ?? false; $('#bot-sticker-probability').value = item?.stickers?.replyProbability ?? 30;
  $('#bot-tool-names').value = item?.tools?.allowedToolNames?.join(', ') || ''; $('#bot-tool-writes').checked = item?.tools?.allowWrites ?? false;
  fillToolSwitches(item?.tools);
  const suggestedWakeTarget = item?.channel?.type === 'wechat-clawbot' && item?.wechat?.allowedUserIds?.length === 1
    ? item.wechat.allowedUserIds[0] : '';
  $('#bot-wake-enabled').checked = item?.wake?.enabled ?? false; $('#bot-wake-chat').value = item?.wake?.targetChatId || suggestedWakeTarget;
  $('#bot-wake-mode').value = item?.wake?.scheduleMode || 'fixed'; $('#bot-wake-interval').value = item?.wake?.intervalMinutes ?? 60;
  $('#bot-wake-random-min').value = item?.wake?.randomMinMinutes ?? 45; $('#bot-wake-random-max').value = item?.wake?.randomMaxMinutes ?? 120;
  $('#bot-wake-quiet-enabled').checked = item?.wake?.quietHoursEnabled ?? false;
  $('#bot-wake-limit').value = item?.wake?.dailyLimit ?? 3;
  $('#bot-wake-cooldown').value = item?.wake?.cooldownMinutes ?? 120; $('#bot-wake-start').value = item?.wake?.quietStart || '23:00';
  $('#bot-wake-end').value = item?.wake?.quietEnd || '08:00'; $('#bot-wake-prompt').value = item?.wake?.prompt || '';
  const configured = item?.channel?.type === 'wechat-clawbot' ? item?.hasWechatAccount : item?.hasTelegramToken;
  $('#bot-runtime-state').textContent = item?.runtime?.running ? '正在运行' : (item?.runtime?.lastError || (configured ? '账号已连接，当前未运行' : '尚未连接账号'));
  $('#delete-bot').disabled = !item || app.data.bots.length <= 1; showProbability(); showStickerProbability(); showWakeSchedule();
  loadModels(item?.chat?.model || '', item?.chat?.effort || '');
  fillWechatEditor(item);
  refreshBotSections();
}

async function saveBot(event, app) {
  event.preventDefault(); const existingId = $('#bot-id').value; const body = botBody(app);
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    const saved = await api(existingId ? `/api/bots/${encodeURIComponent(existingId)}` : '/api/bots', { method: existingId ? 'PUT' : 'POST', body: jsonBody(body) });
    botSaved(saved.id);
    toast('Bot 设置已保存'); await app.reload();
  } catch (error) {
    $('#bot-runtime-state').textContent = error.message;
    toast(error.message, true);
  } finally { if (submit) submit.disabled = false; }
}

function botBody(app) {
  const existing = app.data.bots.find((bot) => bot.id === $('#bot-id').value);
  const channel = $('#bot-channel').value;
  return { name: $('#bot-name').value, avatar: $('#bot-avatar').value, enabled: $('#bot-enabled').checked, profileId: $('#bot-profile').value,
    channel: { type: channel },
    telegramToken: channel === 'telegram' ? $('#bot-token').value : '', chat: { connectionId: $('#bot-chat-connection').value, model: $('#bot-model').value,
      effort: $('#bot-effort').value, fallbackConnectionIds: [] }, telegram: { allowedChatIds: csv($('#bot-allowed').value),
      typingIndicator: $('#bot-telegram-typing').checked, splitParagraphs: $('#bot-telegram-split').checked,
      longMessageSplit: $('#bot-telegram-long-split').checked, mergeBurst: $('#bot-telegram-merge').checked,
      mergeDelayMs: Number($('#bot-merge-delay').value), groupMode: $('#bot-group').checked },
    wechat: { allowedUserIds: csv($('#bot-wechat-allowed').value), typingIndicator: $('#bot-wechat-typing').checked,
      usePlatformTranscription: $('#bot-wechat-transcription').checked, splitParagraphs: $('#bot-wechat-split').checked,
      longMessageSplit: $('#bot-wechat-long-split').checked }, voice: {
      enabled: $('#bot-voice-enabled').checked, replyProbability: Number($('#bot-voice-probability').value),
      voiceProfileId: $('#bot-voice-profile').value || null, transcriptionConnectionId: $('#bot-transcription').value || null,
      sendTextWithVoice: existing?.voice?.sendTextWithVoice ?? false, wechatSendTextWithVoice: $('#bot-wechat-voice-text').checked,
      telegramSendTextWithVoice: $('#bot-voice-text').checked },
    image: { enabled: $('#bot-image-enabled').checked,
      imageProfileId: $('#bot-image-profile').value || null }, tools: { enabled: $('#bot-tools-enabled').checked,
      connectionIds: [...$('#bot-tool-connections').selectedOptions].map((option) => option.value),
      allowedToolNames: csv($('#bot-tool-names').value), disabledByConnection: disabledToolSettings(),
      allowWrites: $('#bot-tool-writes').checked, maxCalls: existing?.tools?.maxCalls ?? 2 },
    stickers: { enabled: $('#bot-stickers-enabled').checked,
      packIds: [...$('#bot-sticker-packs').selectedOptions].map((option) => option.value),
      replyProbability: Number($('#bot-sticker-probability').value) },
    wake: { enabled: $('#bot-wake-enabled').checked, targetChatId: $('#bot-wake-chat').value || null,
      scheduleMode: $('#bot-wake-mode').value, intervalMinutes: Number($('#bot-wake-interval').value),
      randomMinMinutes: Number($('#bot-wake-random-min').value), randomMaxMinutes: Number($('#bot-wake-random-max').value),
      dailyLimit: Number($('#bot-wake-limit').value),
      cooldownMinutes: Number($('#bot-wake-cooldown').value), quietHoursEnabled: $('#bot-wake-quiet-enabled').checked,
      quietStart: $('#bot-wake-start').value,
      quietEnd: $('#bot-wake-end').value, prompt: $('#bot-wake-prompt').value }, memoryConnectionId: $('#bot-memory').value || null };
}

async function saveBotDraft(app) {
  const existingId = $('#bot-id').value; const saved = await api(existingId ? `/api/bots/${encodeURIComponent(existingId)}` : '/api/bots', {
    method: existingId ? 'PUT' : 'POST', body: jsonBody(botBody(app)),
  });
  botDraftSaved(saved.id); await app.reload(); return saved.id;
}

async function removeBot(app) {
  const itemId = $('#bot-id').value; if (!itemId || !confirm('删除这个 Bot 配置？')) return;
  await api(`/api/bots/${encodeURIComponent(itemId)}`, { method: 'DELETE' }); botSaved(null); toast('Bot 已删除'); await app.reload();
}

async function pair() {
  const botId = $('#bot-id').value; if (!botId) return toast('请先保存 Bot', true);
  const result = await api('/api/pairing-code', { method: 'POST', body: jsonBody({ botId }) }); $('#pair-code').textContent = result.code;
}

let botCatalog = { models: [], efforts: [] };
async function loadModels(selected = $('#bot-model').value, selectedEffort = $('#bot-effort').value, verify = false) {
  const connectionId = $('#bot-chat-connection').value;
  await loadModelPicker({ select: $('#bot-model'), connectionId, purpose: 'chat', selected, verify,
    button: $('#bot-model-refresh'), status: $('#bot-model-status'), emptyLabel: '后端默认模型',
    onLoaded: (result) => { botCatalog = result; updateBotEfforts(selectedEffort); } });
}
function updateBotEfforts(explicit = null) {
  const selected = $('#bot-model').value; const current = explicit ?? $('#bot-effort').value;
  const model = botCatalog.models?.find((item) => item.id === selected);
  const efforts = model?.efforts ?? botCatalog.efforts ?? [];
  const items = efforts.map((value) => ({ value, label: value }));
  if (current && !items.some((item) => item.value === current)) items.unshift({ value: current, label: `${current}（当前保存）` });
  options($('#bot-effort'), items, current, '后端默认');
}

function showProbability() { $('#bot-voice-value').textContent = `${$('#bot-voice-probability').value}%`; }
function showStickerProbability() { $('#bot-sticker-value').textContent = `${$('#bot-sticker-probability').value}%`; }
function showWakeSchedule() {
  const mode = $('#bot-wake-mode').value || 'fixed';
  for (const node of document.querySelectorAll('[data-wake-mode]')) node.hidden = node.dataset.wakeMode !== mode;
  $('#bot-wake-quiet-fields').hidden = !$('#bot-wake-quiet-enabled').checked;
  refreshBotSections();
}

function fillVoice(app, itemId) {
  const item = app.data.voiceProfiles.find((entry) => entry.id === itemId); $('#voice-id').value = item?.id || '';
  $('#voice-picker').value = item?.id || '';
  $('#voice-name').value = item?.name || ''; $('#voice-routes').replaceChildren();
  for (const route of [item?.primary, ...(item?.fallbacks || [])].filter(Boolean)) $('#voice-routes').append(routeCard(app, route));
  if (!item) $('#voice-routes').append(routeCard(app));
}

function routeCard(app, route = {}) {
  const node = document.createElement('article'); node.className = 'module-card';
  node.innerHTML = '<div class="module-head"><select class="route-connection" aria-label="语音连接"></select><div class="model-picker-inline"><select class="route-model" aria-label="语音模型"></select><button type="button" class="quiet route-model-refresh">拉取</button></div><input class="route-voice" aria-label="音色 ID" placeholder="音色 ID（不是 API Key）"><button type="button" class="danger">移除</button></div><p class="hint route-model-status" role="status"></p><p class="route-expression" role="status"></p><div class="form-grid two route-reference-fields"><input class="route-reference" aria-label="GPT-SoVITS 参考音频路径" placeholder="GPT-SoVITS 参考音频路径"><input class="route-reference-text" aria-label="参考音频文本" placeholder="参考音频文本"></div>';
  const tts = app.data.connections.filter((entry) => entry.capabilities.includes('tts')); options($('.route-connection', node), tts.map(named), route.connectionId);
  $('.route-voice', node).value = route.voiceId || '';
  $('.route-reference', node).value = route.referenceAudio || ''; $('.route-reference-text', node).value = route.referenceText || '';
  const updateExpression = () => {
    const connection = app.data.connections.find((item) => item.id === $('.route-connection', node).value);
    const model = $('.route-model', node).value;
    const effectiveModel = model || (connection?.kind === 'elevenlabs' ? 'eleven_v4' : '');
    const supported = connection?.kind === 'vertex-ai' || (connection?.kind === 'elevenlabs' && /eleven_v(?:3|4)(?:_turbo)?/iu.test(effectiveModel));
    $('.route-expression', node).textContent = supported
      ? '支持自主语气：模型会按语境使用这条线路真正支持的耳语、叹气、笑声、紧张与停顿等表现。'
      : connection?.kind === 'elevenlabs' ? '当前只负责音色与念字；推荐填写 eleven_v4，实时场景可用 eleven_v4_turbo。'
        : '当前线路负责音色与念字；不支持的语气标记会自动清理。';
    $('.route-expression', node).classList.toggle('supported', supported);
    $('.route-reference-fields', node).hidden = connection?.kind !== 'gpt-sovits';
  };
  const loadVoiceModels = (verify = false) => loadModelPicker({ select: $('.route-model', node), connectionId: $('.route-connection', node).value, verify,
    purpose: 'tts', selected: $('.route-model', node).value || route.model || '', button: $('.route-model-refresh', node),
    status: $('.route-model-status', node), emptyLabel: '由连接自动选择', onLoaded: updateExpression });
  $('.route-connection', node).addEventListener('change', () => { route.model = ''; $('.route-model', node).value = ''; loadVoiceModels(); });
  $('.route-model', node).addEventListener('change', updateExpression);
  bindModelRefresh($('.route-model-refresh', node), loadVoiceModels);
  $('.danger', node).onclick = () => node.remove(); loadVoiceModels(); updateExpression(); return node;
}

async function saveVoice(event, app) {
  event.preventDefault(); const existingId = $('#voice-id').value;
  const routes = [...$('#voice-routes').children].map((node) => ({ connectionId: $('.route-connection', node).value,
    model: $('.route-model', node).value, voiceId: $('.route-voice', node).value,
    referenceAudio: $('.route-reference', node).value, referenceText: $('.route-reference-text', node).value, language: 'zh' }));
  const body = { name: $('#voice-name').value, primary: routes[0] || null, fallbacks: routes.slice(1) };
  const saved = await api(existingId ? `/api/voice-profiles/${encodeURIComponent(existingId)}` : '/api/voice-profiles', { method: existingId ? 'PUT' : 'POST', body: jsonBody(body) });
  resourceSaved('voices', saved.id); toast('声音预设已保存'); await app.reload();
}


function named(item) { return { value: item.id, label: item.name }; }
function multiOptions(select, items, selected) { const wanted = new Set(selected); select.replaceChildren(); for (const item of items) select.append(new Option(item.name, item.id, false, wanted.has(item.id))); }
