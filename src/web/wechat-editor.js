import { api, jsonBody } from './api.js';
import { $, toast } from './dom.js';
import { refreshBotSections } from './bot-sections.js';

let pollTimer = null;
let pollBusy = false;
let ensureBotSaved = null;

export function bindWechatEditor(app, saveDraft) {
  ensureBotSaved = saveDraft;
  $('#bot-channel').onchange = showChannelFields;
  $('#wechat-login-start').onclick = () => startLogin(app);
  $('#wechat-disconnect').onclick = () => disconnect(app);
  $('#wechat-pair-button').onclick = () => createWechatPairCode();
  $('#wechat-verify-submit').onclick = () => submitVerifyCode();
}

export function fillWechatEditor(item) {
  clearPolling();
  $('#wechat-login-box').hidden = true;
  $('#wechat-verify-box').hidden = true;
  $('#wechat-login-start').disabled = false;
  $('#wechat-disconnect').disabled = !item?.hasWechatAccount;
  showChannelFields();
}

function showChannelFields() {
  const channel = $('#bot-channel').value || 'telegram';
  for (const node of document.querySelectorAll('[data-channel-panel], [data-channel-detail]')) {
    node.hidden = (node.dataset.channelPanel || node.dataset.channelDetail) !== channel;
  }
  for (const node of document.querySelectorAll('[data-telegram-only]')) node.hidden = channel !== 'telegram';
  $('#bot-transcription').disabled = channel === 'wechat-clawbot';
  $('#bot-wake-target-label').textContent = channel === 'wechat-clawbot' ? '目标微信 User ID' : '目标 Chat ID';
  $('#bot-channel-section-title').textContent = channel === 'telegram' ? '配对与 Telegram 行为' : '微信权限与行为';
  refreshBotSections();
}

async function createWechatPairCode() {
  const botId = $('#bot-id').value;
  if (!botId) return toast('请先保存 Bot', true);
  const result = await api('/api/pairing-code', { method: 'POST', body: jsonBody({ botId }) });
  $('#wechat-pair-code').textContent = result.code;
}

async function startLogin(app) {
  let botId = $('#bot-id').value;
  clearPolling();
  $('#wechat-login-start').disabled = true; $('#wechat-login-state').textContent = '正在获取二维码…';
  try {
    if (!botId) { $('#wechat-login-state').textContent = '正在保存当前设置…'; botId = await ensureBotSaved?.(); }
    if (!botId) throw new Error('没有成功保存这张 Bot 卡');
    const result = await api('/api/wechat/login/start', { method: 'POST', body: jsonBody({ botId }) });
    $('#wechat-qr-image').src = result.image; $('#wechat-login-box').hidden = false;
    $('#wechat-login-state').textContent = '等待扫码';
    pollTimer = setInterval(() => pollLogin(app, botId), 2000);
  } catch (error) { toast(error.message, true); }
  finally { $('#wechat-login-start').disabled = false; }
}

async function pollLogin(app, botId) {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const result = await api(`/api/wechat/login/status?botId=${encodeURIComponent(botId)}`);
    const labels = { waiting: '等待扫码', scanned: '已扫码，请在微信确认', expired: '二维码已过期', connected: '微信已连接', idle: '尚未开始扫码',
      'needs-verification': '请填写手机微信显示的数字', 'verification-blocked': '数字校验暂时被限制，请重新获取二维码', 'already-bound': '这个微信已绑定过；请先在原连接解除' };
    $('#wechat-login-state').textContent = labels[result.status] || result.status;
    $('#wechat-verify-box').hidden = result.status !== 'needs-verification';
    if (result.status === 'connected') { clearPolling(); toast('微信账号已连接'); await app.reload(); }
    if (result.status === 'expired') clearPolling();
  } catch (error) { clearPolling(); toast(error.message, true); }
  finally { pollBusy = false; }
}

async function submitVerifyCode() {
  const botId = $('#bot-id').value; const code = $('#wechat-verify-code').value.trim();
  try {
    await api('/api/wechat/login/verify', { method: 'POST', body: jsonBody({ botId, code }) });
    $('#wechat-verify-box').hidden = true; $('#wechat-login-state').textContent = '正在校验…';
  } catch (error) { toast(error.message, true); }
}

async function disconnect(app) {
  const botId = $('#bot-id').value;
  if (!botId || !confirm('解除这张 Bot 卡的微信扫码授权？人物和模型设置会保留。')) return;
  await api(`/api/wechat/account?botId=${encodeURIComponent(botId)}`, { method: 'DELETE' });
  clearPolling(); toast('微信连接已解除'); await app.reload();
}

function clearPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null; pollBusy = false;
}
