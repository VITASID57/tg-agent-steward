const MARKER = /\[\[STICKER:([^\]]+)\]\]/gu;
const REQUEST = /(表情包|贴图|来个表情|发.{0,4}表情|sticker)/iu;
const DECLINE = /(别发|不要发|不想看|别用).{0,6}(表情|贴图|sticker)/iu;

export class StickerService {
  constructor({ controlPlaneStore, assetStore, random = Math.random }) {
    this.controlPlaneStore = controlPlaneStore; this.assetStore = assetStore; this.random = random;
  }

  async candidates(bot, userText, chat = {}) {
    if (!bot?.stickers?.enabled || DECLINE.test(userText)) return [];
    const explicit = REQUEST.test(userText);
    if (!explicit && this.random() * 100 >= bot.stickers.replyProbability) return [];
    const state = await this.controlPlaneStore.get(); const wanted = new Set(bot.stickers.packIds);
    const recent = new Set(chat?.recentStickerIds || []); const terms = tokenSet(userText);
    return state.stickerPacks.filter((pack) => wanted.has(pack.id)).flatMap((pack) => pack.stickers)
      .filter((item) => item.enabled)
      .map((item) => ({ ...item, score: score(item, terms) - (recent.has(item.id) ? 2 : 0) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 8)
      .map(({ score: _score, ...item }) => item);
  }

  instructions(candidates) {
    if (!candidates.length) return '';
    const catalog = candidates.map(({ id, name, meaning, tags }) => ({ id, name, meaning, tags }));
    return `\n\n[可选表情]\n只有合适时才在完整文字回复末尾追加一个 [[STICKER:id]]。最多一个，不得编造 ID，表情不能替代有内容的回答。候选：${JSON.stringify(catalog)}`;
  }

  extract(text, candidates) {
    const allowed = new Map(candidates.map((item) => [item.id, item])); let selected = null;
    const clean = String(text ?? '').replace(MARKER, (_marker, id) => { if (!selected && allowed.has(id)) selected = allowed.get(id); return ''; }).trim();
    return { text: clean, sticker: selected };
  }

  readAsset(assetId) { return this.assetStore.read(assetId); }
}

function tokenSet(text) {
  const normalized = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); const result = new Set();
  for (const char of normalized) result.add(char);
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}
function score(item, terms) {
  const haystack = tokenSet([item.name, item.meaning, ...(item.tags || [])].join(' ')); let total = 0;
  for (const term of terms) if (haystack.has(term)) total += term.length > 1 ? 2 : 0.15;
  return total;
}
