import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHtmlSnapshot } from '../../supabase/functions/collect/html-snapshot.js';

const source = {
  id: 'source-1',
  artist_id: 'artist-1',
  source_type: 'official',
  label: 'Official',
  url: 'https://example.test/'
};

test('HTML snapshot stores only a title, URL, and short description', () => {
  const html = '<html><head><title>Official &amp; News</title><meta name="description" content="A short update"></head><body>private full body</body></html>';
  const [post] = parseHtmlSnapshot(source, html, { now: () => new Date('2026-08-14T00:00:00Z') });

  assert.equal(post.title, 'Official & News');
  assert.equal(post.summary, 'A short update');
  assert.equal(post.url, source.url);
  assert.equal(JSON.stringify(post).includes('private full body'), false);
});

test('unchanged HTML metadata has a stable hash across collection times', () => {
  const html = '<title>Stable</title><meta content="Description" name="description">';
  const [first] = parseHtmlSnapshot(source, html, { now: () => new Date('2026-08-14T00:00:00Z') });
  const [second] = parseHtmlSnapshot(source, html, { now: () => new Date('2026-08-15T00:00:00Z') });

  assert.notEqual(first.published_at, second.published_at);
  assert.equal(first.raw_hash, second.raw_hash);
});
