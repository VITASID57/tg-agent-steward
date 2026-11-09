import { $, $$, toast } from './dom.js';

const preference = matchMedia('(prefers-reduced-motion: reduce)');
let paused = localStorage.getItem('tg-steward-motion') === 'paused';
let indicator;
let currentTab = 'overview';
const easing = 'cubic-bezier(.22,1,.36,1)';

export function initMotion() {
  syncMotion(); preference.addEventListener('change', syncMotion);
  $('#motion-toggle').onclick = () => {
    paused = !paused; localStorage.setItem('tg-steward-motion', paused ? 'paused' : 'on'); syncMotion();
  };
  indicator = document.createElement('span'); indicator.className = 'tab-indicator'; indicator.setAttribute('aria-hidden', 'true');
  $('.tabs').prepend(indicator); $('.tabs').classList.add('has-indicator');
  new ResizeObserver(() => moveIndicator(false)).observe($('.tabs'));
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('motion-paused', document.hidden || paused || preference.matches);
  });
  for (const form of $$('form')) {
    const handler = form.onsubmit; if (!handler) continue;
    form.onsubmit = async (event) => {
      event.preventDefault(); if (form.getAttribute('aria-busy') === 'true') return;
      const button = event.submitter; const label = button?.textContent;
      form.setAttribute('aria-busy', 'true');
      if (button) { button.disabled = true; button.textContent = '正在保存…'; }
      try { await handler(event); }
      catch (error) { toast(error.message || '保存失败，请重试', true); }
      finally { form.removeAttribute('aria-busy'); if (button) { button.disabled = false; button.textContent = label; } }
    };
  }
}

export function revealWorkspace() {
  const panel = $('.botanical-panel'); const before = panel.getBoundingClientRect();
  document.body.classList.add('connected'); $('#login-panel').hidden = true; $('#app').hidden = false;
  const after = panel.getBoundingClientRect();
  if (allowsMotion() && after.width && before.width && matchMedia('(min-width:851px)').matches) {
    panel.animate([{ transform:`translate(${before.x - after.x}px,${before.y - after.y}px) scale(${before.width / after.width},${before.height / after.height})`, transformOrigin:'top left' },
      { transform:'none', transformOrigin:'top left' }], { duration:650, easing });
  }
  showPage(currentTab, false); entrance($('#app'), 22, 520);
  $('.tab-page.active h2')?.focus({ preventScroll:true });
}

export function showPage(name, userAction = true) {
  const target = $(`[data-page="${name}"]`); if (!target) return;
  const previousIndex = $$('[data-tab]').findIndex((item) => item.dataset.tab === currentTab);
  const nextIndex = $$('[data-tab]').findIndex((item) => item.dataset.tab === name);
  for (const button of $$('[data-tab]')) {
    const active = button.dataset.tab === name; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const page of $$('[data-page]')) page.classList.toggle('active', page === target);
  for (const heading of $$('[data-page] h2')) heading.tabIndex = -1;
  currentTab = name; moveIndicator(userAction);
  if (userAction) {
    history.replaceState(null, '', `#${name}`);
    entrance(target, nextIndex >= previousIndex ? 12 : -12, 340);
    target.querySelector('h2')?.focus({ preventScroll:true });
  }
}

function moveIndicator(animate) {
  if (!indicator || !$('#app') || $('#app').hidden) return;
  const active = $('.tabs button.active'); if (!active) return;
  const old = indicator.getBoundingClientRect(); const next = active.getBoundingClientRect();
  indicator.style.width = `${active.offsetWidth}px`; indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  if (animate && allowsMotion() && old.width && matchMedia('(min-width:521px)').matches) {
    indicator.getAnimations().forEach((animation) => animation.cancel());
    indicator.animate([{ transform:`translateX(${active.offsetLeft + old.left - next.left}px) scaleX(${old.width / next.width})`, transformOrigin:'left center' },
      { transform:`translateX(${active.offsetLeft}px) scaleX(1)`, transformOrigin:'left center' }], { duration:400, easing });
  }
}
function entrance(element, offset, duration) {
  element.getAnimations().forEach((animation) => animation.cancel());
  if (allowsMotion()) element.animate([{ opacity:0, transform:`translateY(${offset}px)` }, { opacity:1, transform:'none' }], { duration, easing });
}
function allowsMotion() { return !paused && !preference.matches; }
function syncMotion() {
  const disabled = paused || preference.matches;
  document.body.classList.toggle('motion-paused', disabled);
  $('#motion-toggle').textContent = disabled ? '动效 · 关' : '动效 · 开';
  $('#motion-toggle').setAttribute('aria-pressed', String(!disabled));
  $('#motion-toggle').setAttribute('aria-label', disabled ? '恢复动态效果' : '减少动态效果');
  $('#motion-toggle').disabled = preference.matches;
  $('#motion-toggle').title = preference.matches ? '已跟随系统的减少动态效果设置' : '';
  if (disabled) document.getAnimations().filter((item) => !item.animationName).forEach((item) => item.cancel());
}
