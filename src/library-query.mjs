/** Search every matching database row; return only the requested bounded page. */
export async function queryLibrary(host, input, signal) {
  const children = [];
  for (const field of ['title', 'artist', 'album', 'albumArtist']) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 200) throw new Error('曲库文字条件无效');
    children.push({ type: 'rule', field, operator: 'contains', value: input[field].trim() });
  }
  if (input.genres !== undefined) {
    if (!Array.isArray(input.genres) || !input.genres.length || input.genres.length > 5
      || input.genres.some(value => typeof value !== 'string' || !value.trim() || value.length > 100)) throw new Error('曲风条件无效');
    children.push({ type: 'group', match: 'any', children: input.genres.map(value => ({ type: 'rule', field: 'genre', operator: 'contains', value: value.trim() })) });
  }
  for (const [field, maximum] of [['bpm', 1000], ['duration', 86400], ['year', 9999]]) {
    const min = input[field + 'Min']; const max = input[field + 'Max'];
    if ([min, max].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > maximum))
      || min !== undefined && max !== undefined && min > max) throw new Error('曲库范围条件无效');
    if (min !== undefined) children.push({ type: 'rule', field, operator: 'atLeast', value: min });
    if (max !== undefined) children.push({ type: 'rule', field, operator: 'atMost', value: max });
  }
  if (input.instrumental !== undefined) {
    if (typeof input.instrumental !== 'boolean') throw new Error('纯音乐条件无效');
    children.push({ type: 'rule', field: 'instrumental', operator: 'is', value: input.instrumental });
  }
  const limit = input.limit ?? 40; const sort = input.sort ?? 'title'; const page = input.page ?? 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > 40 || !Number.isInteger(page) || page < 1 || page > 100_000
    || !['title', 'recentlyAdded', 'mostPlayed', 'leastPlayed'].includes(sort)) throw new Error('曲库查询页码、数量或排序无效');
  signal.throwIfAborted();
  if (typeof host.library.searchTracks !== 'function') throw new Error('请更新 ECHO 主程序，以支持整个曲库的条件检索');
  const result = await host.library.searchTracks({ rules: { match: 'all', sort,
    condition: { type: 'group', match: 'all', children }, filters: {} } }, { page, pageSize: limit });
  signal.throwIfAborted();
  return { ...result, items: result.items.filter(track => !track.unavailable && track.mediaType === 'local').slice(0, limit) };
}
