import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

type Source = {
  id: string;
  artist_id: string;
  source_type: string;
  label: string;
  url: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sharedSecret = Deno.env.get("COLLECT_SHARED_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
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
    .trim();
}

function getTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1].replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, "$1")) : "";
}

function absolutize(base: string, maybeUrl: string) {
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return base;
  }
}

function parseRss(source: Source, body: string) {
  const itemBlocks = [...body.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return itemBlocks.slice(0, 20).map((block) => {
    const title = getTag(block, "title") || source.label;
    const link = absolutize(source.url, getTag(block, "link") || source.url);
    const summary = getTag(block, "description").replace(/<[^>]+>/g, "").slice(0, 240);
    const pubDate = getTag(block, "pubDate") || getTag(block, "updated") || new Date().toISOString();
    return {
      artist_id: source.artist_id,
      source_id: source.id,
      source_type: source.source_type,
      title,
      url: link,
      summary,
      external_id: getTag(block, "guid") || link,
      published_at: new Date(pubDate).toISOString(),
      raw_hash: hashText(block)
    };
  });
}

function parseHtmlTitle(source: Source, body: string) {
  const title = decodeEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? source.label);
  const description = decodeEntities(body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "公式ページを確認しました。");
  return [{
    artist_id: source.artist_id,
    source_id: source.id,
    source_type: source.source_type,
    title,
    url: source.url,
    summary: description.slice(0, 240),
    external_id: source.url,
    published_at: new Date().toISOString(),
    raw_hash: hashText(`${title}:${description}`)
  }];
}

async function collectSource(source: Source) {
  const response = await fetch(source.url, {
    headers: {
      "user-agent": "ArtistPortalBandWatcher/0.1 (+https://github.com/codetea-ping999/Artist-Portal-Band-Watcher)"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  const isRss = source.source_type === "rss" || /<rss|<feed/i.test(body.slice(0, 500));
  return isRss ? parseRss(source, body) : parseHtmlTitle(source, body);
}

Deno.serve(async (req) => {
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required." }, 500);
  }

  if (sharedSecret && req.headers.get("x-collect-secret") !== sharedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { data: sources, error } = await supabase
    .from("sources")
    .select("id, artist_id, source_type, label, url")
    .eq("enabled", true);

  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const source of (sources ?? []) as Source[]) {
    try {
      const posts = await collectSource(source);
      if (posts.length) {
        const { error: upsertError } = await supabase
          .from("posts")
          .upsert(posts, { onConflict: "artist_id,url" });
        if (upsertError) throw upsertError;
      }
      await supabase.from("sources").update({ last_checked_at: new Date().toISOString() }).eq("id", source.id);
      await supabase.from("update_logs").insert({ source_id: source.id, status: "ok", message: `${posts.length} posts collected` });
      results.push({ source: source.label, status: "ok", count: posts.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("update_logs").insert({ source_id: source.id, status: "error", message });
      results.push({ source: source.label, status: "error", message });
    }
  }

  return json({ ok: true, results });
});
