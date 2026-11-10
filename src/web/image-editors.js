import { api, jsonBody } from './api.js';
import { $, options, toast } from './dom.js';
import { bindModelRefresh, loadModelPicker } from './model-picker.js';
import { resourceSaved } from './resource-browser.js';

export function bindImageEditor(app) {
  $('#image-picker').onchange = () => fillImageEditor(app, $('#image-picker').value);
  $('#new-image').onclick = () => fillImageEditor(app, '');
  $('#add-image-route').onclick = () => $('#image-routes').append(imageRouteCard(app));
  $('#image-form').onsubmit = (event) => saveImage(event, app);
}

export function fillImageEditor(app, itemId = '') {
  const item = app.data.imageProfiles.find((entry) => entry.id === itemId);
  options($('#image-picker'), app.data.imageProfiles.map(named), item?.id || '', '新建生图路线');
  $('#image-id').value = item?.id || ''; $('#image-name').value = item?.name || ''; $('#image-routes').replaceChildren();
  for (const route of [item?.primary, ...(item?.fallbacks || [])].filter(Boolean)) $('#image-routes').append(imageRouteCard(app, route));
  if (!item) $('#image-routes').append(imageRouteCard(app));
}

function imageRouteCard(app, route = {}) {
  const node = document.createElement('article'); node.className = 'module-card';
  node.innerHTML = '<div class="module-head"><select class="image-route-connection" aria-label="生图连接"></select><div class="model-picker-inline"><select class="image-route-model" aria-label="生图模型"></select><button type="button" class="quiet image-route-model-refresh">拉取</button></div><input class="image-route-size" aria-label="图片尺寸" placeholder="尺寸可选；留空按请求决定"><button type="button" class="danger">移除此线路</button></div><p class="hint image-route-model-status" role="status"></p><details><summary>线路参数（JSON）</summary><textarea class="image-route-options" rows="5" placeholder="ComfyUI 可填 workflow、promptNodeId、outputNodeId"></textarea></details>';
  const imageConnections = app.data.connections.filter((entry) => entry.capabilities.includes('image'));
  options($('.image-route-connection', node), imageConnections.map(named), route.connectionId);
  $('.image-route-size', node).value = route.size || '';
  $('.image-route-options', node).value = Object.keys(route.options || {}).length ? JSON.stringify(route.options, null, 2) : '';
  const loadImageModels = (verify = false) => loadModelPicker({ select: $('.image-route-model', node), verify,
    connectionId: $('.image-route-connection', node).value, purpose: 'image',
    selected: $('.image-route-model', node).value || route.model || '', button: $('.image-route-model-refresh', node),
    status: $('.image-route-model-status', node), emptyLabel: '由连接自动选择' });
  $('.image-route-connection', node).onchange = () => { route.model = ''; $('.image-route-model', node).value = ''; loadImageModels(); };
  bindModelRefresh($('.image-route-model-refresh', node), loadImageModels);
  $('.danger', node).onclick = () => node.remove(); loadImageModels(); return node;
}

async function saveImage(event, app) {
  event.preventDefault(); const existingId = $('#image-id').value;
  const routes = [...$('#image-routes').children].map((node) => ({
    connectionId: $('.image-route-connection', node).value, model: $('.image-route-model', node).value,
    size: $('.image-route-size', node).value, options: parseJson($('.image-route-options', node).value),
  }));
  const body = { name: $('#image-name').value, primary: routes[0] || null, fallbacks: routes.slice(1) };
  const saved = await api(existingId ? `/api/image-profiles/${encodeURIComponent(existingId)}` : '/api/image-profiles', {
    method: existingId ? 'PUT' : 'POST', body: jsonBody(body),
  });
  resourceSaved('images', saved.id); toast('生图路线已保存'); await app.reload();
}

function parseJson(value) { if (!value.trim()) return {}; try { return JSON.parse(value); } catch { throw new Error('线路参数不是合法 JSON'); } }
function named(item) { return { value: item.id, label: item.name }; }
