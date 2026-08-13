import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseArticleList } from "../../supabase/functions/collect/article-parser.js";
import { parseFeed } from "../../supabase/functions/collect/feed-parser.js";

const source = {
  id: "source-news",
  artist_id: "artist-1",
  source_type: "rss",
  label: "Official news",
  url: "https://example.test/feed.xml",
  config: { article_url_prefix: "https://example.test/news/" }
};

test("parses RSS namespaced metadata and canonicalizes tracking URLs", async () => {
  const fixture = await readFile(new URL("../fixtures/rss-feed.xml", import.meta.url), "utf8");
  const [post] = parseFeed(source, fixture);

  assert.equal(post.title, "New & Official Update");
  assert.equal(post.url, "https://example.test/news/one");
  assert.equal(post.external_id, "news-1");
  assert.equal(post.published_at, "2026-08-13T01:00:00.000Z");
  assert.equal(post.summary, "Short official summary.");
});

test("prefers an Atom alternate link over self links", async () => {
  const fixture = await readFile(new URL("../fixtures/atom-feed.xml", import.meta.url), "utf8");
  const [post] = parseFeed(source, fixture);

  assert.equal(post.url, "https://example.test/videos/one");
  assert.equal(post.external_id, "tag:example.test,2026:video-1");
  assert.equal(post.published_at, "2026-08-12T12:00:00.000Z");
});

test("retains missing feed dates as null so an unchanged item is stable", () => {
  const fixture = "<rss><channel><item><title>Undated</title><link>/news/undated</link><guid>undated</guid></item></channel></rss>";
  const [first] = parseFeed(source, fixture);
  const [second] = parseFeed(source, fixture);

  assert.equal(first.published_at, null);
  assert.equal(first.raw_hash, second.raw_hash);
});

test("rejects a non-feed response instead of silently recording it as an empty feed", () => {
  assert.throws(() => parseFeed(source, "<html><title>Error</title></html>"), /valid RSS or Atom feed/);
  assert.throws(() => parseFeed(source, "<rss>truncated gateway response"), /valid RSS or Atom feed/);
});

test("accepts valid empty RSS and Atom documents", () => {
  assert.deepEqual(parseFeed(source, "<rss version=\"2.0\"><channel><title>Empty</title></channel></rss>"), []);
  assert.deepEqual(parseFeed(source, "<feed xmlns=\"http://www.w3.org/2005/Atom\"><title>Empty</title></feed>"), []);
});

test("rejects active-content feed links and falls through to a safe alternate", () => {
  const maliciousOnly = '<feed><entry><title>Unsafe</title><id>unsafe-1</id><link rel="alternate" href="javascript:alert(1)" /></entry></feed>';
  assert.deepEqual(parseFeed(source, maliciousOnly), []);

  const safeFallback = '<feed><entry><title>Safe</title><id>safe-1</id><link rel="alternate" href="data:text/html,bad" /><link href="/news/safe" /></entry></feed>';
  assert.equal(parseFeed(source, safeFallback)[0].url, 'https://example.test/news/safe');
});

test("extracts configured article links and keeps the snapshot fallback available to the caller", async () => {
  const fixture = await readFile(new URL("../fixtures/article-list.html", import.meta.url), "utf8");
  const posts = parseArticleList({ ...source, source_type: "official" }, fixture);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, "ニューシングルのお知らせ");
  assert.equal(posts[0].url, "https://example.test/news/release-one");
  assert.equal(posts[0].published_at, "2026-08-10T00:30:00.000Z");
  assert.match(posts[0].summary, /リリース日/);
});

test("article rules reject external navigation links unless explicitly enabled", () => {
  const fixture = '<article><time datetime="2026-08-10"></time><a href="https://outside.test/news/phishing">External news</a></article>';
  const configured = { ...source, source_type: 'official', config: { article_url_contains: '/news/' } };
  assert.deepEqual(parseArticleList(configured, fixture), []);
  assert.equal(parseArticleList({ ...configured, config: { ...configured.config, allow_external_articles: true } }, fixture).length, 1);
});

test("extracts anchor-addressable news entries where a site has no separate article URLs", () => {
  const fixture = `
    <a name="news_1687"></a><div id="newscontents"><b>2026.05.13<br>最新ニュース</b><div id="newsbody">本文です。<a href="/app/news/1687/1.jpg">画像</a></div></div>
    <a name="news_1686"></a><div id="newscontents"><b>2026.05.08<br>次のニュース</b><div id="newsbody">次の記事です。</div></div>
  `;
  const posts = parseArticleList({
    ...source,
    source_type: "official",
    url: "https://artist.example/news.php",
    config: { article_anchor_prefix: "news_", article_container_id: "newscontents" }
  }, fixture);

  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, "最新ニュース");
  assert.equal(posts[0].url, "https://artist.example/news.php#news_1687");
  assert.equal(posts[0].published_at, "2026-05-13T00:00:00.000Z");
  assert.equal(posts[1].url, "https://artist.example/news.php#news_1686");
});
