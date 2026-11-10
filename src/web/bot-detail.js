import { $ } from './dom.js';
import { showAvatar } from './bot-avatar.js';
import { loadBotDiagnostics } from './runtime-diagnostics.js';
import { renderTelegramAccess } from './telegram-access.js';
import { extraChannelLabel } from './bot-channel-label.js';
import { renderBotSessionControls } from './bot-session-controls.js';

export function renderBotDetail(app, bot) {
  if (!bot) return;
  const connection = app.data.connections.find((item) => item.id === bot.chat?.connectionId);
  const profile = app.data.profiles.find((item) => item.id === bot.profileId);
  const voice = app.data.voiceProfiles.find((item) => item.id === bot.voice?.voiceProfileId);
  const image = app.data.imageProfiles.find((item) => item.id === bot.image?.imageProfileId);
  const memory = app.data.connections.find((item) => item.id === bot.memoryConnectionId);
  const channel = bot.channel?.type === 'wechat-clawbot' ? '微信' : 'Telegram';
  const configured = channel === '微信' ? bot.hasWechatAccount : bot.hasTelegramToken;

  $('#bot-detail').dataset.botId = bot.id;
  $('#bot-detail-name').textContent = bot.name || '未命名 Bot';
  const channelLabel = extraChannelLabel(bot);
  setText('bot-detail-channel', channelLabel);
  $('#bot-detail-channel').hidden = !channelLabel;
  showAvatar($('#bot-detail-avatar'), bot.avatar, bot.name);

  const status = $('#bot-detail-status');
  status.className = `badge ${bot.runtime?.running ? 'ok' : ''}`;
  status.textContent = bot.runtime?.running ? '运行中'
    : (bot.runtime?.lastError || (bot.enabled ? (configured ? '已启用 · 未运行' : '等待账号连接') : '已停用'));
  renderTelegramAccess(app, bot);
  renderBotSessionControls(bot);

  setText('bot-detail-connection', connection?.name || '连接缺失');
  setText('bot-detail-model', bot.chat?.model || '后端默认模型');
  setText('bot-detail-profile', profile?.name || '人物缺失');
  setText('bot-detail-mode', connection?.options?.runtimeMode === 'agent' ? '完整 Agent' : '纯聊天');

  const features = [
    feature('语音回复', bot.voice?.enabled, voice?.name || '未选声音预设',
      `回复概率 ${bot.voice?.replyProbability ?? 0}%${channel === '微信' ? ' · 音频文件' : ''}`),
    channel === '微信' ? feature('语音转写', bot.wechat?.usePlatformTranscription, '使用微信附带的转写')
      : feature('语音转写', Boolean(bot.voice?.transcriptionConnectionId), connectionName(app, bot.voice?.transcriptionConnectionId)),
    feature('外置记忆', Boolean(memory), memory?.name),
    ...(channel === '微信' ? [] : [feature('生图', bot.image?.enabled, image?.name || '未选生图路线', image?.primary?.model)]),
    feature('表情包', bot.stickers?.enabled,
      `${bot.stickers?.packIds?.length || 0} 个表情包`, `回复概率 ${bot.stickers?.replyProbability ?? 0}%`),
    feature('外部工具', bot.tools?.enabled, toolNames(app, bot).join('、') || '未选工具连接',
      bot.tools?.allowWrites ? '允许已授权写操作' : '只读'),
    feature('主动唤醒', bot.wake?.enabled, ...wakeSummary(bot.wake)),
  ];
  $('#bot-detail-features').replaceChildren(...features);
  loadBotDiagnostics(bot.id);
}

function feature(title, active, ...lines) {
  const article = document.createElement('article'); article.className = `feature-card ${active ? 'is-active' : ''}`;
  const head = document.createElement('div'); const heading = document.createElement('strong'); const badge = document.createElement('span');
  heading.textContent = title; badge.textContent = active ? '已启用' : '未启用'; head.append(heading, badge);
  article.append(head);
  if (active) for (const line of new Set(lines.filter(Boolean))) {
    const copy = document.createElement('p'); copy.textContent = line; article.append(copy);
  }
  return article;
}

function wakeSummary(wake = {}) {
  const rhythm = wake.scheduleMode === 'random'
    ? `${wake.randomMinMinutes ?? 45}–${wake.randomMaxMinutes ?? 120} 分钟随机`
    : `每 ${wake.intervalMinutes ?? 60} 分钟`;
  return [rhythm, `每天最多 ${wake.dailyLimit ?? 3} 条`];
}

function connectionName(app, id) {
  return app.data.connections.find((item) => item.id === id)?.name || '转写连接缺失';
}

function toolNames(app, bot) {
  return (bot.tools?.connectionIds || []).map((id) => app.data.connections.find((item) => item.id === id)?.name).filter(Boolean);
}

function setText(id, value) { $(`#${id}`).textContent = value; }
