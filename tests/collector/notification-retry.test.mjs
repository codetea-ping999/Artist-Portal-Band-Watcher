import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  createNotificationBudget,
  resolveRetryCandidates
} from "../../supabase/functions/collect/notification-retry.js";

const rule = {
  id: "rule-1",
  artist_id: "artist-1",
  event_type: "post_created",
  destination_key: "default",
  enabled: true
};
const post = {
  id: "post-1",
  artist_id: "artist-1",
  title: "New post",
  url: "https://example.test/post/1",
  raw_hash: "hash-1"
};

test("reconstructs a failed notification so a later collector run can retry it", () => {
  const delivery = {
    id: "delivery-1",
    rule_id: rule.id,
    entity_type: "post",
    entity_id: post.id,
    change_hash: post.raw_hash,
    status: "failed",
    attempts: 1
  };
  const result = resolveRetryCandidates({ deliveries: [delivery], rules: [rule], posts: [post] });

  assert.equal(result.ready.length, 1);
  assert.deepEqual(result.ready[0].candidate, {
    entity_type: "post",
    event_type: "post_created",
    entity_id: post.id,
    artist_id: post.artist_id,
    title: post.title,
    url: post.url,
    change_hash: post.raw_hash
  });
  assert.deepEqual(result.stale, []);
});

test("does not retry disabled, exhausted, or superseded deliveries", () => {
  const base = {
    rule_id: rule.id,
    entity_type: "post",
    entity_id: post.id,
    change_hash: post.raw_hash,
    status: "failed"
  };
  const result = resolveRetryCandidates({
    deliveries: [
      { ...base, id: "exhausted", attempts: MAX_NOTIFICATION_ATTEMPTS },
      { ...base, id: "stale", attempts: 1, change_hash: "old-hash" }
    ],
    rules: [rule],
    posts: [post]
  });

  assert.equal(result.ready.length, 0);
  assert.deepEqual(result.stale.map((delivery) => delivery.id), ["exhausted", "stale"]);

  const disabled = resolveRetryCandidates({
    deliveries: [{ ...base, id: "disabled", attempts: 1 }],
    rules: [{ ...rule, enabled: false }],
    posts: [post]
  });
  assert.equal(disabled.ready.length, 0);
  assert.equal(disabled.stale.length, 1);
  assert.equal(disabled.stale[0].id, "disabled");
});

test("notification budget bounds provider calls in one collector invocation", () => {
  const budget = createNotificationBudget(2);
  assert.equal(budget.remaining, 2);
  budget.remaining -= 1;
  budget.remaining -= 1;
  assert.equal(budget.remaining, 0);
});
