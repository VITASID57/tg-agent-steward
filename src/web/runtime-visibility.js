export function runtimeVisibility(wake, events = []) {
  const section = document.createElement('section'); section.className = 'runtime-visibility';
  const heading = document.createElement('div'); heading.className = 'visibility-heading';
  const title = document.createElement('div'); title.innerHTML = '<p class="eyebrow">LIVE STATUS</p><h4>运行可见性</h4>';
  const note = document.createElement('small'); note.textContent = '时间线只保存运行事件，不保存聊天正文。';
  heading.append(title, note); section.append(heading);
  const layout = document.createElement('div'); layout.className = 'visibility-layout';
  layout.append(wakeCard(wake), timeline(events)); section.append(layout);
  return section;
}

function wakeCard(wake = {}) {
  const card = document.createElement('article'); card.className = 'wake-status-card';
  const top = document.createElement('div'); top.className = 'wake-status-head';
  const title = document.createElement('strong'); title.textContent = '自动唤醒';
  const badge = document.createElement('span'); badge.className = `status-pill ${wake.enabled && wake.configured ? 'is-on' : 'is-off'}`;
  badge.textContent = wake.enabled ? (wake.configured ? '运行中' : '待完善') : '未启用';
  top.append(title, badge); card.append(top);
  if (!wake.enabled) { card.append(copy('在 Bot 编辑页启用后，这里会显示下一次尝试与最近结果。')); return card; }
  if (!wake.configured) { card.append(copy('请打开「编辑 Bot → 自动唤醒」，选好已授权的接收会话并保存。')); return card; }
  const rows = document.createElement('dl'); rows.className = 'wake-status-rows';
  rows.append(
    pair('调度方式', wake.mode === 'random' ? `随机 ${wake.randomMinMinutes}–${wake.randomMaxMinutes} 分钟` : `每 ${wake.intervalMinutes} 分钟`),
    pair('下一次尝试', wake.nextAttemptAt ? relativeDate(wake.nextAttemptAt) : '等待调度器安排'),
    pair('最近结果', resultText(wake)),
    pair('今日已发送', `${wake.todayCount || 0} / ${wake.dailyLimit || 0}`),
  );
  card.append(rows); return card;
}

function timeline(events) {
  const block = document.createElement('div'); block.className = 'runtime-timeline';
  const heading = document.createElement('strong'); heading.textContent = '最近运行时间线'; block.append(heading);
  if (!events.length) { block.append(copy('还没有运行事件。Bot 启动、回复或自动唤醒后会出现在这里。')); return block; }
  const list = document.createElement('ol');
  for (const event of events.slice(0, 12)) {
    const item = document.createElement('li'); item.className = `timeline-event is-${event.status || 'info'}`;
    const marker = document.createElement('span'); marker.className = 'timeline-marker'; marker.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    const line = document.createElement('div'); line.className = 'timeline-line';
    const title = document.createElement('b'); title.textContent = event.title || '运行事件';
    const time = document.createElement('time'); time.dateTime = event.at || ''; time.textContent = relativeDate(event.at);
    line.append(title, time); body.append(line);
    if (event.detail) { const detail = document.createElement('small'); detail.textContent = event.detail; body.append(detail); }
    item.append(marker, body); list.append(item);
  }
  block.append(list); return block;
}

function pair(label, value) {
  const row = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
}
function copy(value) { const node = document.createElement('p'); node.className = 'hint'; node.textContent = value; return node; }
function resultText(wake) {
  if (wake.lastResult === 'sent') return wake.lastSentAt ? `已发送 · ${relativeDate(wake.lastSentAt)}` : '已发送';
  if (wake.lastResult === 'silent') return wake.lastAttemptAt ? `保持安静 · ${relativeDate(wake.lastAttemptAt)}` : '保持安静';
  if (wake.lastResult === 'failed') return wake.lastError ? `失败 · ${wake.lastError}` : '失败';
  return '尚未尝试';
}
function relativeDate(value) {
  const date = new Date(value); if (!value || Number.isNaN(date.getTime())) return '时间未知';
  const diff = date.getTime() - Date.now(); const abs = Math.abs(diff);
  if (abs < 60_000) return diff >= 0 ? '不到 1 分钟后' : '刚刚';
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟${diff >= 0 ? '后' : '前'}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} 小时${diff >= 0 ? '后' : '前'}`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
