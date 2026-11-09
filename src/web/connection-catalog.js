import { $ } from './dom.js';
import { bindModelRefresh, loadModelPicker } from './model-picker.js';

let currentConnection = null;

export function bindConnectionCatalog() {
  bindModelRefresh($('#connection-model-refresh'), () => refreshConnectionCatalog(currentConnection));
}

export function fillConnectionCatalog(connection) {
  currentConnection = connection || null;
  $('#connection-models').value = connection?.cachedModels?.join(', ') || '';
  refreshConnectionCatalog(currentConnection);
}

async function refreshConnectionCatalog(connection) {
  const purpose = primaryPurpose(connection);
  await loadModelPicker({
    select: $('#connection-model-catalog'), connectionId: connection?.id, purpose,
    button: $('#connection-model-refresh'), status: $('#connection-model-status'), emptyLabel: '由连接自动选择',
    onLoaded: (result) => { if (result.models?.length) $('#connection-models').value = result.models.map((item) => item.id).join(', '); },
  });
  if (!connection?.capabilities?.includes('stt')) {
    $('#connection-stt-model').replaceChildren(new Option('这类连接不使用语音识别模型', ''));
    $('#connection-stt-model').disabled = true;
    return;
  }
  await loadModelPicker({ select: $('#connection-stt-model'), connectionId: connection.id, purpose: 'stt',
    selected: connection.options?.transcriptionModel || '', emptyLabel: '由连接自动选择' });
}

function primaryPurpose(connection) {
  const capabilities = connection?.capabilities || [];
  if (capabilities.includes('chat')) return 'chat';
  if (capabilities.includes('tts')) return 'tts';
  if (capabilities.includes('image')) return 'image';
  if (capabilities.includes('stt')) return 'stt';
  return 'chat';
}
