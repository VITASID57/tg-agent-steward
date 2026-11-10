import { api, jsonBody } from './api.js';
import { $, options, toast } from './dom.js';

const path = '/api/profile-block-templates';

export function bindProfileTemplates(app, insert) {
  $('#profile-template-picker').onchange = updateActions;
  $('#insert-profile-template').onclick = () => {
    const template = (app.data.profileBlockTemplates || []).find((item) => item.id === $('#profile-template-picker').value);
    if (template) insert({ ...template, id: undefined });
  };
  $('#delete-profile-template').onclick = async () => {
    const select = $('#profile-template-picker');
    const template = (app.data.profileBlockTemplates || []).find((item) => item.id === select.value);
    if (!template || !confirm(`从常用模块移除「${template.title}」？`)) return;
    const button = $('#delete-profile-template');
    button.disabled = true;
    try {
      await api(`${path}/${encodeURIComponent(template.id)}`, { method: 'DELETE' });
      app.data.profileBlockTemplates = (app.data.profileBlockTemplates || []).filter((item) => item.id !== template.id);
      fillProfileTemplates(app);
      toast('已从常用模块移除');
    } catch (error) { toast(error.message, true); }
    finally { updateActions(); }
  };
}

export function fillProfileTemplates(app, selected = $('#profile-template-picker').value) {
  const templates = app.data.profileBlockTemplates || [];
  options($('#profile-template-picker'), templates.map((item) => ({ value: item.id, label: item.title })),
    templates.some((item) => item.id === selected) ? selected : '', templates.length ? '选择常用模块' : '还没有常用模块');
  updateActions();
}

export async function saveProfileTemplate(app, block, button) {
  if (!block.title.trim() || !block.body.trim()) return toast('请先填写模块标题和正文', true);
  button.disabled = true;
  try {
    const saved = await api(path, { method: 'POST', body: jsonBody(block) });
    const templates = app.data.profileBlockTemplates || [];
    app.data.profileBlockTemplates = [...templates.filter((item) => item.id !== saved.id), saved];
    fillProfileTemplates(app, saved.id);
    toast('已存入常用模块');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

function updateActions() {
  const empty = !$('#profile-template-picker').value;
  $('#insert-profile-template').disabled = empty;
  $('#delete-profile-template').disabled = empty;
}
