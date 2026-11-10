import { api, jsonBody } from './api.js';
import { $ } from './dom.js';
import { refreshResourceBrowsers } from './resource-browser.js';

let editorVersion = 0;

export function bindConnectionTest(app) {
  $('#test-connection').onclick = () => runConnectionTest(app);
}

export function fillConnectionTest(connection) {
  editorVersion += 1;
  const button = $('#test-connection');
  button.disabled = !connection?.id;
  button.textContent = '连接自检';
  render(connection?.lastTest || null, connection?.id ? '自检使用已保存的设置，不发起生成请求。' : '先保存连接，再进行自检。');
}

async function runConnectionTest(app) {
  const connectionId = $('#connection-id').value; if (!connectionId) return;
  const version = editorVersion;
  const checked = app.data.connections.find((item) => item.id === connectionId);
  const button = $('#test-connection'); button.disabled = true; button.textContent = '检测中…';
  render(null, '正在检查配置与可用入口…', 'testing');
  try {
    const result = await api('/api/connections/test', { method: 'POST', body: jsonBody({ connectionId }) });
    const current = app.data.connections.find((item) => item.id === connectionId);
    if (current && current.updatedAt === checked?.updatedAt && (!current.lastTest || current.lastTest.at <= result.at)) {
      current.lastTest = result;
      refreshResourceBrowsers(app);
    }
    if (editorVersion === version) render(current?.lastTest || null, '连接设置已更新，请重新自检。');
  } catch (error) {
    if (editorVersion === version) render(null, error.message);
  } finally {
    if (editorVersion === version) { button.disabled = false; button.textContent = '连接自检'; }
  }
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
