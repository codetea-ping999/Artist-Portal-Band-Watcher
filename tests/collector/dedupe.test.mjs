import assert from "node:assert/strict";
import test from "node:test";
import { planEventChanges, planPostChanges } from "../../supabase/functions/collect/dedupe.js";

test("matches a feed item by source-scoped stable external ID when its canonical URL changes", () => {
  const existing = [{ id: "post-1", source_id: "source-a", url: "https://example.test/old", external_id: "guid-1", raw_hash: "old" }];
  const post = { source_id: "source-a", url: "https://example.test/new", external_id: "guid-1", raw_hash: "new" };
  const plan = planPostChanges([post], existing);

  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0]._existingId, "post-1");
  assert.equal(plan.changed[0]._isNew, false);
});

test("deduplicates repeated incoming posts by external ID as well as URL", () => {
  const first = { source_id: "source-a", url: "https://example.test/a", external_id: "guid-1", raw_hash: "same" };
  const duplicate = { ...first, url: "https://example.test/a?alternate=1" };
  const plan = planPostChanges([first, duplicate], []);

  assert.equal(plan.changed.length, 1);
  assert.equal(plan.duplicates, 1);
});

test("does not collide when two sources reuse the same GUID", () => {
  const existing = [{ id: "post-a", source_id: "source-a", url: "https://a.example/item", external_id: "1", raw_hash: "a" }];
  const incoming = [{ source_id: "source-b", url: "https://b.example/item", external_id: "1", raw_hash: "b" }];
  const plan = planPostChanges(incoming, existing);

  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0]._isNew, true);
  assert.equal(plan.changed[0]._existingId, null);
});

test("event identity follows the database uniqueness constraint across sources", () => {
  const existing = [{
    id: "event-1",
    artist_id: "artist-1",
    title: "Live",
    starts_at: "2026-09-01T10:00:00Z",
    source_url: "https://source-a.test",
    raw_hash: "old"
  }];
  const incoming = {
    artist_id: "artist-1",
    title: "Live",
    starts_at: "2026-09-01T19:00:00+09:00",
    source_url: "https://source-b.test",
    raw_hash: "new"
  };
  const plan = planEventChanges([incoming], existing);

  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0]._existingId, "event-1");
  assert.equal(plan.changed[0]._isNew, false);
});
