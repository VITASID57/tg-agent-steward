import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

export async function uploadWechatMedia({ client, data, toUserId, mediaType, cdnBaseUrl = DEFAULT_CDN_BASE_URL }) {
  const plaintext = Buffer.from(data);
  const key = randomBytes(16);
  const filekey = randomBytes(16).toString('hex');
  const upload = await client.getUploadUrl({
    filekey, media_type: mediaType, to_user_id: String(toUserId), rawsize: plaintext.length,
    rawfilemd5: createHash('md5').update(plaintext).digest('hex'),
    filesize: Math.ceil((plaintext.length + 1) / 16) * 16,
    no_need_thumb: true, aeskey: key.toString('hex'),
  });
  const url = upload.upload_full_url?.trim() || buildUploadUrl(cdnBaseUrl, upload.upload_param, filekey);
  if (!url) throw new Error('微信媒体上传权限不可用');
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const response = await client.fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: encrypted,
  });
  if (!response.ok) throw new Error(`微信媒体上传失败（${response.status}）`);
  const downloadParam = response.headers.get('x-encrypted-param');
  if (!downloadParam) throw new Error('微信媒体上传成功但没有返回下载凭据');
  return {
    filekey, downloadParam, aesKey: Buffer.from(key.toString('hex')).toString('base64'),
    rawSize: plaintext.length, encryptedSize: encrypted.length,
  };
}

export function imageItem(uploaded) {
  return {
    type: 2,
    image_item: {
      media: mediaReference(uploaded),
      mid_size: uploaded.encryptedSize,
    },
  };
}

export function fileItem(uploaded, fileName) {
  return {
    type: 4,
    file_item: {
      media: mediaReference(uploaded),
      file_name: String(fileName || 'audio.bin'),
      len: String(uploaded.rawSize),
    },
  };
}

function mediaReference(uploaded) {
  return {
    encrypt_query_param: uploaded.downloadParam,
    aes_key: uploaded.aesKey,
    encrypt_type: 1,
  };
}

function buildUploadUrl(cdnBaseUrl, uploadParam, filekey) {
  if (!uploadParam) return '';
  return `${String(cdnBaseUrl || DEFAULT_CDN_BASE_URL).replace(/\/$/u, '')}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}
