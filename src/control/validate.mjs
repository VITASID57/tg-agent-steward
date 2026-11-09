import { CONNECTION_KINDS, capabilitiesFor, defaultControlPlane } from './defaults.mjs';
import { normalizeAvatar } from './avatar.mjs';

const kinds = new Set(CONNECTION_KINDS);
const scopes = new Set(['all', 'private']);
const surfaces = new Set(['all', 'telegram', 'wechat']);
const channelTypes = new Set(['telegram', 'wechat-clawbot']);
const wakeModes = new Set(['fixed', 'random']);

export function normalizeControlPlane(input, legacy = {}) {
  const fallback = defaultControlPlane(legacy);
  if (!input || input.schemaVersion !== 2) return fallback;
  const connections = array(input.connections).map(normalizeConnection).filter(Boolean);
  const profiles = array(input.profiles).map(normalizeProfile).filter(Boolean);
  const voiceProfiles = array(input.voiceProfiles).map(normalizeVoiceProfile).filter(Boolean);
  const imageProfiles = array(input.imageProfiles).map(normalizeImageProfile).filter(Boolean);
  const stickerPacks = array(input.stickerPacks).map(normalizeStickerPack).filter(Boolean);
  const connectionIds = new Set(connections.map((item) => item.id));
  const profileIds = new Set(profiles.map((item) => item.id));
  const voiceIds = new Set(voiceProfiles.map((item) => item.id));
  const imageIds = new Set(imageProfiles.map((item) => item.id));
  const stickerPackIds = new Set(stickerPacks.map((item) => item.id));
  for (const voice of voiceProfiles) {
    if (!connectionIds.has(voice.primary?.connectionId)) voice.primary = null;
    voice.fallbacks = voice.fallbacks.filter((route) => connectionIds.has(route.connectionId));
  }
  for (const image of imageProfiles) {
    if (!connectionIds.has(image.primary?.connectionId)) image.primary = null;
    image.fallbacks = image.fallbacks.filter((route) => connectionIds.has(route.connectionId));
  }
  const bots = array(input.bots).map(normalizeBot).filter(Boolean).filter((bot) =>
    profileIds.has(bot.profileId) && (!bot.chat.connectionId || connectionIds.has(bot.chat.connectionId)));
  for (const bot of bots) {
    bot.chat.fallbackConnectionIds = bot.chat.fallbackConnectionIds.filter((id) => connectionIds.has(id));
    if (!voiceIds.has(bot.voice.voiceProfileId)) bot.voice.voiceProfileId = null;
    if (!imageIds.has(bot.image.imageProfileId)) bot.image.imageProfileId = null;
    if (!connectionIds.has(bot.voice.transcriptionConnectionId)) bot.voice.transcriptionConnectionId = null;
    bot.tools.connectionIds = bot.tools.connectionIds.filter((id) => connectionIds.has(id));
    bot.stickers.packIds = bot.stickers.packIds.filter((id) => stickerPackIds.has(id));
    if (!connectionIds.has(bot.memoryConnectionId)) bot.memoryConnectionId = null;
  }
  return {
    schemaVersion: 2,
    connections: connections.length ? unique(connections) : fallback.connections,
    profiles: profiles.length ? unique(profiles) : fallback.profiles,
    voiceProfiles: unique(voiceProfiles), imageProfiles: unique(imageProfiles), stickerPacks: unique(stickerPacks),
    bots: bots.length ? unique(bots) : fallback.bots,
  };
}

export function normalizeConnection(input) {
  if (!input || !kinds.has(input.kind)) return null;
  const kind = input.kind;
  const allowed = new Set(capabilitiesFor(kind));
  const options = object(input.options);
  if (['codex', 'claude', 'grok-build'].includes(kind)) options.runtimeMode = options.runtimeMode === 'agent' ? 'agent' : 'chat';
  return {
    id: requiredId(input.id), name: text(input.name, kind, 80), kind, baseUrl: text(input.baseUrl, '', 500),
    capabilities: [...allowed], options,
    cachedModels: stringList(input.cachedModels, 200), lastTest: normalizeTest(input.lastTest),
    createdAt: date(input.createdAt), updatedAt: date(input.updatedAt),
  };
}

