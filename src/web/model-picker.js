import { api } from './api.js';
import { options } from './dom.js';

export async function loadModelPicker({ select, connectionId, purpose, selected = '', button = null,
  status = null, emptyLabel = '由连接自动选择', onLoaded = null, preview = null }) {
  if (!select) return null;
  if (!connectionId && !preview) {
    options(select, selected ? [{ value: selected, label: `${selected}（当前保存）` }] : [], selected, '请先选择连接');
    select.disabled = true;
    if (button) button.disabled = true;
    if (status) status.textContent = '选择连接后即可拉取模型。';
    return null;
  }
  select.disabled = true;
  if (button) { button.disabled = true; button.textContent = '拉取中…'; }
  if (status) status.textContent = '正在向这条连接读取模型目录…';
  try {
    const result = preview
      ? await api('/api/models/preview', { method: 'POST', body: JSON.stringify({ connection: preview, purpose }), headers: { 'content-type': 'application/json' } })
      : await api(`/api/models?connectionId=${encodeURIComponent(connectionId)}&purpose=${encodeURIComponent(purpose)}`);
    const models = Array.isArray(result.models) ? result.models : [];
    const items = models.map((item) => ({ value: item.id, label: item.name && item.name !== item.id ? `${item.name} · ${item.id}` : item.id }));
    if (selected && !items.some((item) => item.value === selected)) items.unshift({ value: selected, label: `${selected}（当前保存）` });
    options(select, items, selected, emptyLabel);
    select.disabled = false;
    if (status) status.textContent = catalogMessage(result.source, models.length, result.liveError, result.catalogNote);
    onLoaded?.(result);
    return result;
  } catch (error) {
    options(select, selected ? [{ value: selected, label: `${selected}（当前保存）` }] : [], selected,
      selected ? emptyLabel : '暂未拉到模型');
    select.disabled = false;
    if (status) status.textContent = `暂时拉取失败：${error.message}`;
    onLoaded?.({ models: [], efforts: [], error: error.message });
    return null;
  } finally {
    if (button) { button.disabled = false; button.textContent = '重新拉取'; }
  }
}

export function bindModelRefresh(button, loader) {
  if (button) button.onclick = () => loader();
}

function catalogMessage(source, count, liveError = '', catalogNote = '') {
  if (!count) return '这条连接没有返回可选择的模型，将由连接自身决定。';
  if (catalogNote) return `${catalogNote} 共 ${count} 个可选项。`;
  if (source === 'live') return `已从连接实时拉取 ${count} 个模型。`;
  if (source === 'built-in') return liveError
    ? `实时目录未连通（${liveError}）；先显示 ${count} 个内置选项。`
    : `这类连接使用 ${count} 个内置可用选项。`;
  return `实时目录暂不可用，显示已保存的 ${count} 个模型。`;
}
