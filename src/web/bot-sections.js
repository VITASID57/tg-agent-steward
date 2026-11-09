import { $, $$, csv } from './dom.js';

export function bindBotSections() {
  for (const [id, open] of [['bot-collapse-all', false], ['bot-expand-all', true]]) {
    $(`#${id}`).onclick = () => { for (const section of $$('.bot-section')) section.open = open; };
  }
  $('#bot-form').addEventListener('input', refreshBotSections);
  $('#bot-form').addEventListener('change', refreshBotSections);
  $('#bot-form').addEventListener('invalid', (event) => {
    const section = event.target.closest('details');
    if (section) section.open = true;
  }, true);
}

export function refreshBotSections() {
  const value = (name) => $(`#bot-${name}`).value;
  const enabled = (name) => $(`#bot-${name}`).checked;
  const choice = (name) => $(`#bot-${name}`).selectedOptions[0]?.textContent || '待选择';
  const count = (name) => $(`#bot-${name}`).selectedOptions.length;
  const channel = value('channel') || 'telegram';
  const statuses = {
    account: `${channel === 'wechat-clawbot' ? '微信' : 'Telegram'} · ${enabled('enabled') ? '已启用' : '已停用'}`,
    chat: `${choice('profile')} · ${value('model') || '后端默认模型'}`,
    voice: `${enabled('voice-enabled') ? `回复 ${value('voice-probability')}%` : '语音回复关闭'} · ${value('transcription') ? '已接听写' : '未接听写'}`,
    memory: choice('memory'),
    image: enabled('image-enabled') ? choice('image-profile') : '未启用',
    stickers: enabled('stickers-enabled') ? `${count('sticker-packs')} 包 · ${value('sticker-probability')}%` : '未启用',
    tools: enabled('tools-enabled') ? `${count('tool-connections')} 个连接` : '未启用',
    wake: enabled('wake-enabled')
      ? `${value('wake-mode') === 'random' ? `${value('wake-random-min')}–${value('wake-random-max')} 分钟随机` : `每 ${value('wake-interval')} 分钟`} · 每天最多 ${value('wake-limit')} 条`
      : '未启用',
    channel: channel === 'wechat-clawbot'
      ? `${csv(value('wechat-allowed')).length} 个已允许用户 · ${enabled('wechat-split') ? '分句开' : '分句关'}`
      : `${csv(value('allowed')).length} 个已允许的聊天 · ${enabled('telegram-split') ? '分句开' : '分句关'} · ${enabled('telegram-merge') ? '连发合并开' : '连发合并关'}`,
  };
  for (const node of $$('[data-section-status]')) node.textContent = statuses[node.dataset.sectionStatus];
  $('#bot-voice-value').textContent = `${value('voice-probability')}%`;
  $('#bot-sticker-value').textContent = `${value('sticker-probability')}%`;
}
