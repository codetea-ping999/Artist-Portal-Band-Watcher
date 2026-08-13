import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import { DiscordDeliveryError, postDiscordUpdate } from "./discord-notifier.js";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_NOTIFICATION_SENDS_PER_RUN,
  createNotificationBudget,
  resolveRetryCandidates
} from "./notification-retry.js";
import { eventIdentity, planEventChanges, planPostChanges } from "./dedupe.js";
import { collectSource } from "./source-collector.js";

type Source = {
  id: string;
  artist_id: string;
  artist_name: string;
  source_type: string;
  label: string;
  url: string;
  config?: Record<string, unknown> | null;
};

type SourceRow = Omit<Source, "artist_name"> & {
  artists?: { name?: string } | null;
};

type CollectedPost = {
  artist_id: string;
  source_id: string;
  source_type: string;
  title: string;
  url: string;
  summary: string;
  external_id: string;
  published_at: string | null;
  metadata?: Record<string, unknown>;
  raw_hash: string;
};

type CollectedEvent = {
  artist_id: string;
  source_id: string;
  title: string;
  venue: string;
  city: string;
  starts_at: string;
  doors_at: string | null;
  ticket_url: string | null;
  status: string;
  source_url: string;
  notes?: string;
  raw_hash: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sharedSecret = Deno.env.get("COLLECT_SHARED_SECRET") ?? "";
const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY") ?? "";
const discordWebhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL") ?? "";
const userAgent = "ArtistPortalBandWatcher/0.2 (+https://github.com/codetea-ping999/Artist-Portal-Band-Watcher)";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5"
    },
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
  }

  return await response.text();
}

async function persistPosts(
  supabase: SupabaseClient<any>,
  source: Source,
  posts: CollectedPost[]
) {
  if (posts.length === 0) return { changed: 0, unchanged: 0, duplicates: 0, notifications: [] as NotificationCandidate[] };
  const { data: existing, error: existingError } = await supabase
    .from("posts")
    .select("id, source_id, url, external_id, raw_hash")
    .eq("artist_id", source.artist_id);

  if (existingError) throw existingError;

  const plan = planPostChanges(posts, existing ?? []);
  const changed = plan.changed;

  let records: Array<Record<string, any>> = [];
  if (changed.length) {
    const updates = changed.filter((post) => post._existingId);
    const inserts = changed.filter((post) => !post._existingId);
    if (updates.length) {
      const { data, error } = await supabase
        .from("posts")
        .upsert(updates.map(({ _existingId, _isNew, ...post }) => ({ id: _existingId, ...post })), { onConflict: "id" })
        .select("id, artist_id, title, url, raw_hash");
      if (error) throw error;
      records.push(...(data ?? []));
    }
    if (inserts.length) {
      const { data, error } = await supabase
        .from("posts")
        .upsert(inserts.map(({ _existingId, _isNew, ...post }) => post), { onConflict: "artist_id,url" })
        .select("id, artist_id, title, url, raw_hash");
      if (error) throw error;
      records.push(...(data ?? []));
    }
  }

  const idByUrl = new Map(records.map((row) => [row.url, row.id]));
  return {
    changed: changed.length,
    unchanged: plan.unchanged,
    duplicates: plan.duplicates,
    notifications: changed
      .filter((post) => post._isNew)
      .flatMap((post) => {
        const entityId = idByUrl.get(post.url);
        return entityId ? [{
          entity_type: "post" as const,
          event_type: "post_created" as const,
          entity_id: entityId,
          artist_id: post.artist_id,
          title: post.title,
          url: post.url,
          change_hash: post.raw_hash
        }] : [];
      })
  };
}

