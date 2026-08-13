import { parseFeed } from "./feed-parser.js";
import { parseArticleList } from "./article-parser.js";
import { enrichYouTubePosts, extractYouTubeChannelId } from "./youtube.js";
import { parseLiveEvents } from "./live-parser.js";
import { parseHtmlSnapshot } from "./html-snapshot.js";

async function collectYouTube(source, fetchText, youtubeApiKey) {
  if (source.url.includes("youtube.com/feeds/videos.xml")) {
    return enrichYouTubePosts(parseFeed(source, await fetchText(source.url)), { apiKey: youtubeApiKey });
  }

  const channelPage = await fetchText(source.url);
  const channelId = extractYouTubeChannelId(channelPage);
  if (!channelId) throw new Error(`YouTube channel ID could not be resolved from ${source.url}`);

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  return enrichYouTubePosts(parseFeed(source, await fetchText(feedUrl)), { apiKey: youtubeApiKey });
}

export async function collectSource(source, { fetchText, youtubeApiKey = "" }) {
  if (source.source_type === "x" || source.source_type === "instagram") {
    return { skipped: true, reason: `${source.source_type} scraping is intentionally disabled`, posts: [], events: [] };
  }
  if (source.source_type === "youtube") {
    return { skipped: false, posts: await collectYouTube(source, fetchText, youtubeApiKey), events: [] };
  }

  const body = await fetchText(source.url);
  const looksLikeFeed = source.source_type === "rss" || /<(rss|feed)\b/i.test(body.slice(0, 1200));
  if (source.source_type === "live") {
    const events = parseLiveEvents(source, body);
    return {
      skipped: false,
      posts: [],
      events,
      diagnostic: events.length ? undefined : "no unambiguous live events matched the configured artist section"
    };
  }
  if (looksLikeFeed) return { skipped: false, posts: parseFeed(source, body), events: [] };

  const articlePosts = parseArticleList(source, body);
  return {
    skipped: false,
    posts: articlePosts.length ? articlePosts : parseHtmlSnapshot(source, body),
    events: []
  };
}
