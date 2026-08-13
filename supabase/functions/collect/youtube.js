import { hashText, stripHtml } from "./feed-parser.js";

export function extractYouTubeChannelId(body) {
  const patterns = [
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /itemprop=["']channelId["'][^>]+content=["'](UC[a-zA-Z0-9_-]{20,})["']/i,
    /content=["'](UC[a-zA-Z0-9_-]{20,})["'][^>]+itemprop=["']channelId["']/i
  ];
  for (const pattern of patterns) {
    const match = String(body ?? "").match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

export function youtubeVideoId(post) {
  if (/^[\w-]{6,}$/.test(String(post?.external_id ?? ""))) return post.external_id;
  try {
    return new URL(post.url).searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

function videoSummary(video, fallback) {
  const description = String(video.snippet?.description ?? "").replace(/\s+/g, " ").trim();
  return description ? description.slice(0, 320) : fallback;
}

export async function enrichYouTubePosts(posts, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey || posts.length === 0) return posts;
  const ids = [...new Set(posts.map(youtubeVideoId).filter(Boolean))].slice(0, 25);
  if (ids.length === 0) return posts;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,liveStreamingDetails");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("key", apiKey);
    url.searchParams.set("fields", "items(id,snippet(title,description,publishedAt,thumbnails,liveBroadcastContent),contentDetails(duration),liveStreamingDetails(scheduledStartTime,actualStartTime,actualEndTime))");
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`YouTube Data API returned HTTP ${response.status}`);
    const body = await response.json();
    const videos = new Map((body.items ?? []).map((video) => [video.id, video]));

    return posts.map((post) => {
      const id = youtubeVideoId(post);
      const video = videos.get(id);
      if (!video) return post;
      const snippet = video.snippet ?? {};
      const metadata = {
        provider: "youtube",
        video_id: id,
        thumbnail_url: snippet.thumbnails?.maxres?.url ?? snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? null,
        duration: video.contentDetails?.duration ?? null,
        live_status: snippet.liveBroadcastContent ?? "none",
        scheduled_start_at: video.liveStreamingDetails?.scheduledStartTime ?? null,
        actual_start_at: video.liveStreamingDetails?.actualStartTime ?? null,
        actual_end_at: video.liveStreamingDetails?.actualEndTime ?? null
      };
      const title = stripHtml(snippet.title || post.title);
      const summary = videoSummary(video, post.summary);
      const publishedAt = snippet.publishedAt && !Number.isNaN(new Date(snippet.publishedAt).getTime())
        ? new Date(snippet.publishedAt).toISOString()
        : post.published_at;
      return {
        ...post,
        title,
        summary,
        published_at: publishedAt,
        metadata,
        raw_hash: hashText(`youtube:${post.external_id}:${title}:${summary}:${publishedAt ?? ""}:${JSON.stringify(metadata)}`)
      };
    });
  } catch {
    return posts;
  }
}
