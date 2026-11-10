import { api } from './api.js';
import { $ } from './dom.js';
import { runtimeVisibility } from './runtime-visibility.js';

const CLI_KINDS = new Set(['codex', 'claude', 'grok-build']);

export function bindRuntimeUi() {
  $('#connection-runtime-mode').onchange = refreshRuntimeExplanation;
  $('#refresh-bot-diagnostics').onclick = () => loadBotDiagnostics($('#bot-detail').dataset.botId);
}

export function fillRuntimeMode(connection) {
  $('#connection-runtime-mode').value = connection?.options?.runtimeMode === 'agent' ? 'agent' : 'chat';
  refreshRuntimeExplanation();
}

export function refreshRuntimeExplanation() {
  const kind = $('#connection-kind').value;
  const isCli = CLI_KINDS.has(kind);
  $('#connection-runtime-box').hidden = !isCli;
  $('#connection-workdir-box').hidden = !isCli;
  if (!isCli) return;
  const mode = $('#connection-runtime-mode').value;
  $('#connection-workdir').disabled = mode !== 'agent';
  $('#connection-runtime-note').textContent = runtimeNote(kind, mode);
}

export async function loadBotDiagnostics(botId) {
  const host = $('#bot-diagnostics');
  const refresh = $('#refresh-bot-diagnostics');
  host.replaceChildren();
  if (!botId) return host.append(message('保存 Bot 后，这里会显示实际运行模式与注入预览。'));
  refresh.disabled = true; refresh.textContent = '读取中…';
  host.append(message('正在读取这一条线路的状态…'));
  try {
    const data = await api(`/api/bot-diagnostics?botId=${encodeURIComponent(botId)}`);
    if ($('#bot-detail').dataset.botId !== botId) return;
    renderDiagnostics(host, data);
  } catch (error) {
    host.replaceChildren(message(`暂时读不到预览：${error.message}`));
  } finally { refresh.disabled = false; refresh.textContent = '刷新运行信息'; }
}

function renderDiagnostics(host, data) {
  host.replaceChildren();
  const overview = document.createElement('div'); overview.className = 'diagnostic-metrics';
  overview.append(
    metric('运行方式', data.configured.runtimeMode === 'agent' ? '完整 Agent' : '纯聊天'),
    metric('当前模型', `${data.configured.engine} · ${data.configured.model || '后端默认'}`),
    metric('管家稳定注入', `约 ${data.prompt.stableTokens} tokens`),
    metric('每轮动态骨架', `约 ${data.prompt.dynamicTokens} tokens`),
  );
  const layer = document.createElement('p'); layer.className = 'native-layer-note'; layer.textContent = data.nativeLayer;
  host.append(overview, layer);
  host.append(runtimeVisibility(data.wake, data.events));
  host.append(textDetails('管家稳定注入', data.prompt.stable));
  host.append(textDetails('每轮动态注入示例', data.prompt.dynamicExample));
  const tools = document.createElement('div'); tools.className = 'diagnostic-tools';
  const heading = document.createElement('b'); heading.textContent = '实际放行的外部工具'; tools.append(heading);
  if (data.tools?.length) {
    const list = document.createElement('div'); list.className = 'tool-chip-list';
    for (const tool of data.tools) {
      const chip = document.createElement('span'); chip.textContent = tool.connectionName ? `${tool.name} · ${tool.connectionName}` : tool.name; list.append(chip);
    }
    tools.append(list);
  } else tools.append(message('没有放行管家 MCP 工具。'));
  host.append(tools);
  host.append(usageDashboard(data.lastChat, data.usage));
}

function usageDashboard(lastChat, accountUsage) {
  const section = document.createElement('section'); section.className = 'usage-dashboard';
  const head = document.createElement('div'); head.className = 'usage-heading';
  const title = document.createElement('div'); title.innerHTML = '<p class="eyebrow">USAGE</p><h4>用量与额度</h4>';
  const note = document.createElement('small'); note.textContent = '只显示提供方实际返回的统计；不同线路可见项目会不同。';
  head.append(title, note); section.append(head);

  const limits = accountUsage?.rateLimits?.rateLimits ?? accountUsage?.rateLimits ?? null;
  const account = accountUsage?.accountUsage ?? accountUsage ?? {};
  const summary = account?.summary ?? {};
  const buckets = Array.isArray(account?.dailyUsageBuckets) ? account.dailyUsageBuckets : [];
  const quotas = [
    ['短时限额', limits?.primary],
    ['长期限额', limits?.secondary],
  ].filter(([, value]) => value && Number.isFinite(Number(value.usedPercent)));

  if (quotas.length) {
    const grid = document.createElement('div'); grid.className = 'quota-grid';
    for (const [fallback, quota] of quotas) grid.append(quotaCard(quota, fallback));
    section.append(grid);
  }

  const turnTokens = totalTokens(lastChat?.lastUsage);
  const kpis = [
    ['累计 Tokens', summary.lifetimeTokens],
    ['单日峰值', summary.peakDailyTokens],
    ['最近一轮', turnTokens],
    ['连续活跃', Number.isFinite(Number(summary.currentStreakDays)) ? `${summary.currentStreakDays} 天` : null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (kpis.length) {
    const grid = document.createElement('div'); grid.className = 'usage-kpis';
    for (const [label, value] of kpis) {
      const card = document.createElement('div'); card.className = 'usage-kpi';
      const small = document.createElement('small'); small.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = typeof value === 'number' ? compact(value) : value;
      card.append(small, strong); grid.append(card);
    }
    section.append(grid);
  }

  if (buckets.length) section.append(activityHeatmap(buckets));
  if (!quotas.length && !kpis.length && !buckets.length) {
    section.append(message('当前提供方没有返回可视化用量。Bot 仍可正常工作，产生对话后可再刷新查看。'));
  }
  return section;
}

function quotaCard(quota, fallback) {
  const used = clamp(Number(quota.usedPercent), 0, 100); const remaining = Math.max(0, 100 - used);
  const card = document.createElement('article'); card.className = `quota-card ${remaining <= 10 ? 'is-low' : ''}`;
  const top = document.createElement('div'); top.className = 'quota-line';
  const label = document.createElement('strong'); label.textContent = quotaWindow(quota.windowDurationMins, fallback);
  const value = document.createElement('span'); value.textContent = `剩余 ${Math.round(remaining)}%`;
  top.append(label, value);
  const reset = document.createElement('small'); reset.textContent = quotaReset(quota.resetsAt);
  const track = document.createElement('div'); track.className = 'quota-track'; track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `${label.textContent}已使用`); track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(Math.round(used)));
  const fill = document.createElement('span'); fill.className = 'quota-fill'; fill.style.width = `${used}%`; track.append(fill);
  card.append(top, reset, track); return card;
}

