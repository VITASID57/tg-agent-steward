import { api, jsonBody } from './api.js';
import { $, id, options, toast } from './dom.js';

const TEMPLATES = Object.freeze({
  general: {
    title: '通用聊天建议', surface: 'all', scope: 'all',
    body: '使用自然、清楚的聊天口吻回应。优先理解对方真正想解决的事；不确定时如实说明，不编造已经完成的动作。',
  },
  telegram: {
    title: 'Telegram 场景建议', surface: 'telegram', scope: 'all',
    body: '当前通过 Telegram 交流。只使用 Telegram 支持的交互形式；群聊中不要引用只属于私聊的内容。',
  },
  wechat: {
    title: '微信场景建议', surface: 'wechat', scope: 'all',
    body: '当前通过微信私聊交流。不要输出 Telegram 命令或依赖 Telegram 客户端的交互形式；语音回复可能显示为音频文件。',
  },
  tools: {
    title: '工具与事实建议', surface: 'all', scope: 'all',
    body: '不要声称已经完成尚未完成的工具动作。工具失败时清楚说明结果，并继续给出可行办法。',
  },
});

export function bindProfileEditor(app) {
  $('#profile-picker').onchange = () => fillProfileEditor(app, $('#profile-picker').value);
  $('#new-profile').onclick = () => fillProfileEditor(app, '');
  $('#add-block').onclick = () => $('#profile-blocks').append(blockCard());
  for (const button of document.querySelectorAll('[data-profile-template]')) {
    button.onclick = () => $('#profile-blocks').append(blockCard(TEMPLATES[button.dataset.profileTemplate]));
  }
  $('#profile-form').onsubmit = (event) => saveProfile(event, app);
}

export function refreshProfileEditor(app) {
  options($('#profile-picker'), app.data.profiles.map(named), $('#profile-id').value, '新建人物');
  fillProfileEditor(app, $('#profile-picker').value || app.data.profiles[0]?.id || '');
}

function fillProfileEditor(app, itemId) {
  const item = app.data.profiles.find((entry) => entry.id === itemId); $('#profile-id').value = item?.id || '';
  $('#profile-picker').value = item?.id || '';
  const users = item ? app.data.bots.filter((bot) => bot.profileId === item.id).map((bot) => bot.name) : [];
  $('#profile-usage').textContent = users.length ? `当前由 ${users.join('、')} 使用。保存后会用于这些 Bot 的后续对话。` : '保存人物后，可在 Bot 页为账号选择它。';
  $('#profile-name').value = item?.name || ''; $('#profile-source').value = item?.source || 'local'; $('#profile-blocks').replaceChildren();
  const blocks = item?.blocks || [{ title: '基础人格', body: '', enabled: false, scope: 'all', surface: 'all' }];
  for (const block of blocks) $('#profile-blocks').append(blockCard(block));
}

function blockCard(block = {}) {
  const node = document.createElement('article'); node.className = 'module-card'; node.dataset.id = block.id || id('block');
  node.innerHTML = '<div class="module-head prompt-module-head"><input class="block-title" aria-label="模块标题"><label><input class="block-enabled" type="checkbox"> 启用</label><select class="block-surface" aria-label="适用渠道"><option value="all">全部渠道</option><option value="telegram">仅 Telegram</option><option value="wechat">仅微信</option></select><select class="block-scope" aria-label="会话范围"><option value="all">私聊与群聊</option><option value="private">仅私聊</option></select><button type="button" class="danger">移除</button></div><textarea class="block-body" rows="7" aria-label="模块正文" placeholder="正文为空时不会注入模型"></textarea>';
  $('.block-title', node).value = block.title || ''; $('.block-body', node).value = block.body || '';
  $('.block-enabled', node).checked = block.enabled === true; $('.block-surface', node).value = block.surface || 'all';
  $('.block-scope', node).value = block.scope || 'all'; $('.danger', node).onclick = () => node.remove(); return node;
}

async function saveProfile(event, app) {
  event.preventDefault(); const existingId = $('#profile-id').value;
  const blocks = [...$('#profile-blocks').children].map((node) => ({ id: node.dataset.id, title: $('.block-title', node).value,
    body: $('.block-body', node).value, enabled: $('.block-enabled', node).checked,
    surface: $('.block-surface', node).value, scope: $('.block-scope', node).value }));
  const body = { name: $('#profile-name').value, source: $('#profile-source').value, blocks };
  await api(existingId ? `/api/profiles/${encodeURIComponent(existingId)}` : '/api/profiles', { method: existingId ? 'PUT' : 'POST', body: jsonBody(body) });
  toast('人物与规则预设已保存；Bot 下一轮自动使用新版本'); await app.reload();
}

function named(item) { return { value: item.id, label: item.name }; }
