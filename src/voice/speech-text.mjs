export const VOICE_TAGS = Object.freeze(['whispers', 'softly', 'sighs', 'laughs', 'chuckles', 'excited', 'sad', 'nervous', 'pause']);
const V4_VOICE_TAGS = Object.freeze([...VOICE_TAGS, 'happy', 'crying', 'curious', 'mischievously', 'shouts',
  'clears throat', 'long pause', 'yawning', 'sleepy drowsy voice']);

const TAG = /\[\s*([a-z][a-z -]{1,30}?)\s*\]/giu;
const GEMINI_TAGS = new Map([
  ['whispers', 'whispering'], ['softly', 'whispering'], ['sighs', 'sigh'], ['laughs', 'laughing'],
  ['chuckles', 'laughing'], ['nervous', 'scared'], ['pause', 'short pause'],
]);
const VISIBLE_TAGS = new Set([...V4_VOICE_TAGS, ...GEMINI_TAGS.values()]);
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const MARKUP = /(?:\*\*|__|`+|^#{1,6}\s+|^>\s?)/gmu;
const CJK = /[\u3400-\u9fff]/u;
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNITS = ['', '十', '百', '千'];

export function supportsVoiceTags(connection, route) {
  return connection.kind === 'vertex-ai' || (connection.kind === 'elevenlabs' && /eleven_v(?:3|4)(?:_turbo)?/iu.test(elevenModel(route)));
}

export function voiceTagGuide(connection = {}, route = {}) {
  const tags = connection.kind === 'vertex-ai' ? [...GEMINI_TAGS.keys()]
    : /eleven_v4/iu.test(elevenModel(route)) ? V4_VOICE_TAGS : VOICE_TAGS;
  return `语音允许少量语气标签：${tags.map((tag) => `[${tag}]`).join(' ')}。只在确实贴合时放在句子前，一段最多两个；标签不会显示给用户。`;
}

export function stripVoiceTags(text) {
  return String(text).replace(TAG, (all, name) => VISIBLE_TAGS.has(normalizeTag(name)) ? ' ' : all)
    .replace(/[ \t]{2,}/gu, ' ').replace(/\s+([，。！？、,.!?])/gu, '$1').trim();
}

export function prepareSpeechText(text, connection, route) {
  const readable = String(text)
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, ' ')
    .replace(/!?\[([^\]\n]*)\]\(https?:\/\/[^)\s]+\)/giu, '$1')
    .replace(/https?:\/\/[^\s<>()\[\]，。！？、；：\u3400-\u9fff]+/giu, ' ');
  const cleaned = speakNumbersInChinese(readable.replace(PICTOGRAPH, '').replace(MARKUP, ''));
  if (!supportsVoiceTags(connection, route)) return stripAllBracketTags(cleaned);
  if (connection.kind === 'elevenlabs') {
    const allowed = /eleven_v4/iu.test(elevenModel(route)) ? V4_VOICE_TAGS : VOICE_TAGS;
    return cleaned.replace(TAG, (all, name) => allowed.includes(normalizeTag(name)) ? all : ' ').replace(/[ \t]{2,}/gu, ' ').trim();
  }
  return cleaned.replace(TAG, (_all, name) => {
    const normalized = normalizeTag(name); const mapped = GEMINI_TAGS.get(normalized);
    return mapped ? `[${mapped}]` : ' ';
  }).replace(/[ \t]{2,}/gu, ' ').trim();
}

export function speakNumbersInChinese(text) {
  if (!CJK.test(text)) return text;
  return text
    .replace(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/gu, (_all, year, month, day) => `${digitsOf(year)}年${integer(Number(month))}月${integer(Number(day))}日`)
    .replace(/(?<![\d.])(\d{1,2})[:：](\d{2})(?![\d:])/gu, (_all, hour, minute) => clock(hour, minute))
    .replace(/[¥￥](\d+)(?:\.(\d+))?/gu, (_all, whole, fraction) => amount(whole, fraction))
    .replace(/(\d+)(?:\.(\d+))?\s*元/gu, (_all, whole, fraction) => amount(whole, fraction))
    .replace(/(\d+)(?:\.(\d+))?\s*[%％]/gu, (_all, whole, fraction) => `百分之${fraction === undefined ? integer(Number(whole)) : decimal(whole, fraction)}`)
    .replace(/(?<![\d/])(\d{1,4})\/(\d{1,4})(?![\d/])/gu, (_all, top, bottom) => `${integer(Number(bottom))}分之${integer(Number(top))}`)
    .replace(/(?<![\d.])(\d+)\.(\d+)(?![\d.])/gu, (_all, whole, fraction) => decimal(whole, fraction));
}

function normalizeTag(value) { return String(value).trim().toLowerCase().replaceAll('-', ' '); }
function elevenModel(route = {}) { return route.model || 'eleven_v4'; }
function stripAllBracketTags(value) { return String(value).replace(TAG, ' ').replace(/[ \t]{2,}/gu, ' ').trim(); }
function digitsOf(value) { return [...String(value)].map((digit) => DIGITS[Number(digit)] ?? digit).join(''); }
function integer(value) {
  if (!Number.isInteger(value) || value < 0 || value > 99_999_999) return String(value);
  if (value === 0) return '零'; const high = Math.floor(value / 10_000); const low = value % 10_000;
  let result = high ? `${underTenThousand(high)}万` : '';
  if (low) result += high && low < 1000 ? `零${underTenThousand(low)}` : underTenThousand(low);
  return result.startsWith('一十') ? result.slice(1) : result;
}
function underTenThousand(value) {
  const digits = String(value).padStart(4, '0').split('').map(Number); let result = ''; let zero = false;
  digits.forEach((digit, index) => { if (!digit) { zero = Boolean(result); return; } if (zero) result += '零';
    result += `${DIGITS[digit]}${UNITS[3 - index]}`; zero = false; }); return result;
}
function decimal(whole, fraction) { return `${integer(Number(whole))}点${digitsOf(fraction)}`; }
function amount(whole, fraction) { return fraction === undefined ? `${integer(Number(whole))}元` : `${decimal(whole, fraction)}元`; }
function clock(hour, minute) { const h = Number(hour); const m = Number(minute); if (h > 24 || m > 59) return `${hour}:${minute}`;
  const hours = h === 2 ? '两点' : `${integer(h)}点`; return m === 0 ? hours : `${hours}${m < 10 ? `零${integer(m)}` : integer(m)}分`; }
