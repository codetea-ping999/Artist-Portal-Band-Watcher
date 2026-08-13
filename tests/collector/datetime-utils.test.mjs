import assert from 'node:assert/strict';
import test from 'node:test';
import { datetimeLocalValue, localDateTimeToIso } from '../../src/datetime.js';
import { daysUntil } from '../../src/utils.js';

test('datetime-local values round-trip through an explicit UTC instant', () => {
  const localValue = '2026-08-14T19:30';
  const iso = localDateTimeToIso(localValue);
  assert.match(iso, /^2026-08-1[34]T\d{2}:30:00\.000Z$/);
  assert.equal(datetimeLocalValue(iso), localValue);
  assert.throws(() => localDateTimeToIso('2026-02-30T10:00'), /Invalid datetime-local/);
});

test('daysUntil compares local calendar days instead of partial 24-hour windows', () => {
  assert.equal(daysUntil('2026-08-14T23:30:00+09:00', '2026-08-14T00:01:00+09:00'), 0);
  assert.equal(daysUntil('2026-08-15T23:30:00+09:00', '2026-08-14T23:59:00+09:00'), 1);
});
