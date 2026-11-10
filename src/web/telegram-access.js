import { api, jsonBody } from './api.js';
import { $ } from './dom.js';

let pollTimer = null;
let version = 0;

export function renderTelegramAccess(app, bot) {
  clearTimeout(pollTimer);
  const current = ++version;
  const panel = $('#bot-telegram-access');
  panel.hidden = bot.channel?.type === 'wechat-clawbot';
  if (panel.hidden) return;
  const status = $('#telegram-access-status');
  const button = $('#telegram-access-start');
  const link = $('#telegram-access-link');
  link.hidden = true;
  button.hidden = true;
  button.disabled = false;
  const username = bot.runtime?.username;
  if (!bot.runtime?.running || !username) {
    status.textContent = !bot.enabled ? '先在 Bot 设置里启用，再连接你的账号。'
      : (bot.runtime?.lastError || '保存 BotFather Token 后，这里会显示下一步。');
    return;
  }
  if (bot.telegramAccess?.allowed) {
    status.textContent = '你的 Telegram 账号已经可以使用这个 Bot。';
    link.href = `https://t.me/${username}`;
    link.textContent = '打开 Telegram 聊天';
    link.hidden = false;
    return;
  }
  const hasOwner = bot.telegramAccess?.hasOwner;
  const alreadyHasChats = bot.telegram?.allowedChatIds?.length > 0;
  status.textContent = hasOwner ? 'Telegram 已连接。点一下，让你已绑定的账号使用这个 Bot。'
    : alreadyHasChats ? '已有账号获准聊天。绑定你的账号后，新 Bot 可以直接复用。'
      : 'Telegram 已连接。打开 Telegram，点「开始」即可绑定你的账号。';
  button.textContent = hasOwner ? '允许我的 Telegram 账号' : '去 Telegram 绑定我';
  button.hidden = false;
  button.onclick = () => startAccess(app, bot.id, current);
}

async function startAccess(app, botId, current) {
  const status = $('#telegram-access-status');
  const button = $('#telegram-access-start');
  const link = $('#telegram-access-link');
  clearTimeout(pollTimer);
  const popup = window.open('', '_blank');
  if (popup) popup.opener = null;
  button.disabled = true;
  status.textContent = '正在准备 Telegram 连接…';
  try {
    const result = await api('/api/telegram/owner-access', { method: 'POST', body: jsonBody({ botId }) });
    if (!active(current)) { popup?.close(); return; }
    if (popup && !popup.closed) popup.location.replace(result.url);
    link.href = result.url;
    link.textContent = result.allowed ? '打开 Telegram 聊天' : '打开 Telegram 并点「开始」';
    link.hidden = false;
    if (result.allowed) {
      status.textContent = '已允许你的 Telegram 账号。';
      await app.reload();
    } else {
      status.textContent = '请在 Telegram 点「开始」，本页会自动确认。';
      button.textContent = '重新打开绑定链接';
      watchBinding(app, botId, current, Date.parse(result.expiresAt));
    }
  } catch (error) {
    popup?.close();
    if (active(current)) status.textContent = error.message;
  } finally { if (active(current)) button.disabled = false; }
}

function watchBinding(app, botId, current, expiresAt) {
  pollTimer = setTimeout(async () => {
    if (!active(current)) return;
    if (Date.now() >= expiresAt) {
      $('#telegram-access-status').textContent = '绑定链接已过期，可以重新打开。';
      $('#telegram-access-link').hidden = true;
      return;
    }
    try {
      const state = await api(`/api/telegram/owner-access?botId=${encodeURIComponent(botId)}`);
      if (!active(current)) return;
      if (state.allowed) {
        await app.reload();
        return;
      }
    } catch { /* A transient status failure can be retried until the link expires. */ }
    if (active(current)) watchBinding(app, botId, current, expiresAt);
  }, 2000);
}

function active(current) {
  return current === version && !$('#bot-telegram-access').closest('[hidden]');
}
