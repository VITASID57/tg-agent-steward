import { api } from './api.js';
import { $, toast } from './dom.js';

const browsers = new Map();

export function bindResourceBrowsers(app, definitions) {
  for (const definition of definitions) browsers.set(definition.key, createBrowser(app, definition));
}

export function refreshResourceBrowsers(app) {
  for (const browser of browsers.values()) browser.refresh(app);
}

export function resourceSaved(key, id) {
  const browser = browsers.get(key);
  if (browser) browser.saved(id);
}

function createBrowser(app, definition) {
  const form = $(definition.form); const original = [...form.children];
  const editor = document.createElement('fieldset'); editor.className = 'resource-editor'; editor.hidden = true; editor.disabled = true;
  for (const node of original) editor.append(node);
  const list = listView(definition); const detail = detailView(definition);
  form.append(list.root, detail.root, editor);
  const oldNew = $(definition.newButton); if (oldNew) oldNew.hidden = true;
  const picker = $(definition.picker); if (picker) { picker.hidden = true; picker.previousElementSibling?.setAttribute('hidden', ''); }
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'quiet resource-cancel'; cancel.textContent = '取消编辑';
  editor.prepend(cancel);

  let mode = 'list'; let selected = null; let dirty = false; let currentApp = app;
  list.create.onclick = () => openEdit(''); detail.back.onclick = openList; detail.edit.onclick = () => openEdit(selected);
  detail.remove.onclick = removeSelected;
  cancel.onclick = cancelEdit;
  editor.addEventListener('input', markDirty); editor.addEventListener('change', markDirty);
  editor.addEventListener('resource-draft-change', () => { if (mode === 'edit') dirty = true; });

  function items() { return currentApp.data ? definition.items(currentApp.data) : []; }
  function openList() { selected = null; mode = 'list'; dirty = false; render('back'); }
  function openDetail(id) { selected = id; mode = 'detail'; dirty = false; detail.error.textContent = ''; render('forward'); }
  function openEdit(id) {
    selected = id || null; mode = 'edit'; dirty = false; definition.fill(currentApp, id || ''); render('forward');
    editor.querySelector('input:not([type="hidden"]), textarea, select')?.focus({ preventScroll: true });
  }
  function cancelEdit() {
    if (dirty && !confirm('取消编辑会放弃尚未保存的修改。确定返回吗？')) return;
    dirty = false; selected ? openDetail(selected) : openList();
  }
  function markDirty(event) { if (mode === 'edit' && event.isTrusted) dirty = true; }
  function refresh(nextApp) {
    currentApp = nextApp;
    if (selected && !items().some((item) => item.id === selected)) { selected = null; mode = 'list'; dirty = false; }
    render();
  }
  function saved(id) { selected = id; mode = 'detail'; dirty = false; detail.error.textContent = ''; }
  async function removeSelected() {
    const item = items().find((entry) => entry.id === selected);
    if (!item || !confirm(`删除${definition.singular}「${item.name}」？`)) return;
    detail.remove.disabled = true;
    detail.error.textContent = '';
    try {
      await api(`${definition.endpoint}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    } catch (error) {
      detail.error.textContent = error.message;
      return;
    } finally { detail.remove.disabled = false; }
    if (mode === 'detail' && selected === item.id) openList();
    toast(`${definition.singular}已删除`);
    await currentApp.reload().catch((error) => toast(error.message, true));
  }

  function render(direction = 'none') {
    list.root.hidden = mode !== 'list'; detail.root.hidden = mode !== 'detail'; editor.hidden = mode !== 'edit'; editor.disabled = mode !== 'edit';
    if (mode === 'list') renderList();
    if (mode === 'detail') renderDetail();
    animate(mode === 'list' ? list.root : mode === 'detail' ? detail.root : editor, direction);
  }
  function renderList() {
    list.items.replaceChildren();
    const grouped = definition.groups ? definition.groups(items()) : [{ title: '', items: items() }];
    for (const group of grouped.filter((entry) => entry.items.length)) {
      const section = document.createElement('section'); section.className = 'resource-group';
      if (group.title) { const heading = document.createElement('h3'); heading.textContent = group.title; section.append(heading); }
      const grid = document.createElement('div'); grid.className = 'resource-list';
      for (const item of group.items) grid.append(resourceButton(item, definition, () => openDetail(item.id)));
      section.append(grid); list.items.append(section);
    }
    list.empty.hidden = items().length > 0;
  }
  function renderDetail() {
    const item = items().find((entry) => entry.id === selected); if (!item) return openList();
    detail.title.textContent = item.name || definition.singular;
    detail.facts.replaceChildren(...definition.facts(currentApp.data, item).map(([label, value]) => fact(label, value)));
  }
  render();
  return { refresh, saved };
}

function listView(definition) {
  const root = document.createElement('section'); root.className = 'resource-list-view';
  root.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${definition.eyebrow}</p><h2>${definition.title}</h2></div></div><p>${definition.description}</p>`;
  const create = document.createElement('button'); create.type = 'button'; create.className = 'primary'; create.textContent = `新建${definition.singular}`;
  root.querySelector('.panel-heading').append(create);
  const items = document.createElement('div'); const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = `还没有${definition.singular}。`;
  root.append(items, empty); return { root, create, items, empty };
}

function detailView(definition) {
  const root = document.createElement('section'); root.className = 'resource-detail'; root.hidden = true;
  const nav = document.createElement('div'); nav.className = 'detail-nav';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'quiet'; back.textContent = `← 全部${definition.title}`;
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'primary'; edit.textContent = '编辑'; nav.append(back, edit);
  const title = document.createElement('h2'); const facts = document.createElement('div'); facts.className = 'resource-facts';
  const footer = document.createElement('div'); footer.className = 'save-row';
  const error = document.createElement('p'); error.className = 'hint'; error.setAttribute('role', 'status');
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = `删除${definition.title}`;
  footer.append(error, remove); root.append(nav, title, facts, footer);
  return { root, back, edit, title, facts, remove, error };
}

function resourceButton(item, definition, onClick) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'resource-item'; button.onclick = onClick;
  const strong = document.createElement('strong'); strong.textContent = item.name || definition.singular;
  const small = document.createElement('small'); small.textContent = definition.summary(item);
  button.append(strong, small); return button;
}

function fact(label, value) {
  const node = document.createElement('div'); const small = document.createElement('small'); const strong = document.createElement('strong');
  small.textContent = label; strong.textContent = value || '未设置'; node.append(small, strong); return node;
}

function animate(element, direction) {
  if (direction === 'none' || document.body.classList.contains('motion-paused') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.animate([{ opacity: 0, transform: `translateX(${direction === 'back' ? -12 : 12}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
}
