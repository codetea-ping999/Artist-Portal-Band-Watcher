import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

type Source = {
  id: string;
  artist_id: string;
  source_type: string;
  label: string;
  url: string;
};

type CollectedPost = {
  artist_id: string;
  source_id: string;
  source_type: string;
  title: string;
  url: string;
  summary: string;
  external_id: string;
  published_at: string;
  raw_hash: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sharedSecret = Deno.env.get("COLLECT_SHARED_SECRET") ?? "";
const userAgent = "ArtistPortalBandWatcher/0.2 (+https://github.com/codetea-ping999/Artist-Portal-Band-Watcher)";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .trim();
}

function stripHtml(value: string) {
  return decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
}

function getTag(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
}

function getAttribute(block: string, tag: string, attribute: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(`<${escapedTag}\\b[^>]*\\b${escapedAttribute}=["']([^"']+)["'][^>]*>`, "i")
  );
  return match ? decodeEntities(match[1]) : "";
}

function absolutize(base: string, maybeUrl: string) {
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return base;
  }
}

function isoDate(value: string | undefined, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function feedPost(source: Source, block: string, kind: "rss" | "atom"): CollectedPost {
  const title = stripHtml(getTag(block, "title") || source.label);
  const atomLink = getAttribute(block, "link", "href");
  const link = absolutize(source.url, getTag(block, "link") || atomLink || source.url);
  const summary = stripHtml(
    getTag(block, "description") ||
      getTag(block, "content:encoded") ||
      getTag(block, "media:description") ||
      getTag(block, "summary") ||
      getTag(block, "content") ||
      ""
  ).slice(0, 320);
  const published =
    getTag(block, "pubDate") ||
    getTag(block, "published") ||
    getTag(block, "updated") ||
    new Date().toISOString();
  const externalId =
    getTag(block, "guid") || getTag(block, "id") || getTag(block, "yt:videoId") || link;

  return {
    artist_id: source.artist_id,
    source_id: source.id,
    source_type: source.source_type,
    title,
    url: link,
    summary,
    external_id: externalId,
    published_at: isoDate(published),
    raw_hash: hashText(`${kind}:${externalId}:${title}:${summary}:${published}`)
  };
}

function parseFeed(source: Source, body: string) {
  const rssItems = [...body.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  if (rssItems.length) {
    return rssItems.slice(0, 25).map((block) => feedPost(source, block, "rss"));
  }

  const atomEntries = [...body.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  return atomEntries.slice(0, 25).map((block) => feedPost(source, block, "atom"));
}

function parseHtmlSnapshot(source: Source, body: string): CollectedPost[] {
  const title = stripHtml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? source.label);
  const descriptionMatch =
    body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ??
    body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const description = stripHtml(descriptionMatch?.[1] ?? "公式ページの更新を確認しました。");
  const snapshotHash = hashText(`${title}:${description}`);

  return [
    {
      artist_id: source.artist_id,
      source_id: source.id,
      source_type: source.source_type,
      title,
      url: source.url,
      summary: description.slice(0, 320),
      external_id: source.url,
      published_at: new Date().toISOString(),
      raw_hash: snapshotHash
    }
  ];
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

function extractYouTubeChannelId(body: string) {
  const patterns = [
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /itemprop=["']channelId["'][^>]+content=["'](UC[a-zA-Z0-9_-]{20,})["']/i,
    /content=["'](UC[a-zA-Z0-9_-]{20,})["'][^>]+itemprop=["']channelId["']/i
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

async function collectYouTube(source: Source) {
  if (source.url.includes("youtube.com/feeds/videos.xml")) {
    return parseFeed(source, await fetchText(source.url));
  }

  const channelPage = await fetchText(source.url);
  const channelId = extractYouTubeChannelId(channelPage);
  if (!channelId) {
    throw new Error(`YouTube channel ID could not be resolved from ${source.url}`);
  }

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  return parseFeed(source, await fetchText(feedUrl));
}

async function collectSource(source: Source) {
  if (source.source_type === "x" || source.source_type === "instagram") {
    return { skipped: true, reason: `${source.source_type} scraping is intentionally disabled`, posts: [] as CollectedPost[] };
  }

  if (source.source_type === "youtube") {
    return { skipped: false, posts: await collectYouTube(source) };
  }

  const body = await fetchText(source.url);
  const looksLikeFeed = source.source_type === "rss" || /<(rss|feed)\b/i.test(body.slice(0, 1200));
  return {
    skipped: false,
    posts: looksLikeFeed ? parseFeed(source, body) : parseHtmlSnapshot(source, body)
  };
}

async function persistPosts(
  supabase: ReturnType<typeof createClient>,
  source: Source,
  posts: CollectedPost[]
) {
  const { data: existing, error: existingError } = await supabase
    .from("posts")
    .select("url, raw_hash")
    .eq("source_id", source.id);

  if (existingError) throw existingError;

  const hashes = new Map((existing ?? []).map((row) => [row.url, row.raw_hash]));
  const changed = posts.filter((post) => hashes.get(post.url) !== post.raw_hash);
  const unchanged = posts.length - changed.length;

  if (changed.length) {
    const { error: upsertError } = await supabase
      .from("posts")
      .upsert(changed, { onConflict: "artist_id,url" });
    if (upsertError) throw upsertError;
  }

  return { changed: changed.length, unchanged };
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

  const { data: sources, error } = await supabase
    .from("sources")
    .select("id, artist_id, source_type, label, url")
    .eq("enabled", true)
    .order("source_type")
    .order("label");

  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const source of (sources ?? []) as Source[]) {
    const checkedAt = new Date().toISOString();
    try {
      const collected = await collectSource(source);
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

      const persisted = await persistPosts(supabase, source, collected.posts);
      await supabase.from("sources").update({ last_checked_at: checkedAt }).eq("id", source.id);
      await supabase.from("update_logs").insert({
        source_id: source.id,
        status: "ok",
        message: `${persisted.changed} changed, ${persisted.unchanged} unchanged`
      });
      results.push({
        source: source.label,
        status: "ok",
        fetched: collected.posts.length,
        ...persisted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("update_logs").insert({ source_id: source.id, status: "error", message });
      results.push({ source: source.label, status: "error", message });
    }
  }

  return json({ ok: true, checked_at: new Date().toISOString(), results });
});