async function persistEvents(
  supabase: SupabaseClient<any>,
  source: Source,
  events: CollectedEvent[]
) {
  if (events.length === 0) return { changed: 0, unchanged: 0, duplicates: 0, notifications: [] as NotificationCandidate[] };
  const { data: existing, error: existingError } = await supabase
    .from("events")
    .select("id, artist_id, source_url, title, starts_at, raw_hash")
    .eq("artist_id", source.artist_id);

  if (existingError) throw existingError;

  const plan = planEventChanges(events, existing ?? []);
  const changed = plan.changed;

  let records: Array<Record<string, any>> = [];
  if (changed.length) {
    const updates = changed.filter((event) => event._existingId);
    const inserts = changed.filter((event) => !event._existingId);
    if (updates.length) {
      const { data, error } = await supabase
        .from("events")
        .upsert(updates.map(({ _existingId, _isNew, ...event }) => ({ id: _existingId, ...event })), { onConflict: "id" })
        .select("id, artist_id, title, starts_at, ticket_url, source_url, raw_hash");
      if (error) throw error;
      records.push(...(data ?? []));
    }
    if (inserts.length) {
      const { data, error } = await supabase
        .from("events")
        .upsert(inserts.map(({ _existingId, _isNew, ...event }) => event), { onConflict: "artist_id,title,starts_at" })
        .select("id, artist_id, title, starts_at, ticket_url, source_url, raw_hash");
      if (error) throw error;
      records.push(...(data ?? []));
    }
  }

  const idByIdentity = new Map(records.map((row) => [eventIdentity(row), row.id]));
  return {
    changed: changed.length,
    unchanged: plan.unchanged,
    duplicates: plan.duplicates,
    notifications: changed
      .flatMap((event) => {
        const entityId = event._existingId ?? idByIdentity.get(eventIdentity(event));
        return entityId ? [{
          entity_type: "event" as const,
          event_type: (event._isNew ? "event_created" : "event_changed") as const,
          entity_id: entityId,
          artist_id: event.artist_id,
          title: event.title,
          url: event.ticket_url ?? event.source_url,
          change_hash: event.raw_hash
        }] : [];
      })
  };
}

type NotificationCandidate = {
  entity_type: "post" | "event";
  event_type: "post_created" | "event_created" | "event_changed";
  entity_id: string;
  artist_id: string;
  title: string;
  url: string;
  change_hash: string;
};

type NotificationBudget = { remaining: number };

async function attemptDiscordDelivery(
  supabase: SupabaseClient<any>,
  delivery: Record<string, any>,
  candidate: NotificationCandidate,
  budget: NotificationBudget
) {
  if (budget.remaining <= 0) return "deferred" as const;
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_notification_delivery", { target_delivery_id: delivery.id })
    .maybeSingle();
  if (claimError) {
    console.error("Notification claim failed", claimError.message);
    return "failed" as const;
  }
  if (!claimed) return "skipped" as const;

  budget.remaining -= 1;
  try {
    await postDiscordUpdate(discordWebhookUrl, candidate);
  } catch (error) {
    const retryable = error instanceof DiscordDeliveryError && error.retryable;
    const detail = error instanceof Error ? error.message : String(error);
    await supabase.from("notification_deliveries").update({
      status: "failed",
      attempts: retryable ? claimed.attempts : MAX_NOTIFICATION_ATTEMPTS,
      claimed_at: null,
      last_error: `${retryable ? "Provider rejected delivery" : "Delivery result is ambiguous; automatic retry disabled"}: ${detail}`.slice(0, 500)
    }).eq("id", delivery.id).eq("status", "processing");
    return "failed" as const;
  }

  // Do not turn a successful provider call into a retry when only the local
  // acknowledgement fails: that would post the same Discord message twice.
  const { data: acknowledged, error: acknowledgeError } = await supabase
    .from("notification_deliveries")
    .update({
      status: "sent",
      last_error: null,
      sent_at: new Date().toISOString(),
      claimed_at: null
    })
    .eq("id", delivery.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (acknowledgeError || !acknowledged) {
    console.error("Notification was sent but acknowledgement failed", acknowledgeError?.message ?? "row was not processing");
    return "sent_unconfirmed" as const;
  }
  return "sent" as const;
}

async function notifyDiscord(
  supabase: SupabaseClient<any>,
  candidates: NotificationCandidate[],
  budget: NotificationBudget
) {
  if (!discordWebhookUrl || candidates.length === 0) {
    return { sent: 0, sent_unconfirmed: 0, failed: 0, deferred: 0, skipped: candidates.length };
  }

  let sent = 0;
  let sentUnconfirmed = 0;
  let failed = 0;
  let deferred = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const { data: rules, error: ruleError } = await supabase
      .from("notification_rules")
      .select("id, destination_key")
      .eq("enabled", true)
      .eq("event_type", candidate.event_type)
      .or(`artist_id.eq.${candidate.artist_id},artist_id.is.null`);
    if (ruleError) {
      failed += 1;
      continue;
    }

    for (const rule of rules ?? []) {
      // This first provider intentionally supports only the server-side default
      // Discord destination. Never store webhook URLs in browser-readable rows.
      if (rule.destination_key !== "default") continue;
      const { data: existing, error: deliveryReadError } = await supabase
        .from("notification_deliveries")
        .select("id, status, attempts")
        .eq("rule_id", rule.id)
        .eq("entity_type", candidate.entity_type)
        .eq("entity_id", candidate.entity_id)
        .eq("change_hash", candidate.change_hash)
        .maybeSingle();
      if (deliveryReadError || existing?.status === "sent") continue;
      if (existing?.status === "failed" && existing.attempts >= MAX_NOTIFICATION_ATTEMPTS) continue;

      let delivery = existing;
      if (!delivery) {
        const { data, error } = await supabase
          .from("notification_deliveries")
          .insert({
            rule_id: rule.id,
            entity_type: candidate.entity_type,
            entity_id: candidate.entity_id,
            change_hash: candidate.change_hash,
            status: "pending"
          })
          .select("id, status, attempts")
          .single();
        if (error) continue;
        delivery = data;
      }

      const outcome = await attemptDiscordDelivery(supabase, delivery, candidate, budget);
      if (outcome === "sent") sent += 1;
      if (outcome === "sent_unconfirmed") sentUnconfirmed += 1;
      if (outcome === "failed") failed += 1;
      if (outcome === "deferred") deferred += 1;
      if (outcome === "skipped") skipped += 1;
    }
  }
  return { sent, sent_unconfirmed: sentUnconfirmed, failed, deferred, skipped };
}

