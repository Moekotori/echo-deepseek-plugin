import { postDeepSeek } from './api.mjs';

export const localDate = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
export async function searchMusic(host, query, key, signal, count = 4) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('请输入检索对象');
  const response = await postDeepSeek(host, '/v1/tools/search', {
    query: Array.from(query.trim()).slice(0, 128).join(''), count, need_content: false,
  }, key, signal);
  if (!Array.isArray(response.results)) throw new Error('DeepSeek 搜索结果格式无效');
  return response.results.slice(0, count).flatMap(item => {
    if (typeof item.title !== 'string' || typeof item.url !== 'string' || item.url.length > 2048) return [];
    let url;
    try { url = new URL(item.url); } catch { return []; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
    return [{ label: item.title.slice(0, 200), url: url.href,
      publishedAt: typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(item.date) && Number.isFinite(Date.parse(item.date)) ? item.date.slice(0, 10) : null,
      summary: typeof item.summary === 'string' ? item.summary.slice(0, 1600) : '',
    }];
  });
}
