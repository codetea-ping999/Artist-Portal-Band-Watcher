import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { enrichYouTubePosts, extractYouTubeChannelId } from "../../supabase/functions/collect/youtube.js";

const atomPost = {
  artist_id: "artist-1",
  source_id: "youtube-1",
  source_type: "youtube",
  title: "Atom title",
  url: "https://www.youtube.com/watch?v=video123",
  summary: "Atom summary",
  external_id: "video123",
  published_at: "2026-08-10T00:00:00.000Z",
  raw_hash: "atom"
};
const videosFixture = await readFile(new URL("../fixtures/youtube-videos.json", import.meta.url), "utf8");
const quotaFixture = await readFile(new URL("../fixtures/youtube-quota-error.json", import.meta.url), "utf8");

test("extracts a YouTube channel id without calling the Data API", () => {
  assert.equal(extractYouTubeChannelId('<meta itemprop="channelId" content="UCabcdefghijklmnopqrstuv">'), "UCabcdefghijklmnopqrstuv");
});

test("enriches Atom videos in one bounded API request", async () => {
  let requestedUrl;
  const posts = await enrichYouTubePosts([atomPost], {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(videosFixture, { status: 200 });
    }
  });
  assert.equal(requestedUrl.pathname, "/youtube/v3/videos");
  assert.equal(requestedUrl.searchParams.get("id"), "video123");
  assert.equal(posts[0].title, "API title");
  assert.equal(posts[0].metadata.duration, "PT3M15S");
  assert.equal(posts[0].metadata.live_status, "upcoming");
  assert.notEqual(posts[0].raw_hash, atomPost.raw_hash);
});

test("falls back to Atom data when the optional API errors", async () => {
  const posts = await enrichYouTubePosts([atomPost], {
    apiKey: "test-key",
    fetchImpl: async () => new Response(quotaFixture, { status: 403, headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(posts, [atomPost]);
});

test("limits one videos.list request to 25 IDs", async () => {
  let requestedIds = [];
  const posts = Array.from({ length: 30 }, (_, index) => ({
    ...atomPost,
    url: `https://www.youtube.com/watch?v=video${String(index).padStart(3, '0')}`,
    external_id: `video${String(index).padStart(3, '0')}`
  }));
  await enrichYouTubePosts(posts, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      requestedIds = new URL(url).searchParams.get('id').split(',');
      return new Response('{"items":[]}', { status: 200 });
    }
  });

  assert.equal(requestedIds.length, 25);
});
