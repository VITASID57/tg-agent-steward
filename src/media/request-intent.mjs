const IMAGE_REQUESTS = [
  /^\/draw(?:\s+|$)/iu,
  /^(?:老公|老婆|宝宝|宝贝|葵葵|亲爱的)?[，,\s]*(?:请|麻烦|帮我|给我|替我|为我|可以|能不能|能)?[，,\s]*(?:画画|画图|画一?张|绘制|生成一?张?(?:图|图片|画|插画|头像|海报|壁纸)|做一?张?(?:图|图片|画|插画|头像|海报|壁纸)|来一?张?(?:图|图片|画|插画|头像|海报|壁纸)|出一?张?(?:图|图片|画|插画|头像|海报|壁纸))/iu,
  /^测试(?:一下)?(?:画画|画图|生图)/iu,
  /(?:我想看|我想要)(?:一|两|几)?(?:张|幅)?(?:图|图片|画|插画|头像|海报|壁纸)/iu,
];

const VOICE_REQUESTS = [
  /(?:给我|帮我|请|用|发|来)(?:发|说|念|读|回)?(?:一|几|个|条|句|段)?(?:语音|声音)/iu,
  /(?:用语音|语音)(?:说|回复|回我|念|读|发)/iu,
  /(?:念|读)(?:给我|出来|一遍|一下)?听/iu,
  /发语音(?:看看|试试|给我)?/iu,
];

export function imageRequestPrompt(value) {
  const text = String(value || '').trim();
  if (!text || !IMAGE_REQUESTS.some((pattern) => pattern.test(text))) return null;
  return text.replace(/^\/draw(?:\s+|$)/iu, '').trim() || null;
}

export function isExplicitVoiceRequest(value) {
  const text = String(value || '').trim();
  return Boolean(text && VOICE_REQUESTS.some((pattern) => pattern.test(text)));
}
