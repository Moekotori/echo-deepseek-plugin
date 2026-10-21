import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractArtistArtwork, searchArtistArtwork, selectedArtistArtwork } from './src/artist-artwork.mjs';

test('extracts actual page images, resolves relative paths and discards logos, SVG and executable URLs', () => {
  const images = extractArtistArtwork('![Roselia](https://cdn.example/artist.jpg) <img alt="Full band" src="/large.png"> ![logo](https://cdn.example/logo.png) ![x](javascript:evil) ![x](https://cdn.example/a.svg)', 'https://official.example/artist/');
  assert.deepEqual(images, [{ url: 'https://cdn.example/artist.jpg', alt: 'Roselia' }, { url: 'https://official.example/large.png', alt: 'Full band' }]);
  assert.deepEqual(selectedArtistArtwork({ heroImageIndices: [1, 0, 99], heroImages: [{ url: 'https://invented.example' }] }, images.map(image => ({ ...image, sourceIndex: 2 }))),
    [{ url: images[1].url, sourceIndex: 2 }, { url: images[0].url, sourceIndex: 2 }]);
});
test('uses the existing authenticated DeepSeek search to request page content; no direct image-site requests', async () => {
  const requests = [];
  const host = { network: { cancel: async () => {}, request: async request => { requests.push(request); return { ok: true, body: JSON.stringify({ results: [
    { title: 'Artist official', url: 'https://official.example/artist', content: '![Band](https://cdn.example/photo.jpg)' },
  ] }) }; } } };
  const pages = await searchArtistArtwork(host, 'Artist', 'test-only-key', new AbortController().signal);
  assert.equal(requests.length, 1); assert.equal(new URL(requests[0].url).hostname, 'api.deepseek.com');
  assert.equal(JSON.parse(requests[0].body).need_content, true); assert.equal(JSON.parse(requests[0].body).count, 2);
  assert.equal(pages[0].images[0].url, 'https://cdn.example/photo.jpg');
});
