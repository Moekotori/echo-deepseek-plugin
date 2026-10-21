/** Aggregate reads cover the library; only a small display summary is shared with the model. */
export async function libraryOverview(host, signal) {
  signal.throwIfAborted();
  const [summary, genres, artists] = await Promise.all([
    host.library.getSummary(),
    host.library.getGenres({ page: 1, pageSize: 12, sort: 'trackCountDesc', sourceProvider: 'local' }),
    host.library.getArtists({ page: 1, pageSize: 16, sort: 'trackCountDesc', sourceProvider: 'local' }),
  ]);
  signal.throwIfAborted();
  return { trackCount: summary.trackCount, albumCount: summary.albumCount, artistCount: summary.artistCount,
    genres: genres.items.slice(0, 12).map(item => ({ name: item.name.slice(0, 100), trackCount: item.trackCount })),
    artists: artists.items.slice(0, 16).map(item => ({ name: item.name.slice(0, 100), trackCount: item.trackCount })),
    completeGenreList: !genres.hasMore, completeArtistList: !artists.hasMore };
}
