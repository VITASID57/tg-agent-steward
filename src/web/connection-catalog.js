import { $, csv } from './dom.js';
import { bindModelRefresh, loadModelPicker } from './model-picker.js';

let currentConnection = null;

export function bindConnectionCatalog() {
  bindModelRefresh($('#connection-model-refresh'), (verify) => refreshConnectionCatalog(currentConnection, verify));
}

export function fillConnectionCatalog(connection) {
  currentConnection = connection || null;
  $('#connection-models').value = connection?.cachedModels?.join(', ') || '';
  refreshConnectionCatalog(currentConnection);
}

async function refreshConnectionCatalog(connection, verify = false) {
  const draft = draftConnection(connection); const purpose = primaryPurpose(draft);
  const result = await loadModelPicker({
    select: $('#connection-model-catalog'), connectionId: connection?.id, purpose, preview: draft, verify,
    button: $('#connection-model-refresh'), status: $('#connection-model-status'), emptyLabel: '由连接自动选择',
    onLoaded: (result) => {
      if (result.models?.length && (draft.kind !== 'vertex-ai' || (result.source === 'verified' && !result.liveError))) {
        $('#connection-models').value = result.models.map((item) => item.id).join(', ');
      }
    },
  });
  if (!result || currentConnection !== connection) return;
  if (!draft.capabilities?.includes('stt')) {
    $('#connection-stt-model').replaceChildren(new Option('这类连接不使用语音识别模型', ''));
    $('#connection-stt-model').disabled = true;
    return;
  }
  await loadModelPicker({ select: $('#connection-stt-model'), connectionId: connection?.id, preview: draft, purpose: 'stt', verify,
    selected: connection?.options?.transcriptionModel || '', emptyLabel: '由连接自动选择' });
}

function draftConnection(connection) {
  const kind = $('#connection-kind').value || connection?.kind || 'openai-compatible';
  return {
    id: connection?.id || '', name: $('#connection-name').value || connection?.name || '临时连接', kind,
    baseUrl: $('#connection-url').value, secret: $('#connection-secret').value,
    cachedModels: csv($('#connection-models').value), capabilities: capabilities(kind),
    options: { ...(connection?.options || {}), apiStyle: $('#connection-api-style').value,
      groupId: $('#connection-group-id').value, authType: $('#connection-auth-type').value,
      authName: $('#connection-auth-name').value },
  };
}

function capabilities(kind) {
  if (['codex', 'grok-build'].includes(kind)) return ['chat', 'image'];
  if (['claude', 'anthropic-compatible'].includes(kind)) return ['chat'];
  if (kind === 'openai-compatible') return ['chat', 'stt', 'image'];
  if (kind === 'vertex-ai') return ['chat', 'tts', 'stt', 'image'];
  if (kind === 'elevenlabs') return ['tts', 'stt'];
  if (['minimax', 'gpt-sovits', 'edge-tts'].includes(kind)) return ['tts'];
  if (kind === 'whisper-local') return ['stt'];
  if (['novelai', 'comfyui'].includes(kind)) return ['image'];
  return [];
}

function primaryPurpose(connection) {
  const capabilities = connection?.capabilities || [];
  if (capabilities.includes('chat')) return 'chat';
  if (capabilities.includes('tts')) return 'tts';
  if (capabilities.includes('image')) return 'image';
  if (capabilities.includes('stt')) return 'stt';
  return 'chat';
}
