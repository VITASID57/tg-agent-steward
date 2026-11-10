import { $, $$ } from './dom.js';
import { refreshBotSections } from './bot-sections.js';
import { resetAvatarFeedback, showAvatar } from './bot-avatar.js';
import { renderBotDetail } from './bot-detail.js';
import { extraChannelLabel } from './bot-channel-label.js';

let selected = null;
let mode = 'list';
let dirty = false;
let fillEditor;
let currentApp;

export function bindBotCards(app, fillBot) {
  currentApp = app; fillEditor = fillBot;
  $('#new-bot').onclick = () => openEditor('');
  $('#bot-detail-back').onclick = () => openList();
  $('#bot-detail-edit').onclick = () => openEditor(selected);
  $('#cancel-bot-edit').onclick = cancelEditing;
  $('#bot-form').addEventListener('input', markDirty);
  $('#bot-form').addEventListener('change', markDirty);
  window.addEventListener('beforeunload', (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });
}

export function botSaved(id) {
  selected = id || null; dirty = false; mode = id ? 'detail' : 'list';
  $('#bot-id').value = id || '';
}

export function botDraftSaved(id) {
  selected = id; dirty = false; mode = 'edit'; $('#bot-id').value = id;
}

export function refillBotEditor(app, fillBot) {
  currentApp = app; fillEditor = fillBot;
  if (selected && !app.data.bots.some((bot) => bot.id === selected)) { selected = null; mode = 'list'; dirty = false; }
  if (mode === 'edit') {
    const draft = dirty ? capture() : null;
    fillEditor(app, selected || '');
    restore(draft);
  }
  render(app);
}

export function renderBotCards(app) { currentApp = app; render(app); }

function openDetail(id) {
  if (!id) return;
  selected = id; mode = 'detail'; dirty = false; render(currentApp, 'forward');
}

export function openBotDetail(id) { openDetail(id); }
export function openBotEditor(id) { openEditor(id); }

function openEditor(id) {
  selected = id; mode = 'edit'; dirty = false;
  fillEditor(currentApp, id || ''); refreshBotSections(); resetAvatarFeedback();
  render(currentApp, 'forward');
  $('#bot-editor-title').focus({ preventScroll: true });
}

function openList() {
  selected = null; mode = 'list'; dirty = false; render(currentApp, 'back');
  $('#bot-list-title').focus({ preventScroll: true });
}

function cancelEditing() {
  if (dirty && !confirm('取消编辑会放弃这次尚未保存的修改。确定返回吗？')) return;
  dirty = false;
  if (selected) { mode = 'detail'; render(currentApp, 'back'); }
  else openList();
}

function markDirty(event) {
  if (mode !== 'edit' || event.target.id === 'bot-avatar-file') return;
  dirty = true; $('#bot-unsaved-state').textContent = '有尚未保存的修改';
}

function render(app, direction = 'none') {
  const listView = $('#bot-list-view'); const detail = $('#bot-detail'); const editor = $('#bot-editor');
  listView.hidden = mode !== 'list'; detail.hidden = mode !== 'detail'; editor.hidden = mode !== 'edit'; editor.disabled = mode !== 'edit';
  if (mode === 'list') renderList(app);
  if (mode === 'detail') renderBotDetail(app, app.data.bots.find((bot) => bot.id === selected));
  if (mode === 'edit') {
    const name = selected ? app.data.bots.find((bot) => bot.id === selected)?.name : '';
    $('#bot-editor-title').textContent = selected ? `编辑 · ${name || '未命名 Bot'}` : '新建 Bot';
    $('#bot-editor-title').tabIndex = -1;
    $('#bot-unsaved-state').textContent = dirty ? '有尚未保存的修改' : '修改只在保存后生效';
  }
  transition(mode === 'list' ? listView : mode === 'detail' ? detail : editor, direction);
}

function renderList(app) {
  const list = $('#bot-cards'); list.replaceChildren();
  for (const bot of app.data.bots) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'bot-card';
    card.dataset.botId = bot.id; card.setAttribute('aria-label', `查看 ${bot.name || '未命名 Bot'}`);
    const avatar = document.createElement('span'); avatar.className = 'bot-card-avatar'; showAvatar(avatar, bot.avatar, bot.name);
    const copy = document.createElement('span'); copy.className = 'bot-card-copy';
    const heading = document.createElement('strong'); heading.textContent = bot.name || '未命名 Bot';
    const detail = document.createElement('small'); detail.textContent = bot.chat?.model || '默认模型';
    const meta = document.createElement('span'); meta.className = 'bot-card-meta';
    const state = document.createElement('small'); state.textContent = bot.runtime?.running ? '运行中' : (bot.enabled ? '已启用 · 未运行' : '已停用');
    meta.append(state);
    const channel = extraChannelLabel(bot);
    if (channel) { const label = document.createElement('small'); label.textContent = channel; meta.append(label); }
    copy.append(heading, detail, meta); card.append(avatar, copy); card.onclick = () => openDetail(bot.id); list.append(card);
  }
  $('#bot-selection-hint').hidden = app.data.bots.length > 0;
}

function capture() {
  return Object.fromEntries($$('#bot-editor input, #bot-editor select, #bot-editor textarea')
    .filter((node) => node.id && node.type !== 'file')
    .map((node) => [node.id, { value: node.value, checked: node.checked,
      selected: node.multiple ? [...node.selectedOptions].map((option) => option.value) : null }]));
}

function restore(draft) {
  if (!draft) return;
  for (const [id, state] of Object.entries(draft)) {
    const node = $(`#${id}`); if (!node) continue;
    if (state.selected) for (const option of node.options) option.selected = state.selected.includes(option.value);
    else node.value = state.value;
    if (state.checked !== undefined) node.checked = state.checked;
  }
  $('#bot-chat-connection').dispatchEvent(new Event('change', { bubbles: true }));
}

function transition(element, direction) {
  if (direction === 'none' || document.body.classList.contains('motion-paused') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const offset = direction === 'back' ? -14 : 14;
  element.animate([{ opacity: 0, transform: `translateX(${offset}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
}
