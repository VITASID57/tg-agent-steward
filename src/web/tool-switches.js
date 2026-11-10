import { api } from './api.js';
import { $, csv } from './dom.js';

let disabled = new Map();
let catalog = [];
let revision = 0;

export function bindToolSwitches() {
  $('#bot-tool-load').onclick = load;
  $('#bot-tool-connections').addEventListener('change', resetCatalog);
  $('#bot-tool-names').addEventListener('input', render);
}

export function fillToolSwitches(tools) {
  disabled = new Map(Object.entries(tools?.disabledByConnection || {}).map(([id, names]) => [id, new Set(names)]));
  resetCatalog();
}

export function disabledToolSettings() {
  return Object.fromEntries(selectedConnections().map(({ value }) => [value, [...(disabled.get(value) || [])]])
    .filter(([, names]) => names.length));
}

function selectedConnections() {
  return [...$('#bot-tool-connections').selectedOptions];
}

function resetCatalog() {
  revision += 1;
  catalog = [];
  const button = $('#bot-tool-load');
  button.disabled = !selectedConnections().length;
  $('#bot-tool-status').textContent = button.disabled ? '先选择工具连接。' : '载入后可逐个打开或关闭。';
  render();
}

async function load() {
  const current = ++revision;
  const button = $('#bot-tool-load');
  const status = $('#bot-tool-status');
  button.disabled = true;
  status.textContent = '正在读取工具…';
  const results = await Promise.all(selectedConnections().map(async ({ value, textContent }) => {
    try {
      const { tools } = await api(`/api/mcp/tools?connectionId=${encodeURIComponent(value)}`);
      return { id: value, name: textContent, tools };
    } catch {
      return { id: value, name: textContent, tools: null };
    }
  }));
  if (current !== revision) return;
  catalog = results;
  status.textContent = '修改后点「保存 Bot」生效。';
  button.disabled = false;
  render();
}

function render() {
  const host = $('#bot-tool-catalog');
  const allowed = new Set(csv($('#bot-tool-names').value));
  host.replaceChildren();
  for (const connection of catalog) {
    const group = document.createElement('details');
    group.className = 'bot-section';
    const summary = document.createElement('summary');
    summary.textContent = `${connection.name} · ${connection.tools ? `${connection.tools.length} 个工具` : '读取失败'}`;
    group.append(summary);
    const rows = document.createElement('div');
    rows.className = 'bot-section-body tool-switch-list';
    if (!connection.tools?.length) rows.textContent = connection.tools ? '连接没有返回工具。' : '检查连接后，再点一次「载入工具」。';
    for (const tool of connection.tools || []) rows.append(toolRow(connection.id, tool, allowed));
    group.append(rows);
    host.append(group);
  }
}

function toolRow(id, tool, allowed) {
  const row = document.createElement('label');
  row.className = 'switch';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.disabled = Boolean(allowed.size && !allowed.has(tool.name));
  toggle.checked = !toggle.disabled && !disabled.get(id)?.has(tool.name);
  const name = document.createElement('b');
  name.textContent = tool.name;
  const hint = document.createElement('small');
  hint.textContent = toggle.disabled ? '未列入当前白名单' : (tool.description || '');
  toggle.onchange = () => {
    const names = disabled.get(id) || new Set();
    if (toggle.checked) names.delete(tool.name);
    else names.add(tool.name);
    disabled.set(id, names);
  };
  row.append(toggle, document.createElement('span'), name, hint);
  return row;
}
