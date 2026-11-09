import { inflateRawSync } from 'node:zlib';

export function firstImageFromZip(buffer) {
  const eocd = findSignatureBackwards(buffer, 0x06054b50); if (eocd < 0) throw new Error('NovelAI 返回的 ZIP 不完整');
  const entries = buffer.readUInt16LE(eocd + 10); let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries && offset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10); const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32); const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (/\.(?:png|jpe?g|webp)$/iu.test(name)) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('NovelAI ZIP 本地文件头无效');
      const localName = buffer.readUInt16LE(localOffset + 26); const localExtra = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra; const payload = buffer.subarray(start, start + size);
      if (method === 0) return payload;
      if (method === 8) return inflateRawSync(payload);
      throw new Error(`不支持的 ZIP 压缩方式：${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('NovelAI 返回包里没有图片');
}

function findSignatureBackwards(buffer, signature) {
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index -= 1) if (buffer.readUInt32LE(index) === signature) return index;
  return -1;
}
