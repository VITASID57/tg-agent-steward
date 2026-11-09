// Only small, embedded raster previews belong in the control-plane configuration.
export function normalizeAvatar(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 200_000) throw bad();
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match) throw bad();
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw bad();
  return value;
}
function bad() { return Object.assign(new Error('头像必须是小于 150 KB 的 PNG、JPEG 或 WebP 预览图片'), { statusCode: 400 }); }
