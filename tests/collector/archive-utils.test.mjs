import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArchiveExport, filterPrivateArchive } from '../../src/archive-utils.js';

const archive = {
  tracks: [{ id: 'track-1', title: 'Black Market Blues', tags: ['live'], practice_status: 'ready', notes: 'intro' }],
  practiceEntries: [{ id: 'practice-1', track_id: 'track-1', practiced_on: '2026-08-14', status: 'completed', duration_minutes: 30, notes: 'tempo' }],
  setlists: [{ id: 'setlist-1', title: 'Summer Live', performed_on: '2026-08-10', notes: '' }],
  setlistItems: [{ id: 'item-1', setlist_id: 'setlist-1', title: 'The World', notes: 'encore' }],
  notificationRules: [{ id: 'private-but-not-archive' }],
  deliveries: [{ id: 'delivery-not-exported' }]
};

test('archive search covers tracks, practice notes, and setlist songs', () => {
  assert.equal(filterPrivateArchive(archive, 'black').tracks.length, 1);
  assert.equal(filterPrivateArchive(archive, 'tempo').practiceEntries.length, 1);
  assert.equal(filterPrivateArchive(archive, 'encore').setlists.length, 1);
});

test('archive export excludes notification configuration and delivery history', () => {
  const exported = buildArchiveExport(archive, '2026-08-14T00:00:00.000Z');
  assert.equal(exported.schema_version, 1);
  assert.deepEqual(exported.tracks, archive.tracks);
  assert.equal('notificationRules' in exported, false);
  assert.equal('deliveries' in exported, false);
});
