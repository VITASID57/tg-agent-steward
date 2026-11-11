import { api } from './api.js';
import { $ } from './dom.js';

const endpoint = '/api/integrations/mimi-town/token';

export function bindMimiTownImport() {
  const status = $('#mimi-town-status');
  const generate = $('#mimi-town-generate');
  const revoke = $('#mimi-town-revoke');
  const result = $('#mimi-town-token-result');
  const token = $('#mimi-town-token');
  const copy = $('#mimi-town-copy');
  let configured = false;

  function render(data, message) {
    configured = data.configured;
    generate.textContent = configured ? '重新生成' : '生成口令';
    revoke.hidden = !configured;
    token.value = data.token ?? '';
    result.hidden = !token.value;
    status.textContent = message ?? (configured ? '口令已启用' : '尚未生成口令');
  }

  async function update(method, message) {
    generate.disabled = true;
    revoke.disabled = true;
    try {
      render(await api(endpoint, { method }), message);
    } catch (error) {
      status.textContent = `暂时无法操作导入口令。${error.message}`;
    } finally {
      generate.disabled = false;
      revoke.disabled = false;
    }
  }

  generate.onclick = () => {
    if (configured && !confirm('重新生成后，旧口令会立即失效。继续吗？')) return;
    void update('POST', '口令已生成，请复制到小镇插件。');
  };
  revoke.onclick = () => {
    if (confirm('撤销后，小镇插件将无法继续导入人设。确定撤销吗？')) {
      void update('DELETE', '口令已撤销');
    }
  };
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(token.value);
      status.textContent = '口令已复制';
    } catch {
      token.focus();
      token.select();
      status.textContent = '已选中口令，可以手动复制。';
    }
  };
  return () => update('GET');
}
