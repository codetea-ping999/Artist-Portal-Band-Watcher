import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSource } from '../../supabase/functions/collect/source-collector.js';

const base = {
  id: 'source-1',
  artist_id: 'artist-1',
  artist_name: 'Artist',
  label: 'Source',
  url: 'https://example.test/source'
};

test('an invalid feed fails only its source while the next source remains collectable', async () => {
  const sources = [
    { ...base, id: 'bad', source_type: 'rss', url: 'https://example.test/bad.xml' },
    { ...base, id: 'good', source_type: 'official', url: 'https://example.test/home' }
  ];
  const bodies = new Map([
    [sources[0].url, '<html><title>Gateway error</title></html>'],
    [sources[1].url, '<title>Official update</title><meta name="description" content="Short summary">']
  ]);
  const results = [];
  for (const source of sources) {
    try {
      results.push({ source: source.id, result: await collectSource(source, { fetchText: async (url) => bodies.get(url) }) });
    } catch (error) {
      results.push({ source: source.id, error: error.message });
    }
  }

  assert.match(results[0].error, /valid RSS or Atom feed/);
  assert.equal(results[1].result.posts[0].title, 'Official update');
});

test('a live page with no unambiguous event returns a diagnostic instead of throwing', async () => {
  const result = await collectSource({ ...base, source_type: 'live' }, {
    fetchText: async () => '<h3>Schedule</h3><p>Details later</p>'
  });

  assert.deepEqual(result.events, []);
  assert.match(result.diagnostic, /no unambiguous live events/);
});

test('restricted social scraping is deliberately skipped without a network call', async () => {
  let fetched = false;
  const result = await collectSource({ ...base, source_type: 'x' }, {
    fetchText: async () => { fetched = true; return ''; }
  });
  assert.equal(result.skipped, true);
  assert.equal(fetched, false);
});
