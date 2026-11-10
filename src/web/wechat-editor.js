import { api, jsonBody } from './api.js';
import { $, toast } from './dom.js';
import { refreshBotSections } from './bot-sections.js';

let pollTimer = null;
let pollBusy = false;
let loginRevision = 0;
let ensureBotSaved = null;
const loginLabels = {
  waiting: '等待扫码', scanned: '已扫码，请在微信确认', expired: '二维码已过期',
  connected: '微信已连接，Bot 已启动', idle: '扫码已结束，请重新获取二维码',
  starting: '微信已授权，正在检查消息连接…',
  'needs-verification': '请填写手机微信显示的数字',
  'verification-blocked': '数字校验暂时被限制，请重新获取二维码',
  'already-bound': '微信报告已有绑定，请在微信 ClawBot 中检查原连接',
  'saved-not-running': '微信已授权，启用 Bot 后才会开始接收消息',
  'session-expired': '微信返回会话已失效（-14），请重新获取二维码并在微信确认',
  'start-failed': '微信已授权，但 Bot 启动失败。请查看运行状态',
};
const pendingStates = new Set(['waiting', 'scanned', 'needs-verification', 'starting']);

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
  $('#wechat-verify-code').value = '';
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
  $('#bot-voice-delivery-hint').textContent = channel === 'wechat-clawbot'
    ? '微信 ClawBot 会收到可播放的音频文件，当前未开放原生语音条。'
    : 'Telegram 可直接收到语音回复。';
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
  $('#wechat-verify-box').hidden = true;
  $('#wechat-verify-code').value = '';
  $('#wechat-login-start').disabled = true; $('#wechat-login-state').textContent = '正在获取二维码…';
  try {
    $('#wechat-login-state').textContent = '正在保存当前设置…';
    botId = await ensureBotSaved?.();
    if (!botId) throw new Error('没有成功保存这张 Bot 卡');
    const revision = loginRevision;
    const result = await api('/api/wechat/login/start', { method: 'POST', body: jsonBody({ botId }) });
    if (revision !== loginRevision) return;
    $('#wechat-qr-image').src = result.image; $('#wechat-login-box').hidden = false;
    $('#wechat-login-state').textContent = '等待扫码';
    pollTimer = setInterval(() => pollLogin(app, botId, revision), 2000);
  } catch (error) { toast(error.message, true); }
  finally { $('#wechat-login-start').disabled = false; }
}

async function pollLogin(app, botId, revision) {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const result = await api(`/api/wechat/login/status?botId=${encodeURIComponent(botId)}`);
    if (revision !== loginRevision) return;
    const label = loginLabels[result.status] || '微信返回未知扫码状态，请重新获取二维码';
    $('#wechat-login-state').textContent = label;
    $('#wechat-verify-box').hidden = result.status !== 'needs-verification';
    if (!pendingStates.has(result.status)) {
      clearPolling();
      if (result.status === 'connected' || result.status === 'saved-not-running') {
        toast(label);
        await app.reload();
      } else if (result.status === 'session-expired' || result.status === 'start-failed') {
        $('#bot-runtime-state').textContent = label;
        $('#wechat-disconnect').disabled = false;
      }
    }
  } catch (error) {
    if (revision !== loginRevision) return;
    clearPolling();
    $('#wechat-login-state').textContent = error.message;
  } finally { if (revision === loginRevision) pollBusy = false; }
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
  loginRevision += 1;
}
