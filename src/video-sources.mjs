import { searchMusic } from './music-search.mjs';

/** Search through the existing provider; retain only actual video pages, never generated URLs. */
export async function searchMusicVideos(host, request, key, signal) {
  const subject = Array.from(request.name + ' ' + (request.artist || '')).slice(0, 80).join('');
  const topic = request.purpose === 'explore' ? ['现场 访谈 制作 幕后', 'live interview making of'] : ['官方 MV 现场 视频', 'official music video live'];
  const results = await Promise.all([
    searchMusic(host, subject + ' site:bilibili.com/video ' + topic[0], key, signal, 3),
    searchMusic(host, subject + ' site:youtube.com/watch ' + topic[1], key, signal, 2),
  ]);
  const videos = results.flat().filter(source => {
    const url = new URL(source.url);
    const domain = url.hostname.replace(/^www\./u, '').replace(/^m\./u, '');
    return domain === 'bilibili.com' && /^\/video\/(?:BV[a-zA-Z0-9]+|av\d+)\/?$/u.test(url.pathname)
      || domain === 'youtube.com' && url.pathname === '/watch' && Boolean(url.searchParams.get('v'))
      || domain === 'youtu.be' && /^\/[\w-]+$/u.test(url.pathname);
  });
  return [...new Map(videos.map(source => [source.url, source])).values()].slice(0, 3);
}
