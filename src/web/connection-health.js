import { api, jsonBody } from './api.js';
import { $ } from './dom.js';

export function bindConnectionTest() {
  $('#test-connection').onclick = runConnectionTest;
}

export function fillConnectionTest(connection) {
  const button = $('#test-connection');
  button.disabled = !connection?.id;
  render(connection?.lastTest || null, connection?.id ? '点击自检，不会发起付费生成请求。' : '先保存连接，再进行自检。');
}

async function runConnectionTest() {
  const connectionId = $('#connection-id').value; if (!connectionId) return;
  const button = $('#test-connection'); button.disabled = true; button.textContent = '检测中…';
  render(null, '正在检查配置与可用入口…', 'testing');
  try {
    const result = await api('/api/connections/test', { method: 'POST', body: jsonBody({ connectionId }) });
    render(result);
  } catch (error) {
    render({ status: 'failed', title: '自检请求失败', message: error.message, at: new Date().toISOString() });
  } finally { button.disabled = false; button.textContent = '连接自检'; }
}

function render(result, fallback = '', forceStatus = '') {
  const host = $('#connection-test-result'); host.replaceChildren();
  const status = forceStatus || result?.status || '';
  host.className = `connection-test-result${status ? ` is-${status}` : ''}`;
  const dot = document.createElement('span'); dot.className = 'connection-test-dot'; dot.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = result?.title || fallback;
  copy.append(title);
  if (result?.message) { const detail = document.createElement('small'); detail.textContent = result.message; copy.append(detail); }
  if (result?.at) { const time = document.createElement('time'); time.dateTime = result.at; time.textContent = formatTime(result.at); copy.append(time); }
  host.append(dot, copy);
}

function formatTime(value) {
  const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `最近检测：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}
