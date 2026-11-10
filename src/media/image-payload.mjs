export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function imagePayload(image, hintedMime = '') {
  if (!image.length) throw new Error('返回了空图片');
  if (image.length > MAX_IMAGE_BYTES) throw new Error('返回图片超过 25 MB');
  const mime = detectMime(image) || (/^image\/(?:png|jpeg|webp)$/u.test(hintedMime) ? hintedMime : '');
  if (!mime) throw new Error('返回内容不是可识别的图片');
  return { image, mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] };
}

export function inlineImage(value) {
  if (typeof value !== 'string') throw new Error('没有图片数据');
  const data = value.replace(/^data:image\/(?:png|jpeg|webp);base64,/u, '');
  if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
    throw new Error('图片数据无效或超过 25 MB');
  }
  return imagePayload(Buffer.from(data, 'base64'));
}

export function mcpImages(content, limit = 10) {
  const images = [];
  let imageErrors = 0;
  for (const item of (Array.isArray(content) ? content : [])) {
    if (item?.type !== 'image' || images.length >= limit) continue;
    try { images.push(inlineImage(item.data)); }
    catch { imageErrors += 1; }
  }
  return { images, imageErrors };
}

function detectMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}
