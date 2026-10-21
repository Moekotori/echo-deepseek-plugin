import { findLocalTrack } from './playlist.mjs';

export async function prepareRecommendations(host, input, references, signal) {
  if (!Array.isArray(input?.tracks) || !input.tracks.length || input.tracks.length > 12) throw new Error('推荐歌曲数量应为1至12首');
  const result = []; const seen = new Set();
  for (const item of input.tracks) {
    signal.throwIfAborted();
    if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 300) throw new Error('每首推荐歌曲都需要简短的推荐理由');
    let track = null; let title; let artist;
    if (typeof item.ref === 'string' && item.ref) {
      track = references.get(item.ref);
      if (!track) throw new Error('歌曲引用已失效，请重新推荐');
      title = track.title; artist = track.artist;
    } else {
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
        || typeof item.artist !== 'string' || !item.artist.trim() || item.artist.length > 200) throw new Error('推荐歌曲需要曲名和艺术家');
      title = item.title.trim(); artist = item.artist.trim(); track = await findLocalTrack(host, { title, artist }, signal);
    }
    signal.throwIfAborted();
    const identity = title.normalize('NFC').toLowerCase() + '\n' + artist.normalize('NFC').toLowerCase();
    if (seen.has(identity)) continue; seen.add(identity);
    result.push({ title: title.slice(0, 200), artist: artist.slice(0, 200), reason: item.reason.trim(), track });
  }
  return result;
}

/** Cached personal daily results contain names and reasons, never local media identities. */
export const recommendationFacts = items => items.map(({ title, artist, reason }) => ({ title, artist, reason }));

export async function matchRecommendations(host, items, signal) {
  const result = [];
  for (let index = 0; index < items.length; index += 2) {
    const batch = await Promise.all(items.slice(index, index + 2).map(async item => ({ ...item, track: await findLocalTrack(host, item, signal) })));
    result.push(...batch);
  }
  signal.throwIfAborted(); return result;
}
