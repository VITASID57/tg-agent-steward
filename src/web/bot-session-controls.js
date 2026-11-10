import { api, jsonBody } from './api.js';
import { $, options } from './dom.js';

let rendered = 0;
const pending = new Map();

export function renderBotSessionControls(bot) {
  const version = ++rendered;
  const target = $('#bot-session-target');
  const start = $('#bot-session-new');
  const startOptions = $('#bot-session-new-options');
  const withSummary = $('#bot-session-new-summary');
  const withoutSummary = $('#bot-session-new-fresh');
  const compact = $('#bot-session-compact');
  const result = $('#bot-session-result');
  const wechat = bot.channel?.type === 'wechat-clawbot';
  const allowed = (wechat ? bot.wechat?.allowedUserIds : bot.telegram?.allowedChatIds) || [];
  const owner = wechat ? '' : bot.telegramAccess?.ownerChatId;
  const choices = allowed.map((value) => ({ value, label: value === owner ? '我的 Telegram 私聊'
    : `${wechat ? '微信会话' : value.startsWith('-') ? 'Telegram 群聊' : 'Telegram 私聊'} · ${value}` }));
  const initial = allowed.length === 1 ? allowed[0] : allowed.includes(owner) ? owner : '';
  options(target, choices, initial, '选择已授权的会话');
  $('#bot-session-target-field').hidden = choices.length < 2;
  const help = $('#bot-session-help');
  help.hidden = choices.length > 0;
  help.textContent = `先${wechat ? '扫码连接并授权微信会话' : '绑定 Telegram 私聊'}，再管理会话。`;
  display('');
  showOptions(false);
  refresh();
  if (pending.has(bot.id)) void pending.get(bot.id).then(() => { if (rendered === version) refresh(); });
  target.onchange = () => { display(''); showOptions(false); refresh(); };
  start.onclick = () => showOptions(startOptions.hidden);
  withSummary.onclick = () => run('new', true);
  withoutSummary.onclick = () => run('new', false);
  compact.onclick = () => run('compact');

  function showOptions(expanded) {
    startOptions.hidden = !expanded;
    start.setAttribute('aria-expanded', String(expanded));
  }

  function refresh() {
    const blocked = !target.value || pending.has(bot.id);
    start.disabled = blocked;
    withSummary.disabled = blocked;
    withoutSummary.disabled = blocked;
    compact.disabled = blocked;
    target.disabled = pending.has(bot.id);
  }

  function display(message) {
    result.hidden = !message;
    result.textContent = message;
  }

  async function run(action, carrySummary = false) {
    const chatId = target.value;
    if (!chatId || pending.has(bot.id)) return;
    const opening = action === 'new';
    const question = opening ? (carrySummary
      ? '带着上一段的摘要开启新会话？整理摘要可能消耗模型用量。'
      : '不带摘要开启新会话？旧聊天仍留在手机里，已启用的外置记忆也会照常加载。')
      : '压缩这段会话？会保留要点，部分细节可能丢失，操作可能消耗模型用量。';
    if (!confirm(question)) return;
    display(opening && !carrySummary ? '正在开启新会话…' : '正在整理上文…');
    const body = { botId: bot.id, chatId, ...(opening ? { carrySummary } : {}) };
    const task = api(`/api/session/${action}`, { method: 'POST', body: jsonBody(body) })
      .then((response) => ({ ok: response.ok, message: resultMessage(action, carrySummary, response) }))
      .catch((error) => ({ ok: false, message: error.message }))
      .finally(() => pending.delete(bot.id));
    pending.set(bot.id, task);
    refresh();
    const { ok, message } = await task;
    if (rendered === version) {
      if (opening && ok) showOptions(false);
      display(message);
      refresh();
      if (opening && ok) start.focus();
    }
  }
}

function resultMessage(action, carrySummary, response) {
  if (action === 'new') {
    if (!response.ok) return '当前没有可整理的上文，可以选择「不带摘要」。';
    return carrySummary ? '已开启新会话，下一轮会带上摘要。' : '已开启新会话，下一轮从头聊。';
  }
  if (!response.ok) return '当前没有可压缩的会话。';
  return response.mode === 'handoff' ? '已保存摘要，下一轮会带着摘要继续。' : '会话已压缩，可以继续聊。';
}