export function normalizeProfile(input) {
  if (!input) return null;
  const blocks = array(input.blocks).map((block, index) => ({
    id: requiredId(block?.id || `block-${index}`), title: text(block?.title, `规则 ${index + 1}`, 80),
    body: typeof block?.body === 'string' ? block.body.slice(0, 100_000) : '', enabled: block?.enabled !== false,
    scope: scopes.has(block?.scope) ? block.scope : 'all', surface: surfaces.has(block?.surface) ? block.surface : 'all',
  }));
  return {
    id: requiredId(input.id), name: text(input.name, '未命名人物', 80),
    residentId: optional(input.residentId, 160), source: text(input.source, 'local', 80),
    blocks: blocks.length ? unique(blocks) : [{ id: 'block-base', title: '基础人格', body: '', enabled: false, scope: 'all', surface: 'all' }],
    createdAt: date(input.createdAt), updatedAt: date(input.updatedAt), revision: positiveInt(input.revision, 1),
  };
}

export function normalizeVoiceProfile(input) {
  if (!input) return null;
  return {
    id: requiredId(input.id), name: text(input.name, '未命名声音', 80),
    primary: normalizeVoiceRoute(input.primary), fallbacks: array(input.fallbacks).map(normalizeVoiceRoute).filter(Boolean),
    createdAt: date(input.createdAt), updatedAt: date(input.updatedAt),
  };
}

export function normalizeImageProfile(input) {
  if (!input) return null;
  return {
    id: requiredId(input.id), name: text(input.name, '未命名生图路线', 80),
    primary: normalizeImageRoute(input.primary), fallbacks: array(input.fallbacks).map(normalizeImageRoute).filter(Boolean),
    createdAt: date(input.createdAt), updatedAt: date(input.updatedAt),
  };
}

export function normalizeStickerPack(input) {
  if (!input) return null;
  const stickers = array(input.stickers).map((item) => ({
    id: requiredId(item?.id), name: text(item?.name, '未命名表情', 80), meaning: text(item?.meaning, '', 300),
    tags: stringList(item?.tags, 30), assetId: requiredId(item?.assetId), enabled: item?.enabled !== false,
  }));
  return { id: requiredId(input.id), name: text(input.name, '未命名表情包', 80), stickers: unique(stickers).slice(0, 500),
    createdAt: date(input.createdAt), updatedAt: date(input.updatedAt) };
}

