import { api, apiBlob, jsonBody } from './api.js';
import { $, csv, id, options, toast } from './dom.js';
import { resourceRemoved, resourceSaved } from './resource-browser.js';

export function bindStickerEditor(app) {
  $('#sticker-picker').onchange = () => fillStickerEditor(app, $('#sticker-picker').value);
  $('#new-sticker-pack').onclick = () => fillStickerEditor(app, '');
  $('#add-sticker').onclick = () => $('#sticker-items').append(stickerCard());
  $('#sticker-form').onsubmit = (event) => savePack(event, app);
  $('#delete-sticker-pack').onclick = () => removePack(app);
}

export function fillStickerEditor(app, itemId) {
  const item = app.data.stickerPacks.find((entry) => entry.id === itemId);
  $('#sticker-pack-id').value = item?.id || ''; $('#sticker-pack-name').value = item?.name || '';
  $('#sticker-items').replaceChildren();
  for (const sticker of item?.stickers || []) $('#sticker-items').append(stickerCard(sticker));
  $('#delete-sticker-pack').disabled = !item;
}

function stickerCard(sticker = {}) {
  const node = document.createElement('article'); node.className = 'module-card sticker-card'; node.dataset.id = sticker.id || id('sticker');
  node.dataset.assetId = sticker.assetId || '';
  node.innerHTML = '<div class="module-head"><img class="sticker-preview" alt="表情预览" hidden><input class="sticker-name" placeholder="名称" required><label><input class="sticker-enabled" type="checkbox"> 启用</label><button type="button" class="danger">移除</button></div><div class="form-grid two"><input class="sticker-meaning" placeholder="含义 / 适合什么时候发"><input class="sticker-tags" placeholder="标签，逗号分隔"></div><input class="sticker-file" type="file" accept="image/png,image/jpeg">';
  $('.sticker-name', node).value = sticker.name || ''; $('.sticker-meaning', node).value = sticker.meaning || '';
  $('.sticker-tags', node).value = (sticker.tags || []).join(', '); $('.sticker-enabled', node).checked = sticker.enabled !== false;
  $('.danger', node).onclick = () => node.remove();
  $('.sticker-file', node).onchange = () => previewFile(node);
  if (sticker.assetId) loadPreview(node, sticker.assetId);
  return node;
}

async function loadPreview(node, assetId) {
  try { setPreview(node, URL.createObjectURL(await apiBlob(`/api/sticker-assets/${encodeURIComponent(assetId)}`))); } catch { $('.sticker-preview', node).hidden = true; }
}
function previewFile(node) { const file = $('.sticker-file', node).files[0]; if (file) setPreview(node, URL.createObjectURL(file)); }
function setPreview(node, url) {
  const image = $('.sticker-preview', node); if (node.dataset.previewUrl) URL.revokeObjectURL(node.dataset.previewUrl);
  node.dataset.previewUrl = url; image.src = url; image.hidden = false;
}

async function savePack(event, app) {
  event.preventDefault(); const packId = $('#sticker-pack-id').value; const stickers = [];
  for (const node of $('#sticker-items').children) {
    const file = $('.sticker-file', node).files[0]; let assetId = node.dataset.assetId;
    if (file) {
      if (file.size > 2 * 1024 * 1024) throw new Error('单张表情图片不能超过 2 MiB');
      const saved = await api('/api/sticker-assets', { method: 'POST', body: jsonBody({ mime: file.type, dataBase64: await base64(file) }) }); assetId = saved.id;
    }
    if (!assetId) throw new Error('每个表情都要选择图片');
    stickers.push({ id: node.dataset.id, assetId, name: $('.sticker-name', node).value,
      meaning: $('.sticker-meaning', node).value, tags: csv($('.sticker-tags', node).value), enabled: $('.sticker-enabled', node).checked });
  }
  const body = { name: $('#sticker-pack-name').value, stickers };
  const saved = await api(packId ? `/api/sticker-packs/${encodeURIComponent(packId)}` : '/api/sticker-packs', { method: packId ? 'PUT' : 'POST', body: jsonBody(body) });
  resourceSaved('stickers', saved.id); toast('表情包已保存'); await app.reload();
}

async function removePack(app) {
  const packId = $('#sticker-pack-id').value; if (!packId || !confirm('删除这个表情包？被 Bot 引用时不会允许删除。')) return;
  await api(`/api/sticker-packs/${encodeURIComponent(packId)}`, { method: 'DELETE' }); resourceRemoved('stickers'); toast('表情包已删除'); await app.reload();
}
function base64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file); }); }

export function refreshStickerPicker(app) {
  const current = $('#sticker-pack-id').value;
  const selected = app.data.stickerPacks.some((item) => item.id === current) ? current : (app.data.stickerPacks[0]?.id || '');
  options($('#sticker-picker'), app.data.stickerPacks.map((item) => ({ value: item.id, label: item.name })), selected, '新建表情包');
}
