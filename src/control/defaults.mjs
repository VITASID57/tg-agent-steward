export const CONNECTION_KINDS = Object.freeze([
  'codex', 'claude', 'grok-build', 'openai-compatible', 'anthropic-compatible', 'vertex-ai',
  'minimax', 'elevenlabs', 'gpt-sovits', 'edge-tts', 'whisper-local', 'memory-http', 'memory-mcp',
  'novelai', 'comfyui', 'mcp-remote', 'mcp-stdio',
]);

export const CAPABILITIES = Object.freeze(['chat', 'tts', 'stt', 'memory', 'image', 'tools']);

export function capabilitiesFor(kind) {
  if (['codex', 'grok-build'].includes(kind)) return ['chat', 'image'];
  if (['claude', 'anthropic-compatible'].includes(kind)) return ['chat'];
  if (kind === 'openai-compatible') return ['chat', 'stt', 'image'];
  if (kind === 'vertex-ai') return ['chat', 'tts', 'stt', 'image'];
  if (kind === 'elevenlabs') return ['tts', 'stt'];
  if (['minimax', 'gpt-sovits', 'edge-tts'].includes(kind)) return ['tts'];
  if (kind === 'whisper-local') return ['stt'];
  if (kind === 'memory-http') return ['memory'];
  if (kind === 'memory-mcp') return ['memory', 'tools'];
  if (['novelai', 'comfyui'].includes(kind)) return ['image'];
  if (['mcp-remote', 'mcp-stdio'].includes(kind)) return ['tools'];
  return [];
}

export function defaultControlPlane(legacy = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    connections: [],
    profiles: [{
      id: 'profile-default', name: '默认人物', residentId: null, source: 'local',
      blocks: [{ id: 'block-base', title: '基础人格', body: '', enabled: false, scope: 'all', surface: 'all' }],
      createdAt: now, updatedAt: now, revision: 1,
    }],
    voiceProfiles: [],
    imageProfiles: [],
    stickerPacks: [],
    bots: [{
      id: 'bot-default', name: '我的 Telegram Bot', enabled: legacy.telegram?.enabled ?? true,
      channel: { type: 'telegram' },
      profileId: 'profile-default',
      chat: { connectionId: '', model: legacy.model ?? '', effort: legacy.effort ?? '', fallbackConnectionIds: [] },
      telegram: {
        allowedChatIds: legacy.telegram?.allowedChatIds ?? [], typingIndicator: legacy.telegram?.typingIndicator ?? true,
        splitParagraphs: legacy.telegram?.splitParagraphs ?? true, longMessageSplit: legacy.telegram?.longMessageSplit ?? true,
        mergeBurst: legacy.telegram?.mergeBurst ?? true, mergeDelayMs: legacy.telegram?.mergeDelayMs ?? 1800,
        groupMode: legacy.telegram?.groupMode ?? false,
      },
      wechat: {
        allowedUserIds: [], typingIndicator: true, splitParagraphs: true,
        longMessageSplit: true, usePlatformTranscription: true,
      },
      voice: {
        enabled: false, replyProbability: 0, voiceProfileId: null, transcriptionConnectionId: null,
        sendTextWithVoice: false, telegramSendTextWithVoice: false, wechatSendTextWithVoice: false,
      },
      image: { enabled: false, imageProfileId: null },
      tools: { enabled: false, connectionIds: [], allowedToolNames: [], disabledByConnection: {}, allowWrites: false, maxCalls: 2 },
      stickers: { enabled: false, packIds: [], replyProbability: 30 },
      wake: {
        enabled: false, targetChatId: null, scheduleMode: 'random', intervalMinutes: 60,
        randomMinMinutes: 45, randomMaxMinutes: 120, quietHoursEnabled: false,
        quietStart: '23:00', quietEnd: '08:00',
        dailyLimit: 3, cooldownMinutes: 120, prompt: '看看最近的对话和记忆，只有确实有想说的话时才主动联系。没有就只回复 [[SILENT]]。',
      },
      memoryConnectionId: null, createdAt: now, updatedAt: now,
    }],
  };
}
