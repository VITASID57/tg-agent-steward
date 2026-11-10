import { $ } from './dom.js';
import { showAvatar } from './bot-avatar.js';
import { loadBotDiagnostics } from './runtime-diagnostics.js';
import { renderTelegramAccess } from './telegram-access.js';

export function renderBotDetail(app, bot) {
  if (!bot) return;
  const connection = app.data.connections.find((item) => item.id === bot.chat?.connectionId);
  const profile = app.data.profiles.find((item) => item.id === bot.profileId);
  const voice = app.data.voiceProfiles.find((item) => item.id === bot.voice?.voiceProfileId);
  const image = app.data.imageProfiles.find((item) => item.id === bot.image?.imageProfileId);
  const voiceConnection = app.data.connections.find((item) => item.id === voice?.primary?.connectionId);
  const imageConnection = app.data.connections.find((item) => item.id === image?.primary?.connectionId);
  const memory = app.data.connections.find((item) => item.id === bot.memoryConnectionId);
  const channel = bot.channel?.type === 'wechat-clawbot' ? '微信' : 'Telegram';
  const configured = channel === '微信' ? bot.hasWechatAccount : bot.hasTelegramToken;

  $('#bot-detail').dataset.botId = bot.id;
  $('#bot-detail-name').textContent = bot.name || '未命名 Bot';
  $('#bot-detail-channel').textContent = channel;
  showAvatar($('#bot-detail-avatar'), bot.avatar, bot.name);

  const status = $('#bot-detail-status');
  status.className = `badge bot-detail-status ${bot.runtime?.running ? 'ok' : ''}`;
  status.textContent = bot.runtime?.running ? '运行中'
    : (bot.runtime?.lastError || (bot.enabled ? (configured ? '已启用 · 未运行' : '等待账号连接') : '已停用'));
  renderTelegramAccess(app, bot);

  setText('bot-detail-connection', connection?.name || '连接缺失');
  setText('bot-detail-model', bot.chat?.model || '后端默认模型');
  setText('bot-detail-profile', profile?.name || '人物缺失');
  setText('bot-detail-mode', connection?.options?.runtimeMode === 'agent' ? '完整 Agent' : '纯聊天');

  const features = [
    feature('消息入口', bot.enabled, `${channel} · ${configured ? '账号已连接' : '账号未连接'} · ${channel === '微信'
      ? (bot.wechat?.splitParagraphs ? '分句发送' : '整段发送')
      : (bot.telegram?.splitParagraphs ? '分句发送' : '整段发送')}`,
      bot.runtime?.running ? '运行中' : (bot.enabled ? '已启用' : '已停用')),
    feature(channel === '微信' ? '音频文件回复' : '语音回复', bot.voice?.enabled, bot.voice?.enabled
      ? `${voice?.name || '声音预设缺失'} · ${voiceConnection?.name || '首选连接未配置'} · ${voice?.primary?.model || '模型由连接决定'} · 回复概率 ${bot.voice.replyProbability ?? 0}%` : '不会主动发送语音'),
    feature('语音转写', Boolean(bot.voice?.transcriptionConnectionId) || (channel === '微信' && bot.wechat?.usePlatformTranscription),
      channel === '微信' ? (bot.wechat?.usePlatformTranscription ? '使用消息附带的转写文字' : '已关闭')
        : (bot.voice?.transcriptionConnectionId ? connectionName(app, bot.voice.transcriptionConnectionId) : '未选择转写连接')),
    feature('外置记忆', Boolean(memory), memory?.name || '未连接外置记忆'),
    ...(channel === '微信' ? [] : [feature('生图', bot.image?.enabled, bot.image?.enabled
      ? `${image?.name || '生图路线缺失'} · ${imageConnection?.name || '首选连接未配置'} · ${image?.primary?.model || '模型由连接决定'}` : '未开放生图命令')]),
    feature('表情包', bot.stickers?.enabled, bot.stickers?.enabled
      ? `${bot.stickers.packIds?.length || 0} 个表情包 · 回复概率 ${bot.stickers.replyProbability ?? 0}%` : '未启用表情回复'),
    feature('外部工具', bot.tools?.enabled, bot.tools?.enabled
      ? `${toolNames(app, bot).join('、') || '尚未选择连接'} · ${bot.tools.allowWrites ? '允许已授权写操作' : '只读优先'}` : '没有向模型开放 MCP 工具'),
    feature('主动唤醒', bot.wake?.enabled, bot.wake?.enabled ? wakeSummary(bot.wake) : '不会主动发起消息'),
  ];
  $('#bot-detail-features').replaceChildren(...features);
  loadBotDiagnostics(bot.id);
}

function feature(title, active, description, state = active ? '已启用' : '未启用') {
  const article = document.createElement('article'); article.className = `feature-card ${active ? 'is-active' : ''}`;
  const head = document.createElement('div'); const heading = document.createElement('strong'); const badge = document.createElement('span');
  heading.textContent = title; badge.textContent = state; head.append(heading, badge);
  const copy = document.createElement('p'); copy.textContent = description;
  article.append(head, copy); return article;
}

function wakeSummary(wake) {
  const rhythm = wake.scheduleMode === 'random'
    ? `${wake.randomMinMinutes ?? 45}–${wake.randomMaxMinutes ?? 120} 分钟随机`
    : `每 ${wake.intervalMinutes ?? 60} 分钟`;
  return `${rhythm} · 每天最多 ${wake.dailyLimit ?? 3} 条`;
}

function connectionName(app, id) {
  return app.data.connections.find((item) => item.id === id)?.name || '转写连接缺失';
}

function toolNames(app, bot) {
  return (bot.tools?.connectionIds || []).map((id) => app.data.connections.find((item) => item.id === id)?.name).filter(Boolean);
}

function setText(id, value) { $(`#${id}`).textContent = value; }
