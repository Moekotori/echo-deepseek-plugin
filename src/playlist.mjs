const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const normalized = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\p{S}]/gu, '');

export async function findLocalTrack(host, { title, artist }, signal) {
  signal.throwIfAborted();
  const page = await host.library.getTracks({ search: title, sourceProvider: 'local', page: 1, pageSize: 30 });
  signal.throwIfAborted();
  return page.items.find(candidate => !candidate.unavailable && normalized(candidate.title) === normalized(title)
    && normalized(candidate.artist) === normalized(artist)) ?? null;
}

export async function preparePlaylist(host, input, references, signal) {
  const name = text(input?.name, 120);
  if (!name || !Array.isArray(input.tracks) || input.tracks.length < 1 || input.tracks.length > 50) throw new Error('歌单提案格式无效');
  const tracks = []; const missing = []; const ids = new Set();
  for (const item of input.tracks) {
    signal.throwIfAborted();
    let track;
    if (typeof item?.ref === 'string' && item.ref) {
      track = references.get(item.ref);
      if (!track) throw new Error('歌曲引用已失效，请重新选曲');
    } else {
      const title = text(item?.title, 200); const artist = text(item?.artist, 200);
      if (!title || !artist) throw new Error('选曲需要曲名和艺术家');
      track = await findLocalTrack(host, { title, artist }, signal);
      if (!track) missing.push({ title, artist });
    }
    if (track && !ids.has(track.id)) { ids.add(track.id); tracks.push(track); }
  }
  return { name, description: text(input.description, 500), tracks, missing, playlistId: null, saved: false };
}

/** Only the explicit panel button invokes this write; the model cannot invoke it. */
export async function savePlaylist(host, draft, selectedIds) {
  if (draft.saved) throw new Error('歌单已创建');
  const selected = new Set(selectedIds);
  const tracks = draft.tracks.filter(track => selected.has(track.id));
  if (!draft.name.trim() || !tracks.length) throw new Error('请填写歌单名称并选择歌曲');
  if (!draft.playlistId) {
    const playlist = await host.library.createPlaylist({ name: draft.name.trim().slice(0, 120), description: draft.description });
    draft.playlistId = playlist.id;
  }
  await host.library.addTracksToPlaylist(draft.playlistId, tracks.map(track => track.id));
  draft.saved = true;
  return tracks.length;
}
