import assert from 'node:assert/strict';
import test from 'node:test';
import { filterEventsByPeriod } from '../../src/event-period.js';
import { buildIcs } from '../../src/utils.js';

const localIso = (year, month, day, hour = 19) => new Date(year, month - 1, day, hour).toISOString();
const now = new Date(2026, 7, 12, 12); // Wednesday, 12 August 2026 in the runner's local timezone.
const events = [
  { id: 'mon', artist_id: 'artist-1', title: 'Monday', starts_at: localIso(2026, 8, 10) },
  { id: 'sun', artist_id: 'artist-1', title: 'Sunday', starts_at: localIso(2026, 8, 16) },
  { id: 'next-mon', artist_id: 'artist-1', title: 'Next Monday', starts_at: localIso(2026, 8, 17) },
  { id: 'month-end', artist_id: 'artist-1', title: 'Month end', starts_at: localIso(2026, 8, 31) },
  { id: 'next-month', artist_id: 'artist-1', title: 'Next month', starts_at: localIso(2026, 9, 1) },
  { id: 'tbd', artist_id: 'artist-1', title: 'TBD', starts_at: null }
];

test('week and month filters use calendar boundaries', () => {
  assert.deepEqual(filterEventsByPeriod(events, 'week', now).map((event) => event.id), ['mon', 'sun']);
  assert.deepEqual(filterEventsByPeriod(events, 'month', now).map((event) => event.id), ['mon', 'sun', 'next-mon', 'month-end']);
});

test('upcoming includes undated items while ICS exports exactly the dated subset', () => {
  const filtered = filterEventsByPeriod(events, 'upcoming', now);
  assert.deepEqual(filtered.map((event) => event.id), ['sun', 'next-mon', 'month-end', 'next-month', 'tbd']);
  const ics = buildIcs(filtered, [{ id: 'artist-1', name: 'Artist' }]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 4);
  assert.match(ics, /UID:sun@artist-portal-band-watcher/);
  assert.doesNotMatch(ics, /UID:tbd@artist-portal-band-watcher/);
});
