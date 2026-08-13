import { canonicalizeUrl, getTagAttribute, hashText, stripHtml } from "./feed-parser.js";

const GENERIC_LINK_TEXT = /^(?:more|read more|続きを読む|詳細|詳しくはこちら|一覧|トップ|home|menu|next|prev|前へ|次へ)$/iu;
const DATE_PATTERN = /(?<year>20\d{2})[./年\-\s]+(?<month>\d{1,2})[./月\-\s]+(?<day>\d{1,2})日?/u;

function getAttribute(attributes, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes ?? "").match(new RegExp(`\\b${escaped}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? "";
}

function sourceConfig(source) {
  const config = source?.config ?? source?.collector_config ?? {};
  return config && typeof config === "object" ? config : {};
}

function isConfiguredArticleUrl(source, url) {
  const config = sourceConfig(source);
  const prefix = String(config.article_url_prefix ?? "").trim();
  const contains = String(config.article_url_contains ?? "").trim();
  try {
    if (config.allow_external_articles !== true && new URL(url).origin !== new URL(source.url).origin) return false;
  } catch {
    return false;
  }
  if (prefix && !url.startsWith(prefix)) return false;
  if (contains && !url.includes(contains)) return false;
  return Boolean(prefix || contains);
}

function dateFromText(value) {
  const machineDate = getTagAttribute(value, "time", "datetime");
  if (machineDate) {
    const date = new Date(machineDate);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const candidate = stripHtml(value).match(DATE_PATTERN)?.[0] ?? "";
  if (!candidate) return null;
  const japanese = candidate.match(DATE_PATTERN);
  if (japanese?.groups) {
    const { year, month, day } = japanese.groups;
    const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function linkCandidates(source, block) {
  const candidates = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(block ?? "").matchAll(pattern)) {
    const href = getAttribute(match[1], "href");
    const title = stripHtml(match[2]);
    if (!href || title.length < 3 || GENERIC_LINK_TEXT.test(title)) continue;
    const url = canonicalizeUrl(source.url, href);
    if (!isConfiguredArticleUrl(source, url)) continue;
    candidates.push({ title, url });
  }
  return candidates;
}

function blocksFromHtml(body) {
  const blocks = [];
  const semantic = /<(article|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of String(body ?? "").matchAll(semantic)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2] ?? "";
    const className = getAttribute(attributes, "class");
    if (tag === "article" || /(?:news|blog|article|post|release|information)/iu.test(className)) {
      blocks.push(match[0]);
    }
  }
  return blocks;
}

function anchoredArticleCandidates(source, body) {
  const config = sourceConfig(source);
  const anchorPrefix = String(config.article_anchor_prefix ?? "").trim();
  const containerId = String(config.article_container_id ?? "").trim();
  if (!anchorPrefix || !containerId) return [];

  const candidates = [];
  const anchoredBlocks = /<a\b([^>]*)>\s*<\/a>\s*<div\b([^>]*)>([\s\S]*?)(?=<a\b[^>]*(?:name|id)\s*=|$)/gi;
  for (const match of String(body ?? "").matchAll(anchoredBlocks)) {
    const anchor = getAttribute(match[1], "name") || getAttribute(match[1], "id");
    if (!anchor.startsWith(anchorPrefix) || getAttribute(match[2], "id") !== containerId) continue;

    const block = match[3] ?? "";
    const header = block.match(/<b\b[^>]*>([\s\S]*?)<\/b>/i)?.[1] ?? "";
    const publishedAt = dateFromText(header);
    const title = stripHtml(header).replace(DATE_PATTERN, "").replace(/\s+/g, " ").trim();
    if (!title) continue;

    const articleBody = block.match(/<div\b[^>]*\bid\s*=\s*["']newsbody["'][^>]*>([\s\S]*)/i)?.[1] ?? block;
    const summary = stripHtml(articleBody).slice(0, 320);
    const url = new URL(source.url);
    url.hash = anchor;
    const articleUrl = url.toString();
    candidates.push({
      artist_id: source.artist_id,
      source_id: source.id,
      source_type: source.source_type,
      title,
      url: articleUrl,
      summary,
      external_id: articleUrl,
      published_at: publishedAt,
      raw_hash: hashText(`article:${articleUrl}:${title}:${summary}:${publishedAt ?? ""}`)
    });
  }
  return candidates;
}

export function parseArticleList(source, body) {
  const blocks = blocksFromHtml(body);
  const posts = anchoredArticleCandidates(source, body);
  for (const block of blocks) {
    const publishedAt = dateFromText(block);
    const text = stripHtml(block);
    for (const candidate of linkCandidates(source, block)) {
      const summary = text.replace(candidate.title, "").replace(/\s+/g, " ").trim().slice(0, 320);
      posts.push({
        artist_id: source.artist_id,
        source_id: source.id,
        source_type: source.source_type,
        title: candidate.title,
        url: candidate.url,
        summary,
        external_id: candidate.url,
        published_at: publishedAt,
        raw_hash: hashText(`article:${candidate.url}:${candidate.title}:${summary}:${publishedAt ?? ""}`)
      });
    }
  }

  return [...new Map(posts.map((post) => [post.url, post])).values()].slice(0, 25);
}
