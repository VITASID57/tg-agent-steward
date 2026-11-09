import { $ } from './dom.js';

let pending = 0;

export function showAvatar(node, avatar, name) {
  node.replaceChildren();
  node.classList.toggle('is-default-avatar', !avatar);
  const image = new Image(); image.src = avatar || '/assets/gentian-film.png';
  image.alt = avatar ? `${name || 'Bot'} 的卡片头像` : '默认透光龙胆花卡片图'; node.append(image);
}

export function refreshAvatar() {
  showAvatar($('#bot-avatar-preview'), $('#bot-avatar').value, $('#bot-name').value);
  $('#bot-avatar-remove').disabled = !$('#bot-avatar').value;
}

export function resetAvatarFeedback() {
  pending++;
  $('#bot-avatar-file').value = ''; $('#bot-avatar-feedback').textContent = '';
  refreshAvatar();
}

export function bindBotAvatar() {
  $('#bot-name').addEventListener('input', refreshAvatar);
  $('#bot-avatar-remove').onclick = () => {
    pending++; $('#bot-avatar').value = ''; refreshAvatar();
    $('#bot-avatar-feedback').textContent = '已恢复默认花图，保存 Bot 后生效。';
    $('#bot-avatar').dispatchEvent(new Event('input', { bubbles: true }));
  };
  $('#bot-avatar-file').onchange = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const ticket = ++pending;
    $('#bot-avatar-feedback').textContent = '正在处理头像…';
    try {
      const avatar = await makeAvatar(file);
      if (ticket !== pending) return;
      $('#bot-avatar').value = avatar; refreshAvatar();
      $('#bot-avatar-feedback').textContent = '预览已更新，记得保存 Bot。';
      $('#bot-avatar').dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      if (ticket === pending) $('#bot-avatar-feedback').textContent = error.message;
    } finally { if (ticket === pending) event.target.value = ''; }
  };
}

async function makeAvatar(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10 MB，请先缩小后再上传。');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('这张图片无法读取，请换一张试试。'); }
  try {
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 576;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#12213a'; ctx.fillRect(0, 0, 384, 576);
    const targetRatio = 2 / 3; const sourceRatio = bitmap.width / bitmap.height;
    const sourceWidth = sourceRatio > targetRatio ? bitmap.height * targetRatio : bitmap.width;
    const sourceHeight = sourceRatio > targetRatio ? bitmap.height : bitmap.width / targetRatio;
    ctx.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2,
      sourceWidth, sourceHeight, 0, 0, 384, 576);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally { bitmap.close(); }
}
