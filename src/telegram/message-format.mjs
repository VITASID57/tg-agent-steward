const TELEGRAM_SAFE_LENGTH = 3900;

export function splitTelegramMessage(text, settings) {
  const clean = String(text ?? '').trim();
  if (!clean) return [];
  const chunks = settings.splitParagraphs ? clean.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean) : [clean];
  return chunks.flatMap((chunk) => settings.longMessageSplit ? splitLong(chunk) : [chunk]);
}

function splitLong(text) {
  if (text.length <= TELEGRAM_SAFE_LENGTH) return [text];
  const result = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_SAFE_LENGTH) {
    let at = remaining.lastIndexOf('\n', TELEGRAM_SAFE_LENGTH);
    if (at < TELEGRAM_SAFE_LENGTH * 0.6) at = remaining.lastIndexOf('。', TELEGRAM_SAFE_LENGTH) + 1;
    if (at < TELEGRAM_SAFE_LENGTH * 0.6) at = TELEGRAM_SAFE_LENGTH;
    result.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}
