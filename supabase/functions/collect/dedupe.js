export function canonicalTimestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function eventIdentity(event) {
  return `${event.artist_id}:${event.title}:${canonicalTimestamp(event.starts_at)}`;
}

function uniquePosts(posts) {
  const seenExternalIds = new Set();
  const seenUrls = new Set();
  return posts.filter((post) => {
    const externalId = String(post.external_id ?? "").trim();
    const externalIdentity = externalId ? `${post.source_id ?? ""}\u001f${externalId}` : "";
    if ((externalIdentity && seenExternalIds.has(externalIdentity)) || seenUrls.has(post.url)) return false;
    if (externalIdentity) seenExternalIds.add(externalIdentity);
    seenUrls.add(post.url);
    return true;
  });
}

export function planPostChanges(posts, existing) {
  const incoming = uniquePosts(posts);
  const byUrl = new Map(existing.map((row) => [row.url, row]));
  const byExternalId = new Map(existing
    .filter((row) => row.external_id)
    .map((row) => [`${row.source_id ?? ""}\u001f${row.external_id}`, row]));
  const changed = incoming.flatMap((post) => {
    const externalIdentity = post.external_id ? `${post.source_id ?? ""}\u001f${post.external_id}` : "";
    const current = (externalIdentity ? byExternalId.get(externalIdentity) : null) ?? byUrl.get(post.url);
    if (current?.raw_hash === post.raw_hash) return [];
    return [{ ...post, _existingId: current?.id ?? null, _isNew: !current }];
  });
  return {
    changed,
    unchanged: incoming.length - changed.length,
    duplicates: posts.length - incoming.length
  };
}

export function planEventChanges(events, existing) {
  const incoming = [...new Map(events.map((event) => [eventIdentity(event), event])).values()];
  const byIdentity = new Map(existing.map((row) => [eventIdentity(row), row]));
  const changed = incoming.flatMap((event) => {
    const current = byIdentity.get(eventIdentity(event));
    if (current?.raw_hash === event.raw_hash) return [];
    return [{ ...event, _existingId: current?.id ?? null, _isNew: !current }];
  });
  return {
    changed,
    unchanged: incoming.length - changed.length,
    duplicates: events.length - incoming.length
  };
}