function activityHeatmap(buckets) {
  const section = document.createElement('div'); section.className = 'usage-activity';
  const heading = document.createElement('div'); heading.className = 'usage-activity-head';
  const title = document.createElement('strong'); title.textContent = 'Token 活动';
  const total = buckets.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
  const copy = document.createElement('small'); copy.textContent = `近一年 · ${compact(total)} tokens`;
  heading.append(title, copy); section.append(heading);

  const values = new Map(buckets.map((item) => [String(item.startDate).slice(0, 10), Number(item.tokens) || 0]));
  const dates = [...values.keys()].filter(Boolean).sort(); const last = utcDate(dates.at(-1)) || new Date();
  const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()));
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 364);
  const aligned = new Date(start); aligned.setUTCDate(aligned.getUTCDate() - aligned.getUTCDay());
  const max = Math.max(1, ...values.values());
  const scroll = document.createElement('div'); scroll.className = 'heatmap-scroll';
  const grid = document.createElement('div'); grid.className = 'heatmap-grid';
  for (let day = new Date(aligned); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const key = day.toISOString().slice(0, 10); const tokens = values.get(key) || 0;
    const cell = document.createElement('span'); cell.className = `heat-cell level-${heatLevel(tokens, max)}`;
    cell.title = `${key} · ${compact(tokens)} tokens`; cell.setAttribute('aria-label', cell.title);
    grid.append(cell);
  }
  scroll.append(grid); section.append(scroll);
  const legend = document.createElement('div'); legend.className = 'heatmap-legend'; legend.append(document.createTextNode('少'));
  for (let index = 0; index <= 4; index += 1) { const cell = document.createElement('i'); cell.className = `heat-cell level-${index}`; legend.append(cell); }
  legend.append(document.createTextNode('多')); section.append(legend); return section;
}

function totalTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const direct = usage.totalTokens ?? usage.total_tokens ?? usage.total;
  if (Number.isFinite(Number(direct))) return Number(direct);
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens;
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens;
  return Number.isFinite(Number(input)) || Number.isFinite(Number(output)) ? (Number(input) || 0) + (Number(output) || 0) : null;
}

function quotaWindow(minutes, fallback) {
  const value = Number(minutes); if (!Number.isFinite(value) || value <= 0) return fallback;
  if (value >= 10_080 && value % 10_080 === 0) return value === 10_080 ? '每周限额' : `${value / 10_080} 周限额`;
  if (value >= 1_440 && value % 1_440 === 0) return `${value / 1_440} 天限额`;
  if (value >= 60 && value % 60 === 0) return `${value / 60} 小时限额`;
  return `${value} 分钟限额`;
}

function quotaReset(value) {
  if (!value) return '重置时间未提供';
  const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return '重置时间未提供';
  const diff = date.getTime() - Date.now();
  if (diff > 0) {
    const hours = Math.floor(diff / 3_600_000); const minutes = Math.max(1, Math.round((diff % 3_600_000) / 60_000));
    return hours >= 24 ? `${Math.floor(hours / 24)} 天 ${hours % 24} 小时后重置` : `${hours ? `${hours} 小时 ` : ''}${minutes} 分钟后重置`;
  }
  return '即将刷新额度';
}

function compact(value) { return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0); }
function heatLevel(value, max) { return value <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(max)) * 4))); }
function utcDate(value) { if (!value) return null; const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? null : date; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function metric(label, value) {
  const node = document.createElement('div'); const small = document.createElement('small'); const strong = document.createElement('strong');
  small.textContent = label; strong.textContent = value; node.append(small, strong); return node;
}

function textDetails(title, value, open = false) {
  const details = document.createElement('details'); details.open = open;
  const summary = document.createElement('summary'); summary.textContent = title;
  const pre = document.createElement('pre'); pre.textContent = value; details.append(summary, pre); return details;
}

function message(value) { const node = document.createElement('p'); node.className = 'hint'; node.textContent = value; return node; }

function runtimeNote(kind, mode) {
  if (mode === 'agent') return '会继承部署环境中该 CLI 的项目规则、用户设置、Skills 与原生工具，适合真正要读文件和执行任务的 Bot。人物档案会追加到原有环境。';
  if (kind === 'codex') return '使用独立 Codex Home 和专用空目录，不继承部署环境的全局／项目 AGENTS.md。';
  if (kind === 'claude') return '替换 Claude Code 默认系统提示，关闭 CLAUDE.md 和自动记忆；原生 MCP 只加载明确填写的配置。认证由部署机上的官方 CLI 管理。';
  return '使用独立 Grok Home、专用空目录并拒绝内置工具；安装包自带 Skills 提示仍可能出现，且无法由管家关闭。';
}
