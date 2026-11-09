export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function options(select, items, selected = '', emptyLabel = '') {
  select.replaceChildren();
  if (emptyLabel) select.append(new Option(emptyLabel, ''));
  for (const item of items) select.append(new Option(item.label, item.value, false, item.value === selected));
  if (selected) select.value = selected;
}

export function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function toast(message, bad = false) {
  const node = $('#toast');
  node.textContent = message; node.classList.toggle('bad', bad); node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}
