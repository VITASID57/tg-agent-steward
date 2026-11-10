import { $, options } from './dom.js';

export function bindWakeTargetEditor() {
  $('#bot-wake-enabled').addEventListener('change', (event) => {
    const select = $('#bot-wake-telegram-chat');
    if (event.target.checked && $('#bot-channel').value === 'telegram' && !select.value) {
      const owner = select.querySelector('[data-owner]');
      if (owner) select.value = owner.value;
    }
  });
}

export function fillWakeTarget(bot) {
  const isWechat = bot?.channel?.type === 'wechat-clawbot';
  const savedTarget = bot?.wake?.targetChatId || '';
  const wechatUsers = bot?.wechat?.allowedUserIds || [];
  $('#bot-wake-wechat-chat').value = isWechat ? savedTarget || (wechatUsers.length === 1 ? wechatUsers[0] : '') : '';

  const select = $('#bot-wake-telegram-chat');
  const ownerId = bot?.telegramAccess?.ownerChatId;
  const allowed = bot?.telegram?.allowedChatIds || [];
  const target = isWechat ? '' : savedTarget;
  const choices = allowed.map((chatId) => ({
    value: chatId, label: chatId === ownerId ? '我的 Telegram 私聊' : `已授权会话（${chatId}）`,
  }));
  if (target && !allowed.includes(target)) choices.push({ value: target, label: '原目标已失去授权，请重新选择' });
  options(select, choices, target, '选择已授权会话');
  const owner = [...select.options].find((option) => option.value && option.value === ownerId);
  if (owner) owner.dataset.owner = '';
  $('#bot-wake-telegram-hint').textContent = owner
    ? '选「我的 Telegram 私聊」，保存后按设定的节奏发送。'
    : '要发给自己，先保存 Bot，再到详情里的「用我的 Telegram 账号聊天」完成绑定或授权，然后回这里选私聊。';
}

export function wakeTarget(channel) {
  const selector = channel === 'wechat-clawbot' ? '#bot-wake-wechat-chat' : '#bot-wake-telegram-chat';
  return $(selector).value || null;
}
