import { postDeepSeek } from './api.mjs';

const imageUrl = (input, pageUrl) => {
  try {
    const url = new URL(input.replace(/&amp;/gu, '&'), pageUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.href.length <= 2048
      && !/\.(?:svg|gif)(?:[?#]|$)/iu.test(url.href) ? url.href : null;
  } catch { return null; }
};

/** URLs come from actual page markup. The model may select an index, never invent a URL. */
export function extractArtistArtwork(content, pageUrl) {
  const text = typeof content === 'string' ? content.slice(0, 60_000) : '';
  const found = [];
  for (const match of text.matchAll(/!\[([^\]]{0,200})\]\(<?([^\s<>]+?)>?(?:\s+"[^"]*")?\)|<img\b[^>]*>/giu)) {
    const markup = match[0];
    const raw = match[2] ?? /\bsrc=["']([^"']+)["']/iu.exec(markup)?.[1];
    const alt = (match[1] ?? /\balt=["']([^"']*)["']/iu.exec(markup)?.[1] ?? '').slice(0, 160);
    const url = raw && imageUrl(raw, pageUrl);
    if (!url || /(?:favicon|(?:^|[\s/_-])logo(?:[\s/_.-]|$)|social[-_ ]icon)/iu.test(url + ' ' + alt)) continue;
    if (!found.some(item => item.url === url)) found.push({ url, alt });
    if (found.length === 8) break;
  }
  return found;
}

export async function searchArtistArtwork(host, name, key, signal) {
  const result = await postDeepSeek(host, '/v1/tools/search', {
    query: Array.from(name + ' official artist profile promotional photo high resolution').slice(0, 128).join(''), count: 2, need_content: true,
  }, key, signal);
  if (!Array.isArray(result.results)) throw new Error('DeepSeek 图片来源格式无效');
  return result.results.slice(0, 2).flatMap(page => {
    const url = imageUrl(page.url, 'https://api.deepseek.com');
    if (!url || typeof page.title !== 'string') return [];
    return [{ label: page.title.slice(0, 200), url, summary: typeof page.summary === 'string' ? page.summary.slice(0, 1600) : '',
      images: extractArtistArtwork(page.content, url) }];
  });
}

export const artworkPrompt = '另从artworkCandidates选择最多3张真正对应当前艺人的高清宣传照/组合合照/角色全员图，输出heroImageIndices数组（候选零基序号，最适合横幅的在前）。根据所属企划、姓名、页面标题和图片alt核对身份；不要将同企划其他组合、单张专辑封面、商品、logo、网站背景或无关人物当作艺人合照。宁缺毋滥，没有明确对应图片则为空。不要生成图片网址，也不要猜原图分辨率；宿主会读取真实像素并拒绝低清图。';

export function selectedArtistArtwork(info, candidates) {
  return [...new Set(Array.isArray(info.heroImageIndices) ? info.heroImageIndices.slice(0, 3) : [])]
    .flatMap(index => Number.isInteger(index) && candidates[index] ? [{ url: candidates[index].url, sourceIndex: candidates[index].sourceIndex }] : []);
}
