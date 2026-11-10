import { open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { imagePayload, inlineImage, MAX_IMAGE_BYTES, mcpImages } from '../../media/image-payload.mjs';

export async function codexTurnImages(items, threadId, env = process.env, cwd = '') {
  const images = [];
  let imageErrors = 0;
  for (const item of items) {
    if (images.length >= 10) break;
    if (item.type === 'mcpToolCall' && item.status === 'completed') {
      const media = mcpImages(item.result?.content, 10 - images.length);
      images.push(...media.images);
      imageErrors += media.imageErrors;
    } else if (item.type === 'imageGeneration' && !item.failure) {
      const inline = item.result ? tryInline(item.result) : null;
      const image = inline || (item.savedPath ? await readGeneratedImage(item.savedPath, threadId, env, cwd).catch(() => null) : null);
      if (image) images.push(image);
      else imageErrors += 1;
    }
  }
  return { images, imageErrors };
}

function tryInline(value) {
  try { return inlineImage(value); }
  catch { return null; }
}

async function readGeneratedImage(path, threadId, env, cwd) {
  if (!isAbsolute(path) || !/^[\w-]+$/u.test(threadId)) return null;
  const home = env.CODEX_HOME || join(env.HOME || env.USERPROFILE || homedir(), '.codex');
  const file = await realpath(path);
  const roots = await Promise.all([home, cwd].filter(Boolean).map((base) => realpath(join(base, 'generated_images')).catch(() => '')));
  if (!roots.some((root) => root && relative(root, file).startsWith(`${threadId}${sep}`))) return null;
  const handle = await open(file);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
    return imagePayload(await handle.readFile());
  } finally { await handle.close(); }
}
