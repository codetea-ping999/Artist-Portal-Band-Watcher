export const MAX_NOTIFICATION_ATTEMPTS = 3;
export const MAX_NOTIFICATION_SENDS_PER_RUN = 50;

export function createNotificationBudget(limit = MAX_NOTIFICATION_SENDS_PER_RUN) {
  return { remaining: Math.max(0, Number(limit) || 0) };
}

export function resolveRetryCandidates({ deliveries = [], rules = [], posts = [], events = [] }) {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const postById = new Map(posts.map((post) => [post.id, post]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const ready = [];
  const stale = [];

  for (const delivery of deliveries) {
    const rule = ruleById.get(delivery.rule_id);
    if (!rule?.enabled || rule.destination_key !== "default") {
      stale.push(delivery);
      continue;
    }
    if ((delivery.attempts ?? 0) >= MAX_NOTIFICATION_ATTEMPTS) {
      stale.push(delivery);
      continue;
    }

    const entity = delivery.entity_type === "post"
      ? postById.get(delivery.entity_id)
      : eventById.get(delivery.entity_id);
    if (!entity || entity.raw_hash !== delivery.change_hash) {
      stale.push(delivery);
      continue;
    }
    if (rule.artist_id && rule.artist_id !== entity.artist_id) {
      stale.push(delivery);
      continue;
    }

    const eventType = String(rule.event_type ?? "");
    const validType = delivery.entity_type === "post"
      ? eventType === "post_created"
      : eventType === "event_created" || eventType === "event_changed";
    if (!validType) {
      stale.push(delivery);
      continue;
    }

    ready.push({
      delivery,
      candidate: {
        entity_type: delivery.entity_type,
        event_type: eventType,
        entity_id: entity.id,
        artist_id: entity.artist_id,
        title: entity.title,
        url: delivery.entity_type === "post" ? entity.url : (entity.ticket_url ?? entity.source_url),
        change_hash: entity.raw_hash
      }
    });
  }

  return { ready, stale };
}