async function retryDiscordDeliveries(supabase: SupabaseClient<any>, budget: NotificationBudget) {
  if (!discordWebhookUrl || budget.remaining <= 0) {
    return { sent: 0, sent_unconfirmed: 0, failed: 0, deferred: 0, skipped: 0, stale: 0 };
  }

  const { data: deliveries, error: deliveryError } = await supabase
    .from("notification_deliveries")
    .select("id, rule_id, entity_type, entity_id, change_hash, status, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_NOTIFICATION_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(MAX_NOTIFICATION_SENDS_PER_RUN);
  if (deliveryError) throw deliveryError;
  if (!deliveries?.length) return { sent: 0, sent_unconfirmed: 0, failed: 0, deferred: 0, skipped: 0, stale: 0 };

  const ruleIds = [...new Set(deliveries.map((delivery) => delivery.rule_id))];
  const postIds = [...new Set(deliveries.filter((delivery) => delivery.entity_type === "post").map((delivery) => delivery.entity_id))];
  const eventIds = [...new Set(deliveries.filter((delivery) => delivery.entity_type === "event").map((delivery) => delivery.entity_id))];
  const [rulesResult, postsResult, eventsResult] = await Promise.all([
    supabase.from("notification_rules").select("id, artist_id, event_type, destination_key, enabled").in("id", ruleIds),
    postIds.length
      ? supabase.from("posts").select("id, artist_id, title, url, raw_hash").in("id", postIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? supabase.from("events").select("id, artist_id, title, ticket_url, source_url, raw_hash").in("id", eventIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (rulesResult.error) throw rulesResult.error;
  if (postsResult.error) throw postsResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const resolved = resolveRetryCandidates({
    deliveries,
    rules: rulesResult.data ?? [],
    posts: postsResult.data ?? [],
    events: eventsResult.data ?? []
  });
  for (const stale of resolved.stale) {
    await supabase.from("notification_deliveries").update({
      status: "failed",
      attempts: MAX_NOTIFICATION_ATTEMPTS,
      claimed_at: null,
      last_error: "Notification superseded or its source entity is no longer available."
    }).eq("id", stale.id);
  }

  let sent = 0;
  let sentUnconfirmed = 0;
  let failed = 0;
  let deferred = 0;
  let skipped = 0;
  for (const { delivery, candidate } of resolved.ready) {
    const outcome = await attemptDiscordDelivery(supabase, delivery, candidate, budget);
    if (outcome === "sent") sent += 1;
    if (outcome === "sent_unconfirmed") sentUnconfirmed += 1;
    if (outcome === "failed") failed += 1;
    if (outcome === "deferred") deferred += 1;
    if (outcome === "skipped") skipped += 1;
  }
  return { sent, sent_unconfirmed: sentUnconfirmed, failed, deferred, skipped, stale: resolved.stale.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required." }, 500);
  }

  if (!sharedSecret) {
    return json({ error: "COLLECT_SHARED_SECRET must be configured before collector use." }, 503);
  }

  if (req.headers.get("x-collect-secret") !== sharedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const notificationBudget = createNotificationBudget();
  let retriedNotifications = { sent: 0, sent_unconfirmed: 0, failed: 0, deferred: 0, skipped: 0, stale: 0 };
  try {
    retriedNotifications = await retryDiscordDeliveries(supabase, notificationBudget);
  } catch (error) {
    // Notification availability must never prevent collection of other sources.
    retriedNotifications = { sent: 0, sent_unconfirmed: 0, failed: 1, deferred: 0, skipped: 0, stale: 0 };
    console.error("Notification retry preparation failed", error instanceof Error ? error.message : String(error));
  }

  const { data: sourceRows, error } = await supabase
    .from("sources")
    .select("id, artist_id, source_type, label, url, config, artists(name)")
    .eq("enabled", true)
    .order("source_type")
    .order("label");

  if (error) return json({ error: error.message }, 500);

  const sources = ((sourceRows ?? []) as SourceRow[]).map(({ artists, ...source }) => ({
    ...source,
    artist_name: artists?.name ?? ""
  }));

  const results = [];
  for (const source of sources as Source[]) {
    const checkedAt = new Date().toISOString();
    try {
      const collected = await collectSource(source, { fetchText, youtubeApiKey });
      if (collected.skipped) {
        await supabase.from("sources").update({ last_checked_at: checkedAt }).eq("id", source.id);
        await supabase.from("update_logs").insert({
          source_id: source.id,
          status: "skipped",
          message: collected.reason
        });
        results.push({ source: source.label, status: "skipped", reason: collected.reason });
        continue;
      }

      const persistedPosts = await persistPosts(supabase, source, collected.posts);
      const persistedEvents = await persistEvents(supabase, source, collected.events);
      const notifications = await notifyDiscord(supabase, [
        ...persistedPosts.notifications,
        ...persistedEvents.notifications
      ], notificationBudget);
      await supabase.from("sources").update({ last_checked_at: checkedAt }).eq("id", source.id);
      await supabase.from("update_logs").insert({
        source_id: source.id,
        status: "ok",
        message: `posts: ${persistedPosts.changed} changed, ${persistedPosts.unchanged} unchanged, ${persistedPosts.duplicates} duplicate inputs; events: ${persistedEvents.changed} changed, ${persistedEvents.unchanged} unchanged, ${persistedEvents.duplicates} duplicate inputs; notifications: ${notifications.sent} sent, ${notifications.sent_unconfirmed} unconfirmed, ${notifications.failed} failed, ${notifications.deferred} deferred${collected.diagnostic ? `; diagnostic: ${collected.diagnostic}` : ""}`
      });
      results.push({
        source: source.label,
        status: "ok",
        fetched_posts: collected.posts.length,
        fetched_events: collected.events.length,
        posts: {
          changed: persistedPosts.changed,
          unchanged: persistedPosts.unchanged,
          duplicates: persistedPosts.duplicates
        },
        events: {
          changed: persistedEvents.changed,
          unchanged: persistedEvents.unchanged,
          duplicates: persistedEvents.duplicates
        },
        notifications,
        diagnostic: collected.diagnostic ?? null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("update_logs").insert({ source_id: source.id, status: "error", message });
      results.push({ source: source.label, status: "error", message });
    }
  }

  return json({
    ok: true,
    checked_at: new Date().toISOString(),
    notification_retries: retriedNotifications,
    notification_budget_remaining: notificationBudget.remaining,
    results
  });
});
