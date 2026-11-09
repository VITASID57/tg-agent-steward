import { api, savedToken, setToken } from './api.js';
import { $, $$ } from './dom.js';
import { bindEditors, fillEditors } from './editors.js';
import { initMotion, revealWorkspace, showPage } from './motion.js';
import { openBotDetail, openBotEditor } from './bot-cards.js';

const app = { data: null, reload };
let authRequired = true;
bindEditors(app);
initMotion();

const oneTimeToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (oneTimeToken) { setToken(oneTimeToken); history.replaceState(null, '', `${location.pathname}${location.search}`); }
$('#admin-token').value = savedToken();
$('#token-visibility').onclick = () => {
  const visible = $('#admin-token').type === 'password'; $('#admin-token').type = visible ? 'text' : 'password';
  $('#token-visibility').textContent = visible ? '隐藏' : '显示';
  $('#token-visibility').setAttribute('aria-pressed', String(visible));
  $('#token-visibility').setAttribute('aria-label', visible ? '隐藏管理密码' : '显示管理密码');
};
$('#connect-button').onclick = connect;
$('#forget-login').onclick = forgetLogin;
$('#admin-token').onkeydown = (event) => { if (event.key === 'Enter') connect(); };
$('#refresh-button').onclick = reload;
for (const button of $$('[data-tab]')) button.onclick = () => showPage(button.dataset.tab);
for (const button of $$('[data-goto]')) button.onclick = () => showPage(button.dataset.goto);
$('.brand').onclick = (event) => { event.preventDefault(); if (!$('#app').hidden) showPage('overview'); };
const initialPage = location.hash.slice(1);
if ($$('[data-tab]').some((button) => button.dataset.tab === initialPage)) showPage(initialPage, false);
boot();

async function boot() {
  try {
    const response = await fetch('/healthz'); const status = await response.json();
    authRequired = status.authRequired !== false;
    if (!authRequired) await connect(); else if (savedToken()) await connect();
  } catch { if (savedToken()) await connect(); }
}

async function connect() {
  if ($('#connect-button').disabled) return;
  const enteredToken = $('#admin-token').value.trim() || savedToken();
  $('#login-error').hidden = true;
  if (authRequired && !enteredToken) { $('#login-error').textContent = '请先输入管理密码，下面的说明可以帮你找到或设置它。'; $('#login-error').hidden = false; $('#admin-token').focus(); return; }
  setToken(enteredToken);
  $('#connect-button').disabled = true; $('#connect-button').textContent = '正在连接…';
  $('#connection-pill b').textContent = '连接中';
  try {
    await reload();
    revealWorkspace();
    $('#forget-login').hidden = !authRequired;
    $('#connection-pill').classList.add('online'); $('#connection-pill b').textContent = '已连接';
  } catch (error) {
    $('#login-panel').hidden = false; $('#app').hidden = true; document.body.classList.remove('connected');
    if (error.status === 401) setToken('');
    $('#login-error').textContent = error.status === 401 ? '密码没有匹配。请使用部署时设置的管理密码，或当前数据目录中的 .admin-token。' : `暂时没有连接成功：${error.message}`;
    $('#login-error').hidden = false;
    $('#connection-pill').classList.remove('online'); $('#connection-pill b').textContent = '未连接';
  } finally {
    $('#connect-button').disabled = false; $('#connect-button').textContent = '进入管家 ↗';
  }
}

function forgetLogin() {
  if (!confirm('忘记这台设备上的管家登录？下次打开时需要重新输入管理密码。')) return;
  setToken('');
  location.reload();
}

async function reload() {
  app.data = await api('/api/control-plane'); renderOverview(); fillEditors(app); return app.data;
}

function renderOverview() {
  $('#count-connections').textContent = app.data.connections.length; $('#count-bots').textContent = app.data.bots.length;
  const moduleCounts = {
    profiles: app.data.profiles.length,
    voices: app.data.voiceProfiles.length,
    images: app.data.imageProfiles.length,
    stickers: app.data.stickerPacks.length,
  };
  Object.entries(moduleCounts).forEach(([name, value]) => {
    $(`[data-module-count="${name}"]`).textContent = value;
  });
  const running = app.data.bots.filter((bot) => bot.runtime?.running).length; $('#running-bots').textContent = `${running} 个运行中`;
  const list = $('#bot-status-list'); list.replaceChildren();
  for (const bot of app.data.bots) {
    const connection = app.data.connections.find((item) => item.id === bot.chat.connectionId);
    const profile = app.data.profiles.find((item) => item.id === bot.profileId);
    const card = document.createElement('button'); card.type = 'button'; card.className = 'status-row';
    const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = bot.name;
    const channel = bot.channel?.type === 'wechat-clawbot' ? '微信' : 'Telegram';
    const detail = document.createElement('small'); detail.textContent = `${channel} · ${connection?.name || '连接缺失'} · ${bot.chat.model || '后端默认模型'} · ${profile?.name || '人物缺失'}${channel === 'Telegram' ? ` · 语音 ${bot.voice.replyProbability}%` : ''}`;
    const badge = document.createElement('span'); badge.className = `badge ${bot.runtime?.running ? 'ok' : ''}`;
    badge.textContent = bot.runtime?.running ? '运行中' : (bot.runtime?.lastError || (bot.enabled ? '等待 Token' : '已停用'));
    copy.append(title, detail); card.append(copy, badge); card.onclick = () => { showPage('bots'); openBotDetail(bot.id); }; list.append(card);
  }
  if (!app.data.bots.length) list.textContent = '还没有 Bot。';
  renderMonitorCards();
}

function renderMonitorCards() {
  const host = $('#bot-monitor-cards'); host.replaceChildren();
  for (const bot of app.data.bots) {
    const connection = app.data.connections.find((item) => item.id === bot.chat.connectionId);
    const card = document.createElement('article'); card.className = 'bot-monitor-card';
    const title = document.createElement('strong'); title.textContent = bot.name || '未命名 Bot';
    const detail = document.createElement('small'); detail.textContent = `${bot.channel?.type === 'wechat-clawbot' ? '微信' : 'Telegram'} · ${connection?.name || '连接缺失'} · ${bot.runtime?.running ? '运行中' : '未运行'}`;
    const actions = document.createElement('div'); actions.className = 'button-row';
    const view = document.createElement('button'); view.type = 'button'; view.className = 'quiet'; view.textContent = '查看';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑';
    view.onclick = () => { showPage('bots'); openBotDetail(bot.id); }; edit.onclick = () => { showPage('bots'); openBotEditor(bot.id); };
    actions.append(view, edit); card.append(title, detail, actions); host.append(card);
  }
  if (!app.data.bots.length) host.textContent = '还没有 Bot。';
}
