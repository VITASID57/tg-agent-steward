import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TYPES = {
  'image/png': { extension: 'png', magic: (data) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/jpeg': { extension: 'jpg', magic: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
};
const ID_PATTERN = /^sticker-[0-9a-f-]+\.(?:png|jpg)$/u;

export class StickerAssetStore {
  constructor(directory, maxBytes = 2 * 1024 * 1024) { this.directory = directory; this.maxBytes = maxBytes; }

  async save({ mime, dataBase64 }) {
    const type = TYPES[mime];
    if (!type) throw bad('表情图片只支持 PNG 或 JPEG');
    const data = decode(dataBase64);
    if (!data.length || data.length > this.maxBytes) throw bad(`表情图片必须小于 ${Math.floor(this.maxBytes / 1024 / 1024)} MiB`);
    if (!type.magic(data)) throw bad('图片内容与声明格式不一致');
    const id = `sticker-${randomUUID()}.${type.extension}`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, id), data, { mode: 0o600 });
    return { id, mime, bytes: data.length };
  }

  async read(id) {
    assertId(id); const data = await readFile(join(this.directory, id));
    return { id, data, mime: id.endsWith('.png') ? 'image/png' : 'image/jpeg', extension: id.endsWith('.png') ? 'png' : 'jpg' };
  }

  async remove(id) { assertId(id); await unlink(join(this.directory, id)); }
}

function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw bad('图片数据不是有效 Base64');
  return Buffer.from(value, 'base64');
}
function assertId(id) { if (!ID_PATTERN.test(String(id))) throw bad('表情资源 ID 不合法'); }
function bad(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