export function normalizeBot(input) {
  if (!input) return null;
  const tg = object(input.telegram); const wx = object(input.wechat); const chat = object(input.chat); const voice = object(input.voice);
  const image = object(input.image); const tools = object(input.tools); const wake = object(input.wake); const stickers = object(input.stickers);
  const channel = object(input.channel);
  const wakeRandomA = rangedInt(wake.randomMinMinutes, 45, 5, 10_080);
  const wakeRandomB = rangedInt(wake.randomMaxMinutes, 120, 5, 10_080);
  return {
    id: requiredId(input.id), name: text(input.name, '未命名 Bot', 80), enabled: input.enabled !== false,
    channel: { type: channelTypes.has(channel.type) ? channel.type : 'telegram' },
    profileId: requiredId(input.profileId), avatar: normalizeAvatar(input.avatar),
    chat: { connectionId: text(chat.connectionId, '', 200), model: text(chat.model, '', 160), effort: text(chat.effort, '', 40),
      fallbackConnectionIds: stringList(chat.fallbackConnectionIds, 20) },
    telegram: {
      allowedChatIds: stringList(tg.allowedChatIds, 500), typingIndicator: tg.typingIndicator !== false,
      splitParagraphs: tg.splitParagraphs !== false, longMessageSplit: tg.longMessageSplit !== false,
      mergeBurst: tg.mergeBurst !== false, mergeDelayMs: rangedInt(tg.mergeDelayMs, 1800, 0, 10_000),
      groupMode: tg.groupMode === true,
    },
    wechat: {
      allowedUserIds: stringList(wx.allowedUserIds, 500), typingIndicator: wx.typingIndicator !== false,
      splitParagraphs: wx.splitParagraphs !== false, longMessageSplit: wx.longMessageSplit !== false,
      usePlatformTranscription: wx.usePlatformTranscription !== false,
    },
    voice: {
      enabled: voice.enabled === true, replyProbability: rangedInt(voice.replyProbability, 0, 0, 100),
      voiceProfileId: optional(voice.voiceProfileId, 160), transcriptionConnectionId: optional(voice.transcriptionConnectionId, 160),
      sendTextWithVoice: voice.sendTextWithVoice !== false,
    },
    image: { enabled: image.enabled === true, imageProfileId: optional(image.imageProfileId, 160) },
    tools: {
      enabled: tools.enabled === true, connectionIds: stringList(tools.connectionIds, 20),
      allowedToolNames: stringList(tools.allowedToolNames, 200), allowWrites: tools.allowWrites === true,
      maxCalls: rangedInt(tools.maxCalls, 2, 1, 8),
    },
    stickers: { enabled: stickers.enabled === true, packIds: stringList(stickers.packIds, 50),
      replyProbability: rangedInt(stickers.replyProbability, 30, 0, 100) },
    wake: {
      enabled: wake.enabled === true, targetChatId: optional(wake.targetChatId, 160),
      scheduleMode: wakeModes.has(wake.scheduleMode) ? wake.scheduleMode : 'fixed',
      intervalMinutes: rangedInt(wake.intervalMinutes, 60, 5, 10_080),
      randomMinMinutes: Math.min(wakeRandomA, wakeRandomB),
      randomMaxMinutes: Math.max(wakeRandomA, wakeRandomB),
      quietStart: time(wake.quietStart, '23:00'), quietEnd: time(wake.quietEnd, '08:00'),
      dailyLimit: rangedInt(wake.dailyLimit, 3, 1, 50), cooldownMinutes: rangedInt(wake.cooldownMinutes, 120, 5, 10_080),
      prompt: text(wake.prompt, '看看最近的对话和记忆，只有确实有想说的话时才主动联系。没有就只回复 [[SILENT]]。', 4000),
    },
    memoryConnectionId: optional(input.memoryConnectionId, 160), createdAt: date(input.createdAt), updatedAt: date(input.updatedAt),
  };
}

function normalizeVoiceRoute(value) {
  if (!value || !value.connectionId) return null;
  return {
    connectionId: requiredId(value.connectionId), model: text(value.model, '', 160), voiceId: text(value.voiceId, '', 240),
    referenceAudio: text(value.referenceAudio, '', 600), referenceText: text(value.referenceText, '', 1000),
    language: text(value.language, 'zh', 40),
  };
}
function normalizeImageRoute(value) {
  if (!value || !value.connectionId) return null;
  return {
    connectionId: requiredId(value.connectionId), model: text(value.model, '', 160),
    size: text(value.size, '1024x1024', 40), options: object(value.options),
  };
}
function normalizeTest(value) { return value && typeof value === 'object' ? {
  ok: value.ok === true,
  status: ['passed', 'warning', 'failed'].includes(value.status) ? value.status : (value.ok === true ? 'passed' : 'failed'),
  at: date(value.at), title: text(value.title, '', 120), message: text(value.message, '', 500),
} : null; }
function requiredId(value) { const result = text(value, '', 160); if (!result) throw Object.assign(new Error('缺少对象 ID'), { statusCode: 400 }); return result; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback, max) { return typeof value === 'string' ? value.trim().slice(0, max) : fallback; }
function optional(value, max) { const result = text(value, '', max); return result || null; }
function stringList(value, max) { return [...new Set(array(value).filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, max); }
function rangedInt(value, fallback, min, max) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback; }
function positiveInt(value, fallback) { return rangedInt(value, fallback, 1, Number.MAX_SAFE_INTEGER); }
function date(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString(); }
function time(value, fallback) { const result = text(value, fallback, 5); return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(result) ? result : fallback; }
function unique(items) { return [...new Map(items.map((item) => [item.id, item])).values()]; }
