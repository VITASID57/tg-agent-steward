export function createResourceDefinitions({ kinds, fillConnection, fillProfile, fillVoice, fillImage, fillSticker }) {
  const kindName = (kind) => kinds.find(([value]) => value === kind)?.[1] || kind;
  return [
    { key: 'connections', form: '#connection-form', picker: '#connection-picker', newButton: '#new-connection', title: '连接预设', singular: '连接', eyebrow: 'CONNECTION VAULT',
      description: '一个连接可供多只 Bot 或预设使用。', items: (data) => data.connections, fill: fillConnection,
      summary: (item) => `${kindName(item.kind)} · ${item.lastTest?.status === 'passed' ? '自检通过' : '尚未通过自检'}`,
      groups: groupConnections, facts: (_data, item) => [['类型', kindName(item.kind)], ['服务地址', item.baseUrl || '本机订阅 / CLI'], ['密钥', item.hasSecret ? '已保存' : '未保存'], ['最近自检', item.lastTest?.title || '尚未自检']] },
    { key: 'profiles', form: '#profile-form', picker: '#profile-picker', newButton: '#new-profile', title: '人物档案', singular: '人物', eyebrow: 'PROMPT MODULES',
      description: '每个人物独立保存启用中的规则模块。', items: (data) => data.profiles, fill: fillProfile,
      summary: (item) => `${item.blocks?.filter((block) => block.enabled && block.body).length || 0} 个启用模块`, facts: (_data, item) => [['规则模块', `${item.blocks?.length || 0} 个`], ['正在启用', `${item.blocks?.filter((block) => block.enabled && block.body).length || 0} 个`]] },
    { key: 'voices', form: '#voice-form', picker: '#voice-picker', newButton: '#new-voice', title: '声音预设', singular: '声音', eyebrow: 'VOICE ROUTES',
      description: '连接保存服务账号；声音预设只组合音色、模型和备用顺序，不会重复保存密钥。', items: (data) => data.voiceProfiles, fill: fillVoice,
      summary: routeCount, facts: (data, item) => routeFacts(data, item, '声音') },
    { key: 'images', form: '#image-form', picker: '#image-picker', newButton: '#new-image', title: '生图路线', singular: '生图路线', eyebrow: 'IMAGE ROUTES',
      description: '选择首选与备用连接；尺寸留空时按当次请求和提供方能力决定。', items: (data) => data.imageProfiles, fill: fillImage,
      summary: routeCount, facts: (data, item) => routeFacts(data, item, '生图') },
    { key: 'stickers', form: '#sticker-form', picker: '#sticker-picker', newButton: '#new-sticker-pack', title: '表情包', singular: '表情包', eyebrow: 'STICKER PACKS',
      description: '同一份表情包可分给多只 Bot。', items: (data) => data.stickerPacks, fill: fillSticker,
      summary: (item) => `${item.stickers?.length || 0} 张表情`, facts: (_data, item) => [['表情数量', `${item.stickers?.length || 0} 张`], ['已启用', `${item.stickers?.filter((entry) => entry.enabled).length || 0} 张`]] },
  ];
}

function groupConnections(items) {
  const groups = [['聊天模型', 'chat'], ['声音与转写', 'tts'], ['生图', 'image'], ['记忆与工具', 'memory']];
  const seen = new Set(); return groups.map(([title, capability]) => ({ title, items: items.filter((item) => {
    if (seen.has(item.id) || !item.capabilities.includes(capability)) return false; seen.add(item.id); return true;
  }) })).concat([{ title: '其他', items: items.filter((item) => !seen.has(item.id)) }]);
}

function routeCount(item) { return `${[item.primary, ...(item.fallbacks || [])].filter(Boolean).length} 条线路`; }
function routeFacts(data, item, label) {
  const routes = [item.primary, ...(item.fallbacks || [])].filter(Boolean); const primary = routes[0];
  const connection = data.connections.find((entry) => entry.id === primary?.connectionId);
  return [['线路数量', `${routes.length} 条`], ['首选连接', connection?.name || '尚未配置'], ['首选模型', primary?.model || '由连接决定'], [label === '声音' ? '音色 ID' : '尺寸', label === '声音' ? (primary?.voiceId || '尚未填写') : (primary?.size || '按请求决定')]];
}
